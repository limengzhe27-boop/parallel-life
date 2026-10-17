import {
  prepareExplicitInvitationProjections,
  projectExplicitInvitationDecision,
} from './agent-external-event-projector.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { authorizeWorldCommandInTransaction } from './world-command-uow.ts';
import { storedActivityClock, capClockAtNextAppointment } from './clock-activity-repository.ts';
import { publicationPlaceLinks } from './publication-context.ts';
import { readPublicationInvitationLinks } from '../../settings/infrastructure/publication-story-repository.ts';
import { resultAckPrefix } from '../domain/matter-progression.ts';
import { replayWorldHistory, type WorldHistoryEvent } from '../domain/world-history.ts';
import { mergeAppointments } from '../domain/genesis-links.ts';
import {
  applyInvitationEvent,
  type InvitationCommand,
  type InvitationEvent,
} from '../domain/invitations.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldRepository } from '../application/ports.ts';
import type {
  WorldState,
  Session,
  TurnCommand,
  WorldEvent,
  CommitResult,
} from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
import { applyEvent } from '../domain/reducer.ts';
import { applyNoteEvent, type NoteCommand, type NoteEvent } from '../domain/notes.ts';
import { retainFacts } from '../domain/retention.ts';
import { openingMessagesForDisplay } from '../domain/opening-time.ts';
import { deriveAndStoreMemories } from '../../memory/infrastructure/memory-store.ts';
import { loadActorMemories } from '../../memory/infrastructure/memory-store.ts';
import { PublicationStoryRepository } from '../../settings/infrastructure/publication-story-repository.ts';
import { applyActorEventAssessments } from './actor-goal-repository.ts';
import { actorContext } from '../application/actor-context.ts';
import type { EventGoalAssessment } from '../domain/types.ts';
import { validateCharacterEffects } from '../domain/character-policy.ts';
import { parseProposal } from '../domain/validation.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { PostgresClockStore } from './clock-repository.ts';
import type {
  WorldListItem,
  WorldForkCheckpoint,
  WorldForkCheckpointsResponse,
} from '../../../contracts/life-management.ts';
const fingerprint = (command: TurnCommand) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        command.worldId,
        command.expectedVersion,
        command.actorId,
        command.text,
        ...(command.origin ? [command.origin] : []),
      ]),
    )
    .digest('hex');
/**
 * Writes what this turn taught the world: each character's own impression (character
 * scope) and the turn itself (branch scope, as an episode). Sources are real rows, so
 * the provenance trigger accepts them and a correction can point back at them.
 */
async function storeTurnMemories(
  sql: SqlClient,
  ownerId: string,
  state: WorldState,
  event: WorldEvent,
): Promise<void> {
  const replies = state.messages.filter((message) => message.sourceEventId === event.id);
  if (!replies.length) return;
  const effects = (event.data as { effects?: { type: string; actorId?: string; text?: string }[] })
    .effects;
  const beliefs = (effects ?? []).filter(
    (effect) =>
      effect.type === 'belief.recorded' &&
      effect.actorId &&
      effect.text &&
      !effect.text.startsWith(resultAckPrefix),
  );
  const items = [] as Parameters<typeof deriveAndStoreMemories>[1];
  for (const belief of beliefs) {
    const reply = replies.find((message) => message.actorId === belief.actorId);
    if (!reply) continue;
    items.push({
      ownerId,
      scopeType: 'character',
      scopeId: belief.actorId!,
      branchId: state.id,
      characterId: belief.actorId!,
      text: belief.text!,
      kind: 'belief',
      sourceType: 'agent_inference',
      sourceIds: [reply.id],
      importance: 3,
      evidence: { [reply.id]: { id: reply.id, role: 'assistant', text: reply.text } },
    });
  }
  const latest = replies.at(-1)!;
  items.push({
    ownerId,
    scopeType: 'branch',
    scopeId: state.id,
    /* branch/character scopes must name the world they belong to. */
    branchId: state.id,
    text: latest.text.slice(0, 400),
    kind: 'episode',
    sourceType: 'world_event',
    sourceIds: [event.id],
    importance: 2,
    evidence: { [event.id]: { id: event.id, text: latest.text.slice(0, 400) } },
  });
  await deriveAndStoreMemories(sql, items);
}

/** The same fact may arrive from the legacy snapshot and the projection; keep the first. */
function dedupeFacts(facts: WorldState['facts']): WorldState['facts'] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.id)) return false;
    seen.add(fact.id);
    return true;
  });
}
export function compactWorldState(state: WorldState) {
  /* messages/appointments/notes/facts live in projections; the snapshot stays compact. */
  return { ...state, messages: [], appointments: [], mediaRequests: [], notes: [], facts: [] };
}
/** Same domain contract as the test adapter; SQL transactions are the final commit boundary. */
export class PostgresWorldRepository implements WorldRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async initialize(session: Session, state: WorldState) {
    if (
      state.ownerId !== session.userId ||
      state.version !== 0 ||
      state.messages.length ||
      state.appointments.length ||
      state.mediaRequests.length
    )
      throw new DomainError('INVALID_COMMAND');
    await this.db.transaction(session.userId, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [state.id, session.userId, state.title, compactWorldState(state)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [state.id, session.userId, state, {}],
      );
    });
  }
  private async owned(sql: SqlClient, id: string, lock = false) {
    const row = (
      await sql.query(
        `SELECT state,version FROM parallel_life.worlds WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row || row.state?.deletedAt) throw new DomainError('NOT_FOUND');
    return { ...row.state, version: row.version } as WorldState;
  }
  private async hydrate(sql: SqlClient, state: WorldState): Promise<WorldState> {
    const initial = (
      await sql.query('SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
        state.id,
      ])
    ).rows[0]?.state;
    const results = [];
    for (const table of [
      'world_messages',
      'world_appointments',
      'world_media_requests',
      'world_notes',
      'world_facts',
    ]) {
      // Only immutable projections belonging to events already committed at this receipt version.
      const rows = await sql.query(
        `SELECT p.document FROM parallel_life.${table} p JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version,${['world_messages', 'world_facts'].includes(table) ? 'p.ordinal' : 'p.id'}`,
        [state.id, state.version],
      );
      results.push(rows.rows.map((r) => r.document));
    }
    let hydrated: WorldState = {
      ...state,
      messages: [
        ...openingMessagesForDisplay(
          initial?.messages ?? [],
          state.id,
          initial?.time ?? state.time,
        ),
        ...results[0]!,
      ],
      appointments: mergeAppointments(initial?.appointments ?? [], results[1]!),
      ...(initial?.genesisLinks ? { genesisLinks: initial.genesisLinks } : {}),
      mediaRequests: [...(initial?.mediaRequests ?? []), ...results[2]!],
      notes: results[3]!,
      facts: retainFacts(
        dedupeFacts([
          /* Genesis facts live in the immutable build snapshot. */
          ...(initial?.facts ?? []),
          /* Worlds created before the projection existed still carry facts in their snapshot. */
          ...(state.facts ?? []),
          ...results[4]!,
        ]),
      ),
    };
    hydrated = await publicationPlaceLinks(sql, hydrated);
    // Scene attendance retains the invitation's original immutable message source.
    // Rebuild only in worlds with an actual new attendance event, through this exact
    // receipt version: old response projections cannot overwrite newer attendance.
    const attendanceEvent = await sql.query(
      "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 AND payload->'data'->'worldResults'->'attendance' IS NOT NULL LIMIT 1",
      [state.id, state.version],
    );
    if (attendanceEvent.rowCount && initial) {
      const events = (
        await sql.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 ORDER BY version',
          [state.id, state.version],
        )
      ).rows.map((r) => r.payload) as WorldHistoryEvent[];
      const rebuilt = replayWorldHistory(
        initial as WorldState,
        events,
        state.version,
        await readPublicationInvitationLinks(sql, state.ownerId, state.id),
      ).world;
      return {
        ...hydrated,
        appointments: rebuilt.appointments,
        version: state.version,
        time: state.time,
      };
    }
    const responses = await sql.query(
      "SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 AND payload->>'type'='invitation.responded' ORDER BY version",
      [state.id, state.version],
    );
    for (const row of responses.rows) {
      const event = row.payload as InvitationEvent;
      hydrated = applyInvitationEvent(
        { ...hydrated, version: event.version - 1, time: event.storyTime },
        event,
      );
    }
    return { ...hydrated, version: state.version, time: state.time };
  }
  async respondToInvitation(session: Session, command: InvitationCommand) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          'invitation.responded',
          command.worldId,
          command.id,
          command.expectedVersion,
          command.operation,
          command.at ?? null,
        ]),
      )
      .digest('hex');
    return this.db.transaction(session.userId, async (sql) => {
      const current = await this.owned(sql, command.worldId, true);
      const previous = (
        await sql.query(
          'SELECT request_hash,result_state FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [command.worldId, command.commandId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        if (!previous.result_state) throw new DomainError('VERSION_CONFLICT');
        return this.hydrate(sql, previous.result_state);
      }
      await authorizeWorldCommandInTransaction(sql, session.userId, {
        worldId: command.worldId,
        commandId: command.commandId,
        expectedWorldVersion: command.expectedVersion,
        kind: 'invitation_respond',
      });
      const clockRow = (
        await sql.query(
          'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
          [command.worldId, session.userId],
        )
      ).rows[0];
      const realNow = new Date().toISOString();
      const projected = clockRow
        ? projectStoryTime(storedActivityClock(clockRow), realNow)
        : current.time;
      const storyTime = new Date(
        Math.max(Date.parse(current.time), Date.parse(projected)),
      ).toISOString();
      const event: InvitationEvent = {
        schemaVersion: 1,
        type: 'invitation.responded',
        storyTime,
        id: randomUUID(),
        worldId: command.worldId,
        commandId: command.commandId,
        version: command.expectedVersion + 1,
        occurredAt: realNow,
        data: command,
      };
      if (JSON.stringify(event).length >= 65536)
        throw new DomainError('INVALID_COMMAND', 'Event payload exceeded capacity budget');
      const before = { ...(await this.hydrate(sql, current)), time: storyTime };
      const state = applyInvitationEvent(before, event);
      const beforeAppointment = before.appointments.find((a) => a.id === command.id)!;
      const projections = await prepareExplicitInvitationProjections(sql, session.userId, {
        event,
        beforeAppointment,
      });
      if (projections.length)
        event.data = { ...command, agentProjections: projections.map((p) => p.projection) };
      if (JSON.stringify(event).length >= 65536)
        throw new DomainError('INVALID_COMMAND', 'Event payload exceeded capacity budget');
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [command.commandId, state.id, session.userId, command.expectedVersion, hash, command],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          event.id,
          state.id,
          session.userId,
          event.version,
          command.commandId,
          event,
          event.occurredAt,
        ],
      );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
        [state.id, state.version, compactWorldState(state)],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
        [state.id, command.commandId, event.id, compactWorldState(state)],
      );
      if (projections.length)
        await projectExplicitInvitationDecision(sql, session.userId, { event, beforeAppointment });
      await projectAgentWorldChange(sql, session.userId, state.id, event.id);
      await capClockAtNextAppointment(sql, session.userId, state.id, realNow);
      return state;
    });
  }
  /**
   * The user saving their own phone note. Persisted in the world_notes projection
   * (not in the world snapshot) with the same receipt/event discipline as other
   * commands: replaying the same command id returns the original note.
   */
  async saveNote(session: Session, input: NoteCommand) {
    return this.db.transaction(session.userId, async (sql) => {
      const current = await this.owned(sql, input.worldId, true);
      const previous = (
        await sql.query(
          'SELECT request_hash,request_payload,result_state,result_event_id FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [input.worldId, input.commandId],
        )
      ).rows[0];
      // The world lock serializes allocation and replay, including old random IDs.
      const command = {
        ...input,
        id: input.id ?? previous?.request_payload?.id ?? randomUUID(),
      };
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            'note.saved',
            command.worldId,
            command.id ?? null,
            command.expectedVersion,
            command.title,
            command.text,
          ]),
        )
        .digest('hex');
      if (previous) {
        if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
        if (!previous.result_state) throw new DomainError('VERSION_CONFLICT');
        // world_notes is mutable: a later edit must not change an old receipt.
        // Rebuild only this note from immutable committed events, including legacy
        // compact receipts. New IDs need not start with expectedVersion=0, so use
        // the same reducer rather than guessing note.version from that field.
        const events = await sql.query(
          `SELECT payload FROM parallel_life.world_events
           WHERE world_id=$1 AND version<=$2 AND payload->>'type'='note.saved'
             AND payload->'data'->>'id'=$3 ORDER BY version`,
          [command.worldId, previous.result_state.version, command.id],
        );
        let replayed: WorldState = { ...previous.result_state, notes: [] };
        let foundReceipt = false;
        for (const row of events.rows) {
          const saved = row.payload as NoteEvent;
          replayed = applyNoteEvent({ ...replayed, version: saved.version - 1 }, saved);
          if (saved.id === previous.result_event_id && saved.commandId === command.commandId) {
            foundReceipt = true;
            break;
          }
        }
        const note = replayed.notes?.find((item) => item.id === command.id);
        if (!foundReceipt || !note) throw new DomainError('NOT_FOUND');
        return { worldId: command.worldId, version: previous.result_state.version, note };
      }
      // Note versions are separate; the world row is already locked above.
      await authorizeWorldCommandInTransaction(sql, session.userId, {
        worldId: command.worldId,
        commandId: command.commandId,
        expectedWorldVersion: current.version,
        kind: 'note_save',
      });
      const id = command.id;
      const event: NoteEvent = {
        schemaVersion: 1,
        type: 'note.saved',
        id: randomUUID(),
        worldId: command.worldId,
        commandId: command.commandId,
        version: current.version + 1,
        occurredAt: new Date().toISOString(),
        storyTime: current.time,
        data: command,
      };
      if (JSON.stringify(event).length >= 65536)
        throw new DomainError('INVALID_COMMAND', 'Event payload exceeded capacity budget');
      const state = applyNoteEvent(await this.hydrate(sql, current), event);
      const note = (state.notes ?? []).find((item) => item.id === id);
      if (!note) throw new DomainError('INVALID_COMMAND');
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [command.commandId, state.id, session.userId, current.version, hash, event.data],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          event.id,
          state.id,
          session.userId,
          event.version,
          event.commandId,
          event,
          event.occurredAt,
        ],
      );
      // IDs remain globally unique, but edits are scoped to this owner AND world.
      // A conflicting ID (including an RLS-hidden row) must never update another
      // world's note. DO NOTHING also handles concurrent first saves safely.
      const values = [note.id, state.id, session.userId, command.commandId, hash, note];
      const updated = await sql.query(
        `UPDATE parallel_life.world_notes
         SET command_id=$4,request_hash=$5,document=$6,updated_at=now()
         WHERE id=$1 AND world_id=$2 AND owner_id=$3 RETURNING id`,
        values,
      );
      if (!updated.rowCount) {
        const inserted = await sql.query(
          `INSERT INTO parallel_life.world_notes(id,world_id,owner_id,command_id,request_hash,document)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING id`,
          values,
        );
        if (!inserted.rowCount) throw new DomainError('NOT_FOUND');
      }
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
        [state.id, state.version, compactWorldState(state)],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
        [state.id, command.commandId, event.id, compactWorldState(state)],
      );
      await projectAgentWorldChange(sql, session.userId, state.id, event.id);
      return { worldId: state.id, version: state.version, note };
    });
  }
  async get(session: Session, id: string) {
    return this.db.transaction(session.userId, async (sql) =>
      this.hydrate(sql, await this.owned(sql, id)),
    );
  }
  private async saved(sql: SqlClient, command: TurnCommand): Promise<CommitResult | null> {
    const row = (
      await sql.query(
        'SELECT c.request_hash,c.result_state,e.payload FROM parallel_life.commands c LEFT JOIN parallel_life.world_events e ON e.id=c.result_event_id WHERE c.world_id=$1 AND c.id=$2',
        [command.worldId, command.id],
      )
    ).rows[0];
    if (!row) return null;
    if (row.request_hash !== fingerprint(command)) throw new DomainError('IDEMPOTENCY_CONFLICT');
    if (!row.payload) return null;
    return { state: await this.hydrate(sql, row.result_state), event: row.payload };
  }
  async receipt(session: Session, command: TurnCommand) {
    return this.db.transaction(session.userId, async (sql) => {
      await this.owned(sql, command.worldId);
      return this.saved(sql, command);
    });
  }
  async commit(
    session: Session,
    command: TurnCommand,
    event: WorldEvent,
    progress?: { goalKeys: string[]; assessments: EventGoalAssessment[] },
  ) {
    return this.db.transaction(session.userId, (sql) =>
      this.commitInTransaction(sql, session, command, event, progress),
    );
  }
  /** Application UoW may combine the world event with persistent NPC state on this same connection. */
  async commitInTransaction(
    sql: SqlClient,
    session: Session,
    command: TurnCommand,
    event: WorldEvent,
    progress?: { goalKeys: string[]; assessments: EventGoalAssessment[] },
    options: { legacyProgress?: boolean } = {},
  ) {
    const current = await this.owned(sql, command.worldId, true),
      saved = await this.saved(sql, command);
    if (saved) return saved;
    if (current.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
    if (command.origin === 'director') {
      const cancelled = (
        await sql.query(
          "SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 AND status IN ('skipped','expired')",
          [command.worldId, session.userId, command.id],
        )
      ).rowCount;
      if (cancelled)
        throw new DomainError('INVALID_COMMAND', '这段发送已被结束，不能再保存晚到的结果。');
    }
    if (
      event.commandId !== command.id ||
      event.worldId !== command.worldId ||
      event.data.actorId !== command.actorId ||
      event.data.userText !== command.text ||
      event.data.origin !== command.origin
    )
      throw new DomainError('INVALID_COMMAND');
    if (JSON.stringify(event).length >= 65536)
      throw new DomainError('INVALID_COMMAND', 'Event payload exceeded capacity budget');
    if (event.data.agentRuntime) {
      const runtime = event.data.agentRuntime;
      const input = (
        await sql.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [command.worldId, session.userId, runtime.inputReceiptId],
        )
      ).rows[0]?.document;
      const fence = (
        await sql.query("SELECT current_setting('app.agent_commit_attempt_id',true) AS attempt")
      ).rows[0]?.attempt;
      if (
        options.legacyProgress !== false ||
        !fence ||
        !input ||
        input.text !== command.text ||
        input.storyAt !== runtime.inputStoryAt ||
        input.expectedWorldVersion !== runtime.inputWorldVersion ||
        (input.origin === 'player') !== (command.origin === undefined) ||
        event.data.userAt !== input.storyAt
      )
        throw new DomainError('INVALID_COMMAND', 'Invalid accepted input basis');
    }
    const hydrated = await this.hydrate(sql, current);
    validateCharacterEffects(
      command.actorId,
      parseProposal({ schemaVersion: 1, effects: event.data.effects }).effects,
      false,
      command.origin,
    );
    if (
      event.data.effects.some((effect) => effect.type === 'information.shared') &&
      event.data.disclosurePolicyVersion !== 2
    )
      throw new DomainError('INVALID_PROPOSAL', 'Disclosure policy version required');
    const { state, jobs } = applyEvent(hydrated, event);
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
      [
        command.id,
        command.worldId,
        session.userId,
        command.expectedVersion,
        fingerprint(command),
        command,
      ],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [event.id, state.id, session.userId, event.version, command.id, event, event.occurredAt],
    );
    for (const message of state.messages.filter((x) => x.sourceEventId === event.id))
      await sql.query(
        'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
        [message.id, state.id, session.userId, message.actorId, message],
      );
    for (const appointment of state.appointments.filter((x) => x.sourceEventId === event.id))
      await sql.query(
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
        [appointment.id, state.id, session.userId, appointment],
      );
    for (const effect of event.data.effects ?? [])
      if (effect.type === 'appointment.fulfilled') {
        const item = state.appointments.find((a) => a.id === effect.appointmentId);
        if (item)
          await sql.query(
            'UPDATE parallel_life.world_appointments SET document=$4 WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [state.id, session.userId, item.id, item],
          );
      }
    for (const media of state.mediaRequests.filter((x) => x.sourceEventId === event.id))
      await sql.query(
        'INSERT INTO parallel_life.world_media_requests(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
        [media.id, state.id, session.userId, media],
      );
    for (const [ordinal, fact] of state.facts
      .filter((item) => item.sourceEventId === event.id)
      .entries())
      await sql.query(
        'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
        [fact.id, state.id, session.userId, ordinal, fact],
      );
    for (const job of jobs)
      await sql.query(
        'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
        [job.id, state.id, session.userId, event.id, job],
      );
    /*
  记忆接线：角色这一轮自己的印象进入 character 作用域，这一轮发生的事进入
  branch 作用域（来源=真实消息/事件 id）。抽取不额外调用模型；同一句话重复
  出现时由写入层合并来源。
  */
    await storeTurnMemories(sql, session.userId, state, event);
    const snapshot = compactWorldState(state);
    /* A clear failure beats an opaque CHECK violation that rolls back everything. */
    if (JSON.stringify(snapshot).length >= 262144)
      throw new DomainError('INVALID_COMMAND', 'World snapshot exceeded its capacity budget');
    await sql.query(
      'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
      [state.id, state.version, snapshot],
    );
    if (event.storyAt && event.data.origin !== 'director')
      await sql.query(
        `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,last_tick_at)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(world_id) DO UPDATE SET
         story_now=GREATEST(parallel_life.world_clock.story_now,EXCLUDED.story_now),
         last_tick_at=GREATEST(parallel_life.world_clock.last_tick_at,EXCLUDED.last_tick_at),
         updated_at=now()`,
        [state.id, session.userId, event.storyAt, event.occurredAt],
      );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
      [state.id, command.id, event.id, snapshot],
    );
    if (options.legacyProgress !== false) {
      // Introduction and private progress reconcile on the same successful source
      // transaction. No nested connection can observe half an NPC reply.
      await new PublicationStoryRepository(this.db).reconcileInTransaction(
        sql,
        session.userId,
        state.id,
      );
      // Reconciliation may append a sourced place-discovery event on this connection.
      // Its newer world version must also govern the following progress assessment.
      const reconciled = await this.hydrate(sql, await this.owned(sql, state.id));
      const recalled = await loadActorMemories(sql, session.userId, {
        actorId: command.actorId,
        worldId: state.id,
      });
      const scoped = actorContext(
        reconciled,
        command.actorId,
        command.text,
        recalled.records,
        recalled.blockedSources,
      );
      await applyActorEventAssessments(
        sql,
        session.userId,
        scoped,
        event.id,
        progress?.assessments ?? [],
        progress?.goalKeys ?? [],
        command.origin === 'director' ? undefined : command.text,
        command.origin === 'director',
        recalled.blockedSources,
      );
      const finalState = await this.hydrate(sql, await this.owned(sql, state.id));
      const finalSnapshot = compactWorldState(finalState);
      if (JSON.stringify(finalSnapshot).length >= 262144)
        throw new DomainError('INVALID_COMMAND', 'World snapshot exceeded capacity budget');
      // Freeze the complete causal result while retaining the original NPC event identity.
      // Later commands must never change the state returned by this command's replay.
      const finalized = await sql.query(
        "UPDATE parallel_life.commands SET result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2 AND owner_id=$3 AND status='succeeded' AND result_event_id=$5",
        [state.id, command.id, session.userId, finalSnapshot, event.id],
      );
      if (finalized.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
      return { state: finalState, event };
    }
    return { state, event };
  }

  async listUserWorlds(
    userId: string,
    options?: { status?: 'all' | 'active' | 'archived' },
  ): Promise<WorldListItem[]> {
    const filter = options?.status ?? 'active';
    return this.db.transaction(userId, async (sql) => {
      let whereExtra = '';
      if (filter === 'active') {
        whereExtra = "AND (w.state->>'deletedAt') IS NULL AND (w.state->>'archivedAt') IS NULL";
      } else if (filter === 'archived') {
        whereExtra = "AND (w.state->>'deletedAt') IS NULL AND (w.state->>'archivedAt') IS NOT NULL";
      } else if (filter === 'all') {
        whereExtra = "AND (w.state->>'deletedAt') IS NULL";
      }

      const rows = (
        await sql.query(
          `SELECT w.id, w.title, w.version, w.created_at, w.updated_at, w.state,
                  w.parent_world_id, w.fork_version,
                  s.document->'source'->>'kind' as seed_source_kind,
                  b.opening
           FROM parallel_life.worlds w
           LEFT JOIN parallel_life.world_builds b ON b.world_id = w.id
           LEFT JOIN parallel_life.approved_seeds s ON s.id = b.seed_id
           WHERE w.owner_id = $1 ${whereExtra}
           ORDER BY w.updated_at DESC`,
          [userId],
        )
      ).rows;

      const clockStore = new PostgresClockStore(this.db);

      const items: WorldListItem[] = [];
      for (const row of rows) {
        const state = (row.state ?? {}) as Record<string, any>;
        const archivedAt = state.archivedAt ?? null;
        const status = state.deletedAt ? 'deleted' : archivedAt ? 'archived' : 'active';
        const actorCount = Array.isArray(state.actors) ? state.actors.length : 0;

        let sourceKind: 'custom' | 'official' | 'published' | 'unknown' = 'unknown';
        const rawKind = row.seed_source_kind;
        if (rawKind === 'official_life') sourceKind = 'official';
        else if (rawKind === 'published_work' || rawKind === 'publication_trial')
          sourceKind = 'published';
        else if (rawKind) sourceKind = 'custom';
        else if (row.opening) sourceKind = 'published';
        else sourceKind = 'custom';

        let storyTime: string | undefined = state.time;
        try {
          const clock = await clockStore.read(userId, row.id);
          storyTime = projectStoryTime(clock, new Date().toISOString());
        } catch {
          // fallback to state.time
        }

        let previewText: string | undefined = undefined;
        if (Array.isArray(state.messages) && state.messages.length > 0) {
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg?.text) previewText = lastMsg.text;
        }
        if (!previewText && state.setting) {
          previewText = typeof state.setting === 'string' ? state.setting : undefined;
        }

        items.push({
          id: row.id,
          title: row.title,
          version: Number(row.version),
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          storyTime,
          status,
          archivedAt: archivedAt ? new Date(archivedAt).toISOString() : null,
          actorCount,
          previewText,
          sourceKind,
          parentWorldId: row.parent_world_id ?? null,
          forkVersion:
            row.fork_version !== null && row.fork_version !== undefined
              ? Number(row.fork_version)
              : null,
        });
      }

      return items;
    });
  }

  async renameWorld(
    userId: string,
    worldId: string,
    newTitle: string,
  ): Promise<{ id: string; title: string; version: number }> {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed.length > 60) {
      throw new DomainError('INVALID_COMMAND', 'INVALID_COMMAND: 标题长度必须在 1 到 60 字符之间');
    }
    return this.db.transaction(userId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT state, version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
          [worldId, userId],
        )
      ).rows[0];
      if (!row || row.state?.deletedAt) throw new DomainError('NOT_FOUND');

      await sql.query(
        `UPDATE parallel_life.worlds
         SET title = $3,
             state = jsonb_set(state, '{title}', to_jsonb($3::text)),
             updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [worldId, userId, trimmed],
      );

      return {
        id: worldId,
        title: trimmed,
        version: Number(row.version),
      };
    });
  }

  async archiveWorld(
    userId: string,
    worldId: string,
  ): Promise<{ id: string; status: 'archived'; archivedAt: string }> {
    return this.db.transaction(userId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
          [worldId, userId],
        )
      ).rows[0];
      if (!row || row.state?.deletedAt) throw new DomainError('NOT_FOUND');

      const nowIso = new Date().toISOString();
      await sql.query(
        `UPDATE parallel_life.worlds
         SET state = jsonb_set(state, '{archivedAt}', to_jsonb($3::text)),
             updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [worldId, userId, nowIso],
      );

      await sql.query(
        `UPDATE parallel_life.world_clock
         SET paused = true, updated_at = now()
         WHERE world_id = $1 AND owner_id = $2`,
        [worldId, userId],
      );

      return {
        id: worldId,
        status: 'archived',
        archivedAt: nowIso,
      };
    });
  }

  async restoreWorld(userId: string, worldId: string): Promise<{ id: string; status: 'active' }> {
    return this.db.transaction(userId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
          [worldId, userId],
        )
      ).rows[0];
      if (!row || row.state?.deletedAt) throw new DomainError('NOT_FOUND');

      await sql.query(
        `UPDATE parallel_life.worlds
         SET state = state - 'archivedAt',
             updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [worldId, userId],
      );

      return {
        id: worldId,
        status: 'active',
      };
    });
  }

  async deleteWorld(userId: string, worldId: string): Promise<{ id: string; status: 'deleted' }> {
    return this.db.transaction(userId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
          [worldId, userId],
        )
      ).rows[0];
      if (!row || row.state?.deletedAt) throw new DomainError('NOT_FOUND');

      const nowIso = new Date().toISOString();
      await sql.query(
        `UPDATE parallel_life.worlds
         SET state = jsonb_set(state, '{deletedAt}', to_jsonb($3::text)),
             updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [worldId, userId, nowIso],
      );

      await sql.query(
        `UPDATE parallel_life.world_clock
         SET paused = true, updated_at = now()
         WHERE world_id = $1 AND owner_id = $2`,
        [worldId, userId],
      );

      return {
        id: worldId,
        status: 'deleted',
      };
    });
  }

  async getForkCheckpoints(userId: string, worldId: string): Promise<WorldForkCheckpointsResponse> {
    return this.db.transaction(userId, async (sql) => {
      const parentRow = (
        await sql.query(
          'SELECT id, title, version, created_at, state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2',
          [worldId, userId],
        )
      ).rows[0];
      if (!parentRow || parentRow.state?.deletedAt) throw new DomainError('NOT_FOUND');

      const initial = (
        await sql.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
          [worldId, userId],
        )
      ).rows[0]?.state;

      const eventRows = (
        await sql.query(
          'SELECT version, payload, occurred_at FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version ASC',
          [worldId],
        )
      ).rows;

      const checkpoints: WorldForkCheckpoint[] = [];

      checkpoints.push({
        version: 0,
        occurredAt: new Date(parentRow.created_at).toISOString(),
        storyTime: initial?.time ?? undefined,
        summary: '初始基线',
      });

      for (const row of eventRows) {
        const payload = (row.payload ?? {}) as Record<string, any>;
        const userText = payload.data?.userText;
        const firstMessage = payload.data?.effects?.find(
          (e: any) => e.type === 'message.received',
        )?.text;
        const summary = userText || firstMessage || payload.type || `版本 ${row.version}`;
        checkpoints.push({
          version: Number(row.version),
          occurredAt: new Date(row.occurred_at).toISOString(),
          storyTime: payload.storyAt ?? payload.occurredAt ?? undefined,
          summary: String(summary).slice(0, 100),
        });
      }

      return {
        worldId,
        currentVersion: Number(parentRow.version),
        title: parentRow.title,
        checkpoints,
      };
    });
  }

  async forkWorld(
    userId: string,
    parentWorldId: string,
    forkVersion: number,
    options?: { title?: string },
  ): Promise<{
    id: string;
    parentWorldId: string;
    forkVersion: number;
    title: string;
    version: number;
    status: 'active';
    storyTime?: string;
    createdAt: string;
  }> {
    if (typeof forkVersion !== 'number' || !Number.isInteger(forkVersion) || forkVersion < 0) {
      throw new DomainError('INVALID_COMMAND', 'Invalid fork version');
    }

    return this.db.transaction(userId, async (sql) => {
      const parentRow = (
        await sql.query(
          'SELECT id, title, version, asset_revision, state, parent_world_id, fork_version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
          [parentWorldId, userId],
        )
      ).rows[0];
      if (!parentRow || parentRow.state?.deletedAt) throw new DomainError('NOT_FOUND');

      if (forkVersion > Number(parentRow.version)) {
        throw new DomainError(
          'INVALID_COMMAND',
          `Fork version ${forkVersion} exceeds current world version ${parentRow.version}`,
        );
      }

      let targetTitle: string;
      if (options?.title !== undefined) {
        const trimmed = options.title.trim();
        if (!trimmed || trimmed.length > 60) {
          throw new DomainError(
            'INVALID_COMMAND',
            'World title must be between 1 and 60 characters',
          );
        }
        targetTitle = trimmed;
      } else {
        targetTitle = `${parentRow.title} (分支)`.slice(0, 60);
      }

      const initialRow = (
        await sql.query(
          'SELECT state, approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
          [parentWorldId, userId],
        )
      ).rows[0];
      if (!initialRow) throw new DomainError('NOT_FOUND', 'Parent initial snapshot not found');

      const parentInitialState = initialRow.state as WorldState;
      let approvedSeed = structuredClone(initialRow.approved_seed ?? {});

      // Controlled resource reference verification for approved_seed
      if (approvedSeed && typeof approvedSeed === 'object') {
        if (approvedSeed.portraitAssetId) {
          const assetOk = (
            await sql.query(
              "SELECT 1 FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND status='ready'",
              [approvedSeed.portraitAssetId, userId],
            )
          ).rowCount;
          if (!assetOk) {
            delete approvedSeed.portraitAssetId;
          }
        }
        if (Array.isArray(approvedSeed.assets)) {
          const validatedAssets = [];
          for (const item of approvedSeed.assets) {
            if (item?.assetId) {
              const assetOk = (
                await sql.query(
                  "SELECT 1 FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND status='ready'",
                  [item.assetId, userId],
                )
              ).rowCount;
              if (assetOk) validatedAssets.push(item);
            }
          }
          approvedSeed.assets = validatedAssets;
        }
      }

      const newWorldId = randomUUID();
      let rebuiltWorld: WorldState;
      let projectedMessages: any[] = [];
      let projectedAppointments: any[] = [];
      let projectedMediaRequests: any[] = [];
      let projectedFacts: any[] = [];

      if (forkVersion === 0) {
        rebuiltWorld = structuredClone(parentInitialState);
      } else {
        const events = (
          await sql.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version<=$2 ORDER BY version',
            [parentWorldId, forkVersion],
          )
        ).rows.map((r) => r.payload) as WorldHistoryEvent[];

        rebuiltWorld = replayWorldHistory(
          parentInitialState,
          events,
          forkVersion,
          await readPublicationInvitationLinks(sql, userId, parentWorldId),
        ).world;

        const msgRows = (
          await sql.query(
            `SELECT p.document FROM parallel_life.world_messages p
             JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id
             WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version, p.ordinal`,
            [parentWorldId, forkVersion],
          )
        ).rows;
        projectedMessages = msgRows.map((r) => r.document);

        const apptRows = (
          await sql.query(
            `SELECT p.document FROM parallel_life.world_appointments p
             JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id
             WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version, p.id`,
            [parentWorldId, forkVersion],
          )
        ).rows;
        projectedAppointments = apptRows.map((r) => r.document);

        const mediaRows = (
          await sql.query(
            `SELECT p.document FROM parallel_life.world_media_requests p
             JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id
             WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version, p.id`,
            [parentWorldId, forkVersion],
          )
        ).rows;
        projectedMediaRequests = mediaRows.map((r) => r.document);

        const factRows = (
          await sql.query(
            `SELECT p.document FROM parallel_life.world_facts p
             JOIN parallel_life.world_events e ON e.id=p.document->>'sourceEventId' AND e.world_id=p.world_id
             WHERE p.world_id=$1 AND e.version<=$2 ORDER BY e.version, p.ordinal`,
            [parentWorldId, forkVersion],
          )
        ).rows;
        projectedFacts = factRows.map((r) => r.document);
      }

      const newBaselineState: WorldState = {
        ...rebuiltWorld,
        id: newWorldId,
        ownerId: userId,
        title: targetTitle,
        version: 0,
        time: rebuiltWorld.time ?? parentInitialState.time ?? new Date().toISOString(),
        messages: [
          ...openingMessagesForDisplay(
            parentInitialState.messages ?? [],
            newWorldId,
            parentInitialState.time ?? rebuiltWorld.time,
          ),
          ...projectedMessages,
        ],
        appointments: mergeAppointments(
          parentInitialState.appointments ?? [],
          projectedAppointments,
        ),
        mediaRequests: [...(parentInitialState.mediaRequests ?? []), ...projectedMediaRequests],
        facts: retainFacts(dedupeFacts([...(parentInitialState.facts ?? []), ...projectedFacts])),
      };

      const compacted = compactWorldState(newBaselineState);
      await sql.query(
        `INSERT INTO parallel_life.worlds(id, owner_id, title, version, asset_revision, state, parent_world_id, fork_version)
         VALUES($1, $2, $3, 0, $4, $5, $6, $7)`,
        [
          newWorldId,
          userId,
          targetTitle,
          parentRow.asset_revision ?? 0,
          compacted,
          parentWorldId,
          forkVersion,
        ],
      );

      await sql.query(
        `INSERT INTO parallel_life.world_initial_snapshots(world_id, owner_id, version, state, approved_seed)
         VALUES($1, $2, 0, $3, $4)`,
        [newWorldId, userId, newBaselineState, approvedSeed],
      );

      await sql.query(
        `INSERT INTO parallel_life.world_clock(world_id, owner_id, story_now, last_tick_at, speed, paused)
         VALUES($1, $2, $3, now(), 1, false)
         ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now, updated_at=now()`,
        [newWorldId, userId, newBaselineState.time],
      );

      const parentBindings = (
        await sql.query(
          `SELECT person_id, actor_id, person_snapshot, asset_id, asset_revision
           FROM parallel_life.world_person_bindings
           WHERE world_id=$1 AND owner_id=$2`,
          [parentWorldId, userId],
        )
      ).rows;
      if (parentBindings.length > 0) {
        for (const b of parentBindings) {
          let validAssetId = b.asset_id;
          let validRevision = b.asset_revision;
          if (validAssetId) {
            const ok = (
              await sql.query(
                "SELECT 1 FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND status='ready'",
                [validAssetId, userId],
              )
            ).rowCount;
            if (!ok) {
              validAssetId = null;
              validRevision = null;
            }
          }
          try {
            await sql.query(
              `INSERT INTO parallel_life.world_person_bindings(world_id, owner_id, person_id, actor_id, person_snapshot, asset_id, asset_revision)
               VALUES($1, $2, $3, $4, $5, $6, $7)`,
              [
                newWorldId,
                userId,
                b.person_id,
                b.actor_id,
                b.person_snapshot,
                validAssetId,
                validRevision,
              ],
            );
          } catch {
            // graceful fallback if table lacks insert for current role
          }
        }
      }

      const nowIso = new Date().toISOString();
      return {
        id: newWorldId,
        parentWorldId,
        forkVersion,
        title: targetTitle,
        version: 0,
        status: 'active' as const,
        storyTime: newBaselineState.time,
        createdAt: nowIso,
      };
    });
  }
}
