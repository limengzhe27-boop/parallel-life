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
import { validateCharacterEffects } from '../domain/character-policy.ts';
import { parseProposal } from '../domain/validation.ts';
import { projectStoryTime } from '../domain/clock.ts';
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
    (effect) => effect.type === 'belief.recorded' && effect.actorId && effect.text,
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
function compact(state: WorldState) {
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
        [state.id, session.userId, state.title, compact(state)],
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
    if (!row) throw new DomainError('NOT_FOUND');
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
      appointments: [...(initial?.appointments ?? []), ...results[1]!],
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
      const clockRow = (
        await sql.query(
          'SELECT story_now,speed,paused,last_tick_at FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
          [command.worldId, session.userId],
        )
      ).rows[0];
      const realNow = new Date().toISOString();
      const projected = clockRow
        ? projectStoryTime(
            {
              storyNow: new Date(clockRow.story_now).toISOString(),
              speed: Number(clockRow.speed),
              paused: Boolean(clockRow.paused),
              lastTickAt: new Date(clockRow.last_tick_at).toISOString(),
              missedBeats: 0,
              summary: null,
            },
            realNow,
          )
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
      const state = applyInvitationEvent(
        { ...(await this.hydrate(sql, current)), time: storyTime },
        event,
      );
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
        [state.id, state.version, compact(state)],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
        [state.id, command.commandId, event.id, compact(state)],
      );
      return state;
    });
  }
  /**
   * The user saving their own phone note. Persisted in the world_notes projection
   * (not in the world snapshot) with the same receipt/event discipline as other
   * commands: replaying the same command id returns the original note.
   */
  async saveNote(session: Session, command: NoteCommand & { commandId: string; id: string }) {
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
        const replayed = await this.hydrate(sql, previous.result_state);
        const note = replayed.notes?.find((item) => item.id === command.id);
        if (!note) throw new DomainError('NOT_FOUND');
        return { worldId: replayed.id, version: replayed.version, note };
      }
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
      await sql.query(
        `INSERT INTO parallel_life.world_notes(id,world_id,owner_id,command_id,request_hash,document)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET command_id=EXCLUDED.command_id,request_hash=EXCLUDED.request_hash,document=EXCLUDED.document,updated_at=now()`,
        [note.id, state.id, session.userId, command.commandId, hash, note],
      );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1',
        [state.id, state.version, compact(state)],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
        [state.id, command.commandId, event.id, compact(state)],
      );
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
  async commit(session: Session, command: TurnCommand, event: WorldEvent) {
    return this.db.transaction(session.userId, async (sql) => {
      const current = await this.owned(sql, command.worldId, true),
        saved = await this.saved(sql, command);
      if (saved) return saved;
      if (current.version !== command.expectedVersion) throw new DomainError('VERSION_CONFLICT');
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
      const hydrated = await this.hydrate(sql, current);
      validateCharacterEffects(
        command.actorId,
        parseProposal({ schemaVersion: 1, effects: event.data.effects }).effects,
      );
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
      const snapshot = compact(state);
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
      return { state, event };
    });
  }
}
