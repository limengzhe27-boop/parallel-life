import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { authorizeWorldCommandInTransaction } from './world-command-uow.ts';
import { randomUUID } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { StoryWaitPort } from '../application/story-wait.ts';
import { requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { DomainError } from '../domain/errors.ts';
import { PostgresWorldRepository } from './postgres-world-repository.ts';
import { lockWorldActivity, assertSpaceIdle } from './space-repository.ts';
import { storedActivityClock, updateClockActivity } from './clock-activity-repository.ts';
import {
  buildStoryPlan,
  evaluateStory,
  eligibleStoryActors,
  legalPresentation,
  storyNodeWindow,
  storyStateOutcome,
  type StorySource,
  type StoryState,
} from '../../settings/domain/publication-story.ts';
import {
  validateStoryWaitInput,
  planStoryWait,
  storyWaitFrom,
  applyStoryWaitEvent,
  storyWaitReceipt,
  StoryWaitError,
  type StoryWaitInput,
  type StoryWaitReceipt,
  type StoryWaitBoundary,
  type StoryWaitEvent,
  type StoryWaitContext,
} from '../domain/story-wait.ts';
import { publicationGoalContexts } from '../../settings/infrastructure/publication-event-goal-context.ts';
import type { WorldState } from '../domain/types.ts';

/** No model, lazy story initialization, invented message or scene entry. */
export class PostgresStoryWaitRepository implements StoryWaitPort {
  private readonly db: PostgresDatabase;
  private readonly options: { now?: () => string; newId?: () => string };
  constructor(db: PostgresDatabase, options: { now?: () => string; newId?: () => string } = {}) {
    this.db = db;
    this.options = options;
  }
  private async replay(
    sql: SqlClient,
    ownerId: string,
    worldId: string,
    input: StoryWaitInput,
    hash: string,
  ) {
    const row = (
      await sql.query(
        'SELECT request_hash,document FROM parallel_life.story_wait_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
        [worldId, ownerId, input.commandId],
      )
    ).rows[0];
    if (row) {
      if (row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT');
      return row.document as StoryWaitReceipt;
    }
    if (
      (
        await sql.query(
          'SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [worldId, ownerId, input.commandId],
        )
      ).rowCount
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    return null;
  }
  /** Reuse the event ledger's shared terminal state; an individual withdrawal is insufficient. */
  private async resolvedProgress(
    sql: SqlClient,
    ownerId: string,
    world: WorldState,
    states: StoryState[],
    observedStoryAt: string,
  ) {
    if (
      !(
        await sql.query(
          `SELECT 1 FROM parallel_life.publication_story_progress
      WHERE world_id=$1 AND owner_id=$2 AND world_version<=$3 AND state->>'phase'='resolved' LIMIT 1`,
          [world.id, ownerId, world.version],
        )
      ).rowCount
    )
      return;
    const contexts = await publicationGoalContexts(sql, ownerId, world.id, world.version);
    for (const context of contexts) {
      const p = context.progress;
      const state = states.find((s) => s.nodeKey === context.record.node.key);
      if (
        !state ||
        p.phase !== 'resolved' ||
        !p.resolution ||
        !p.lastSourceEventId ||
        state.sourceEventId !== context.record.state.sourceEventId ||
        state.sourceMessageId !== context.record.state.sourceMessageId
      )
        continue;
      const eventIds = [
        ...new Set(
          [
            p.lastSourceEventId,
            state.sourceEventId,
            ...Object.values(p.actorGoalStatusSources).flatMap((ids) =>
              ids.length ? [ids[0]!] : [],
            ),
            ...Object.values(p.criterionSources).flat(),
            ...context.value.definition.goals.flatMap((g) =>
              g.anchorSourceIds?.[0] ? [g.anchorSourceIds[0]] : [],
            ),
          ].filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const proofIds = [
        ...new Set(
          [
            ...eventIds,
            state.sourceMessageId,
            ...Object.values(p.actorGoalStatusSources).flat(),
            ...context.value.definition.goals.flatMap((g) => g.anchorSourceIds ?? []),
          ].filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const sources = (
        await sql.query(
          `SELECT e.id,e.version,e.command_id,e.payload FROM parallel_life.world_events e
        JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id
        WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND e.id=ANY($4::text[])`,
          [world.id, ownerId, world.version, eventIds],
        )
      ).rows;
      if (
        sources.length !== eventIds.length ||
        sources.some((e) => {
          const at = e.payload.storyAt ?? e.payload.storyTime;
          return (
            typeof at !== 'string' ||
            !Number.isFinite(Date.parse(at)) ||
            Date.parse(at) > Date.parse(observedStoryAt)
          );
        })
      )
        continue;
      const last = sources.find((e) => e.id === p.lastSourceEventId);
      if (
        !last ||
        !Number.isSafeInteger(p.cursorVersion) ||
        last.version > p.cursorVersion ||
        p.cursorVersion > world.version ||
        sources.some((e) => e.version > p.cursorVersion)
      )
        continue;
      const proof = await sql.query(
        `SELECT 1 FROM parallel_life.publication_story_progress p
        JOIN parallel_life.publication_story_progress_evidence v ON v.world_id=p.world_id AND v.owner_id=p.owner_id
          AND v.node_key=p.node_key AND v.source_event_id=p.state->>'lastSourceEventId'
        WHERE p.world_id=$1 AND p.owner_id=$2 AND p.node_key=$3 AND p.world_version<=$4
          AND p.state->>'phase'='resolved' AND p.state->>'lastSourceEventId'=$5
          AND (p.state->>'cursorVersion')::int=$6 AND v.world_version=$9 AND v.command_id=$10
          AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records r WHERE r.owner_id=p.owner_id AND r.status='forgotten'
            AND ((r.scope_type='branch' AND r.scope_id=p.world_id) OR (r.scope_type='character' AND r.character_id=ANY($7::text[])))
            AND (r.source_ids ?| $8::text[] OR EXISTS(
              SELECT 1 FROM parallel_life.publication_story_progress_evidence forgotten_source
              WHERE forgotten_source.world_id=p.world_id AND forgotten_source.owner_id=p.owner_id
                AND forgotten_source.node_key=p.node_key AND forgotten_source.source_event_id=ANY($11::text[])
                AND (forgotten_source.source_event_id=$5 OR forgotten_source.criterion_ids ?| $12::text[])
                AND r.source_ids ? forgotten_source.source_record_id))) LIMIT 1`,
        [
          world.id,
          ownerId,
          state.nodeKey,
          world.version,
          p.lastSourceEventId,
          p.cursorVersion,
          context.value.definition.goals.map((g) => g.actorId),
          proofIds,
          last.version,
          last.command_id,
          eventIds,
          Object.keys(p.criterionSources).filter((key) => p.criterionSources[key]!.length > 0),
        ],
      );
      if (proof.rowCount)
        state.progressResolution = { resolution: p.resolution, sourceEventId: p.lastSourceEventId };
    }
  }
  private async context(
    sql: SqlClient,
    ownerId: string,
    world: WorldState,
    base: StoryWaitContext,
    targetAt: string,
    engineEpoch: number,
  ) {
    const raw = (
      await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [world.id])
    ).rows[0].source as StorySource | null;
    const rows = (
      await sql.query(
        'SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2',
        [world.id, ownerId],
      )
    ).rows;
    const states: StoryState[] = rows.map((r) => ({
      nodeKey: r.node_key,
      claimId: r.claim_id,
      commandId: r.command_id,
      actorId: r.actor_id,
      expectedVersion: r.expected_version,
      status: r.status,
      outcome: r.outcome,
      storyAt: new Date(r.story_at).toISOString(),
      automatic: r.automatic,
      sourceEventId: r.source_event_id,
      sourceMessageId: r.source_message_id,
      invitationId: r.invitation_id,
      responseEventId: r.response_event_id,
    }));
    const batch = (
      await sql.query(
        'SELECT status FROM parallel_life.publication_opening_batches WHERE world_id=$1 AND owner_id=$2',
        [world.id, ownerId],
      )
    ).rows[0];
    const deliveryBusy = Boolean(
      (
        await sql.query(
          "SELECT 1 FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2 AND status IN ('sending','unknown') LIMIT 1",
          [world.id, ownerId],
        )
      ).rowCount,
    );
    if (batch?.status === 'planning' || batch?.status === 'unknown' || deliveryBusy)
      throw new StoryWaitError('INFLIGHT');
    const from = storyWaitFrom(world, base);
    // The legacy goal interpreter can reconcile/write its own progress. Never run
    // it for an Agent world; its immutable authored time boundaries remain read-only.
    if (raw && engineEpoch === 1) await this.resolvedProgress(sql, ownerId, world, states, from);
    // A genuine, dated decision request is important. Client-only unread markers are not evidence.
    const pendingIds = world.appointments
      .filter((a) => a.status === 'proposed' && Date.parse(a.at) >= Date.parse(from))
      .map((a) => a.id);
    const proposed =
      pendingIds.length > 0 &&
      Boolean(
        (
          await sql.query(
            "SELECT 1 FROM parallel_life.world_appointments a JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.document->>'sourceEventId' WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=ANY($3::text[]) AND e.version<=$4 LIMIT 1",
            [world.id, ownerId, pendingIds, world.version],
          )
        ).rowCount,
      );
    let openingPending = Boolean(batch && batch.status !== 'complete');
    let important = proposed;
    const boundaries: StoryWaitBoundary[] = [];
    if (raw) {
      const plan = buildStoryPlan(raw);
      const initial = (
        await sql.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
          [world.id, ownerId],
        )
      ).rows[0]?.state;
      if (!initial) throw new DomainError('INVALID_COMMAND');
      const facts = (
        await sql.query(
          "SELECT f.id FROM parallel_life.world_facts f JOIN parallel_life.world_events e ON e.world_id=f.world_id AND e.owner_id=f.owner_id AND e.id=f.document->>'sourceEventId' WHERE f.world_id=$1 AND f.owner_id=$2 AND e.version<=$3",
          [world.id, ownerId, world.version],
        )
      ).rows.map((r) => String(r.id));
      const availableFactIds = [...initial.facts.map((f: { id: string }) => f.id), ...facts];
      const atContext = (at: string) => ({
        storyNow: at,
        currentPlaceId: world.space?.currentPlaceId ?? null,
        availableFactIds,
        automatic: false,
      });
      const opening = plan.nodes.find((n) => n.key === plan.openingEventKey);
      const terminal = states.some(
        (s) =>
          s.nodeKey === plan.openingEventKey &&
          ['committed', 'declined', 'skipped', 'expired'].includes(s.status),
      );
      if (!batch && opening && !terminal && legalPresentation(plan, opening, from)) {
        const withoutOpening = states.filter((s) => s.nodeKey !== plan.openingEventKey);
        openingPending =
          eligibleStoryActors(plan, opening, withoutOpening, atContext(from)).length > 0;
      }
      // Explicit required, actually presented work needs resolution; an ordinary greeting does not.
      for (const s of states) {
        const node = plan.nodes.find((n) => n.key === s.nodeKey);
        if (
          !node ||
          node.key === plan.openingEventKey ||
          node.direction?.mode !== 'required' ||
          !['presented', 'offered'].includes(s.status) ||
          storyStateOutcome(s) ||
          !s.sourceEventId ||
          !s.sourceMessageId
        )
          continue;
        const proof = await sql.query(
          "SELECT 1 FROM parallel_life.world_messages m JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId' WHERE m.world_id=$1 AND m.owner_id=$2 AND m.id=$3 AND e.id=$4 AND e.version<=$5 AND m.document->>'role'='assistant' LIMIT 1",
          [world.id, ownerId, s.sourceMessageId, s.sourceEventId, world.version],
        );
        if (proof.rowCount) important = true;
      }
      for (const node of plan.nodes) {
        const times = [
          storyNodeWindow(plan, node)?.notBefore,
          ...node.prerequisites.filter((p) => p.kind === 'not_before').map((p) => p.at),
          ...(node.conditionKeys ?? []).flatMap((key) =>
            (plan.conditions ?? [])
              .filter((g) => g.key === key)
              .flatMap((g) =>
                g.prerequisites.filter((p) => p.kind === 'not_before').map((p) => p.at),
              ),
          ),
        ].filter((at): at is string => Boolean(at));
        // Validate the entire prerequisite set at the boundary, not the timestamp alone.
        for (const at of [...new Set(times)]) {
          const candidateAt = new Date(Math.max(Date.parse(from), Date.parse(at))).toISOString();
          if (Date.parse(candidateAt) > Date.parse(targetAt)) continue;
          if (
            evaluateStory(plan, states, atContext(candidateAt)).eligible.some(
              (n) => n.key === node.key,
            )
          )
            boundaries.push({ at: candidateAt, reason: 'story_boundary' });
        }
      }
    }
    return { ...base, openingPending, importantMessage: important, boundaries };
  }
  async wait(ownerId: string, worldId: string, input: StoryWaitInput) {
    validateStoryWaitInput(input);
    const hash = requestHash(['story.wait', worldId, input]);
    const old = await this.db.transaction(ownerId, async (sql) => {
      if (
        !(
          await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            worldId,
            ownerId,
          ])
        ).rowCount
      )
        throw new DomainError('NOT_FOUND');
      return this.replay(sql, ownerId, worldId, input, hash);
    });
    if (old) return old;
    const snapshot = await new PostgresWorldRepository(this.db).get({ userId: ownerId }, worldId);
    return this.db.transaction(ownerId, async (sql) => {
      await lockWorldActivity(sql, worldId);
      const row = (
        await sql.query(
          'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND');
      const replay = await this.replay(sql, ownerId, worldId, input, hash);
      if (replay) return replay;
      if (Number(row.version) !== input.expectedVersion || snapshot.version !== Number(row.version))
        throw new DomainError('VERSION_CONFLICT');
      const { engineEpoch } = await authorizeWorldCommandInTransaction(sql, ownerId, {
        worldId,
        commandId: input.commandId,
        expectedWorldVersion: input.expectedVersion,
        kind: 'story_wait',
      });
      await assertSpaceIdle(sql, worldId);
      const active = (
        await sql.query(
          'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0]?.current_scene_id;
      if (active) throw new StoryWaitError('ACTIVE_SCENE');
      const rawClock = (
        await sql.query(
          'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0];
      const previous = (
        await sql.query(
          'SELECT sequence FROM parallel_life.world_clock_activity WHERE world_id=$1 AND owner_id=$2 AND client_id=$3 FOR UPDATE',
          [worldId, ownerId, input.clientId],
        )
      ).rows[0];
      if (previous && Number(previous.sequence) >= input.sequence)
        throw new DomainError('VERSION_CONFLICT');
      const observedNow = (this.options.now ?? (() => new Date().toISOString()))();
      const now = new Date(
        Math.max(Date.parse(observedNow), rawClock ? new Date(rawClock.last_tick_at).getTime() : 0),
      ).toISOString();
      const world = { ...snapshot, time: row.state.time, version: Number(row.version) };
      const clock = rawClock
        ? storedActivityClock(rawClock)
        : {
            storyNow: world.time,
            lastTickAt: now,
            speed: 12,
            paused: true,
            missedBeats: 0,
            summary: null,
          };
      const base: StoryWaitContext = {
        clock,
        realNow: now,
        activeScene: false,
        inflight: false,
        openingPending: false,
        importantMessage: false,
        boundaries: [],
      };
      const target = planStoryWait(world, input, base).targetAt;
      const context = await this.context(sql, ownerId, world, base, target, engineEpoch);
      const plan = planStoryWait(world, input, context);
      const event: StoryWaitEvent = {
        schemaVersion: 1,
        type: 'story.waited',
        id: (this.options.newId ?? randomUUID)(),
        worldId,
        commandId: input.commandId,
        version: world.version + 1,
        occurredAt: now,
        storyAt: plan.storyNow,
        data: {
          target: input.target,
          fromStoryAt: plan.fromStoryAt,
          targetAt: plan.targetAt,
          stoppedBy: plan.stoppedBy,
        },
      };
      const reduced = applyStoryWaitEvent(world, event),
        receipt = storyWaitReceipt(event);
      const stored = { ...row.state, version: reduced.version, time: reduced.time };
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [input.commandId, worldId, ownerId, input.expectedVersion, hash, input],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, worldId, ownerId, event.version, input.commandId, event, now],
      );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1 AND owner_id=$4',
        [worldId, event.version, stored, ownerId],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,last_tick_at,speed,paused,missed_beats,summary,managed,active_until) VALUES($1,$2,$3,$4,12,true,0,NULL,true,NULL) ON CONFLICT(world_id) DO UPDATE SET story_now=EXCLUDED.story_now,last_tick_at=EXCLUDED.last_tick_at,updated_at=now()',
        [worldId, ownerId, event.storyAt, now],
      );
      await updateClockActivity(
        sql,
        ownerId,
        worldId,
        { clientId: input.clientId, sequence: input.sequence, mode: 'browsing', resume: true },
        now,
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$4,result_state=$5,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND id=$3",
        [worldId, ownerId, input.commandId, event.id, stored],
      );
      await projectAgentWorldChange(sql, ownerId, worldId, event.id);
      await sql.query(
        'INSERT INTO parallel_life.story_wait_receipts(world_id,owner_id,command_id,request_hash,source_event_id,version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [worldId, ownerId, input.commandId, hash, event.id, event.version, receipt],
      );
      return receipt;
    });
  }
}
