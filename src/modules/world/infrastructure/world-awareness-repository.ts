import { readLocationReportAudience } from './location-report-audience.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import { isDeepStrictEqual } from 'node:util';
import { readAgentJourneysInTransaction } from './agent-journey-repository.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { SceneSession } from '../domain/experience-rules.ts';
import {
  awarenessLocalTime,
  awarenessSubjectKey,
  committedAwarenessDelta,
  worldBoundary,
  type ActorPositionKnowledge,
  type AuthoritativePosition,
  type CommittedAwarenessEvent,
  type DirectorObservedState,
  type DirectorPendingReason,
} from '../domain/world-awareness.ts';

async function lockedWorld(sql: SqlClient, owner: string, worldId: string) {
  const row = (
    await sql.query(
      'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, owner],
    )
  ).rows[0];
  if (!row) throw Error('AWARENESS_WORLD_NOT_FOUND');
  return { ...row.state, version: row.version } as WorldState;
}
const committedQuery = `SELECT e.payload,e.id,e.version,c.status,c.result_event_id FROM parallel_life.world_events e
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.owner_id=e.owner_id`;
function assertCommitted(row: Record<string, unknown> | undefined) {
  if (!row || row.status !== 'succeeded' || row.result_event_id !== row.id)
    throw Error('AWARENESS_EVENT_NOT_COMMITTED');
  const event = row.payload as CommittedAwarenessEvent;
  if (event.id !== row.id || event.version !== row.version) throw Error('AWARENESS_EVENT_MISMATCH');
  return event;
}

/** Caller owns the transaction. Must run after the actual event/receipt and projections are saved. */
export async function projectCommittedWorldAwareness(
  sql: SqlClient,
  owner: string,
  input: CommittedAwarenessEvent,
  options: { capabilityIds?: readonly string[] } = {},
): Promise<DirectorObservedState> {
  const world = await lockedWorld(sql, owner, input.worldId);
  const exact = (
    await sql.query(`${committedQuery} WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3`, [
      world.id,
      owner,
      input.id,
    ])
  ).rows[0];
  const stored = assertCommitted(exact);
  if (
    !isDeepStrictEqual(stored, JSON.parse(JSON.stringify(input))) ||
    stored.version > world.version
  )
    throw Error('AWARENESS_EVENT_MISMATCH');
  await sql.query(
    `INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
    [world.id, owner],
  );
  const cursor = (
    await sql.query(
      'SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [world.id, owner],
    )
  ).rows[0]!;
  let version = Number(cursor.observed_through_version);
  let latestId = cursor.observed_event_id as string | null;
  while (version < world.version) {
    const rows = (
      await sql.query(
        `${committedQuery} WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version>$3 AND e.version<=$4 ORDER BY e.version LIMIT 200`,
        [world.id, owner, version, world.version],
      )
    ).rows;
    if (!rows.length) throw Error('AWARENESS_EVENT_GAP');
    for (const row of rows) {
      const event = assertCommitted(row);
      if (event.version !== version + 1 || event.worldId !== world.id)
        throw Error('AWARENESS_EVENT_GAP');
      const data = event.data as { actorId?: string; agentRuntime?: unknown; sceneId?: string };
      let previousAgentState: ActorAgentState | undefined;
      if (data?.agentRuntime && data.actorId) {
        previousAgentState = (
          await sql.query(
            "SELECT response->'snapshot'->'state' AS state FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND event_id=$3 AND status='committed'",
            [world.id, owner, event.id],
          )
        ).rows[0]?.state;
        if (!previousAgentState) {
          previousAgentState = (
            await sql.query(
              `SELECT payload->'data'->'agentRuntime'->'stateAfter' AS state FROM parallel_life.world_events
           WHERE world_id=$1 AND owner_id=$2 AND version<$3 AND payload->'data'->>'actorId'=$4
           AND payload->'data'->'agentRuntime'->'stateAfter' IS NOT NULL ORDER BY version DESC LIMIT 1`,
              [world.id, owner, event.version, data.actorId],
            )
          ).rows[0]?.state;
        }
      }
      let scene: SceneSession | undefined;
      if (['scene.opened', 'scene.entered', 'scene.action_resolved'].includes(event.type)) {
        // No contactActorIds, appointment roster or textual narration can establish physical presence.
        scene = (
          await sql.query(
            `SELECT document FROM parallel_life.scene_sessions WHERE world_id=$1 AND owner_id=$2
          AND id=$3`,
            [world.id, owner, data?.sceneId ?? null],
          )
        ).rows[0]?.document;
      }
      const journey =
        event.type === 'agent.arrival_committed' && data?.actorId
          ? (
              await readAgentJourneysInTransaction(sql, owner, {
                worldId: world.id,
                actorId: data.actorId,
              })
            ).find((j) => j.id === (event.data as { journeyId?: string }).journeyId)
          : undefined;
      let reportObserverActorIds: readonly string[] | undefined;
      const runtime = data?.agentRuntime as
        { inputReceiptId?: string; positionKnowledge?: ActorPositionKnowledge[] } | undefined;
      if (runtime?.positionKnowledge?.some((k) => k.observerActorId !== data.actorId)) {
        const original = (
          await sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [world.id, owner, runtime.inputReceiptId],
          )
        ).rows[0]?.document as AgentInputReceipt | undefined;
        if (!original || !data.actorId) throw Error('INVALID_AWARENESS_REPORT_AUDIENCE');
        const audience = await readLocationReportAudience(
          sql,
          owner,
          world,
          original,
          data.actorId,
        );
        if (
          !audience ||
          runtime.positionKnowledge.some(
            (k) =>
              !audience.actorIds.includes(k.observerActorId) ||
              k.evidence?.inputReceiptId !== original.id ||
              !k.evidence?.quote ||
              !original.text.includes(k.evidence.quote) ||
              k.learnedAt !== original.storyAt,
          )
        )
          throw Error('INVALID_AWARENESS_REPORT_AUDIENCE');
        reportObserverActorIds = audience.actorIds;
      }
      const delta = committedAwarenessDelta(world, event, {
        previousAgentState,
        scene,
        journey,
        reportObserverActorIds,
      });
      for (const position of delta.positions) {
        await sql.query(
          `INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(world_id,subject_key) DO UPDATE SET source_event_id=excluded.source_event_id,
          source_version=excluded.source_version,document=excluded.document WHERE world_authoritative_positions.source_version<excluded.source_version`,
          [
            world.id,
            owner,
            awarenessSubjectKey(position.subject),
            event.id,
            event.version,
            position,
          ],
        );
      }
      for (const knowledge of delta.knowledge) {
        await sql.query(
          `INSERT INTO parallel_life.actor_position_knowledge(world_id,owner_id,observer_actor_id,subject_key,kind,source_event_id,source_version,document)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [
            world.id,
            owner,
            knowledge.observerActorId,
            awarenessSubjectKey(knowledge.subject),
            knowledge.kind,
            event.id,
            event.version,
            knowledge,
          ],
        );
      }
      for (const reason of delta.reasons) {
        await sql.query(
          `INSERT INTO parallel_life.director_pending_reasons(world_id,owner_id,id,source_event_id,source_version,document)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [world.id, owner, reason.id, event.id, event.version, reason],
        );
      }
      version = event.version;
      latestId = event.id;
    }
  }
  await sql.query(
    `UPDATE parallel_life.director_observed_states SET observed_through_version=$3,observed_event_id=$4
    WHERE world_id=$1 AND owner_id=$2`,
    [world.id, owner, version, latestId],
  );
  const boundary = worldBoundary(world, latestId, options.capabilityIds);
  await sql.query(
    `INSERT INTO parallel_life.world_awareness_boundaries(world_id,owner_id,source_event_id,source_version,document)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(world_id) DO UPDATE SET source_event_id=excluded.source_event_id,
    source_version=excluded.source_version,document=excluded.document`,
    [world.id, owner, latestId, version, boundary],
  );
  return {
    worldId: world.id,
    observedThroughVersion: version,
    evaluatedThroughVersion: Number(cursor.evaluated_through_version),
    lastEvaluation: cursor.last_evaluation ?? null,
  };
}

/** Evaluation is a separate real operation. Observation alone never advances this cursor. */
export async function markDirectorEvaluated(
  sql: SqlClient,
  owner: string,
  worldId: string,
  input: {
    expectedObservedThroughVersion: number;
    throughVersion: number;
    result: 'quiet' | 'acted';
  },
): Promise<void> {
  const world = await lockedWorld(sql, owner, worldId);
  if (
    !Number.isSafeInteger(input.throughVersion) ||
    input.throughVersion < 0 ||
    input.throughVersion > world.version ||
    !['quiet', 'acted'].includes(input.result)
  )
    throw Error('INVALID_AWARENESS_EVALUATION');
  const row = (
    await sql.query(
      `SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2 FOR UPDATE`,
      [worldId, owner],
    )
  ).rows[0];
  if (
    !row ||
    row.observed_through_version !== input.expectedObservedThroughVersion ||
    input.throughVersion > row.observed_through_version ||
    input.throughVersion < row.evaluated_through_version
  )
    throw Error('AWARENESS_EVALUATION_CONFLICT');
  const eventId =
    input.throughVersion === 0
      ? null
      : (
          await sql.query(
            'SELECT id FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version=$3',
            [worldId, owner, input.throughVersion],
          )
        ).rows[0]?.id;
  if (input.throughVersion > 0 && !eventId) throw Error('AWARENESS_EVENT_GAP');
  await sql.query(
    `UPDATE parallel_life.director_observed_states SET evaluated_through_version=$3,evaluated_event_id=$4,last_evaluation=$5
    WHERE world_id=$1 AND owner_id=$2`,
    [worldId, owner, input.throughVersion, eventId, input.result],
  );
}

export class PostgresWorldAwarenessRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async readActorAwareness(
    owner: string,
    worldId: string,
    actorId: string,
    input: { afterKnowledge?: { subjectKey: string; kind: string }; limit?: number } = {},
  ) {
    return this.db.transaction(owner, async (sql) => {
      const world = (
        await sql.query(
          'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
          [worldId, owner],
        )
      ).rows[0];
      if (!world || !(world.state as WorldState).actors.some((a) => a.id === actorId))
        throw Error('AWARENESS_ACTOR_NOT_FOUND');
      const state = { ...world.state, version: world.version } as WorldState;
      const sourceId =
        (
          await sql.query(
            'SELECT id FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version=$3',
            [worldId, owner, world.version],
          )
        ).rows[0]?.id ?? null;
      if (world.version > 0 && !sourceId) throw Error('AWARENESS_EVENT_GAP');
      const savedBoundary = (
        await sql.query(
          'SELECT document FROM parallel_life.world_awareness_boundaries WHERE world_id=$1 AND owner_id=$2 AND source_version=$3',
          [worldId, owner, world.version],
        )
      ).rows[0]?.document;
      // Do not return the player actual position or any other actor actual position.
      const actual = (
        await sql.query(
          'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3',
          [worldId, owner, `actor:${actorId}`],
        )
      ).rows[0]?.document as AuthoritativePosition | undefined;
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      const knowledge = (
        await sql.query(
          `WITH latest AS (
        SELECT DISTINCT ON (subject_key,kind) document,source_version,subject_key,kind
        FROM parallel_life.actor_position_knowledge WHERE world_id=$1 AND owner_id=$2 AND observer_actor_id=$3
        ORDER BY subject_key,kind,source_version DESC,source_event_id DESC)
        SELECT * FROM latest WHERE ($4::text IS NULL OR (subject_key,kind)>($4,$5))
        ORDER BY subject_key,kind LIMIT $6`,
          [
            worldId,
            owner,
            actorId,
            input.afterKnowledge?.subjectKey ?? null,
            input.afterKnowledge?.kind ?? null,
            limit + 1,
          ],
        )
      ).rows;
      const lastKnowledge = knowledge[Math.min(limit, knowledge.length) - 1];
      const ownedItems = (state.items ?? [])
        .filter(
          (item) =>
            item.holderActorId === actorId &&
            (item.status === undefined || item.status === 'held' || item.status === 'used') &&
            typeof item.sourceEventId === 'string' &&
            item.sourceEventId.length > 0,
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status === 'used' ? ('used' as const) : ('held' as const),
          sourceEventId: item.sourceEventId,
        }));
      return {
        worldVersion: world.version,
        ownedItems,
        boundary: savedBoundary ?? worldBoundary(state, sourceId),
        ownPosition: actual ?? {
          worldId,
          subject: { kind: 'actor' as const, actorId },
          status: 'unknown' as const,
          placeId: null,
        },
        knowledge: knowledge.slice(0, limit).map((r) => r.document as ActorPositionKnowledge),
        hasMoreKnowledge: knowledge.length > limit,
        nextKnowledgeCursor:
          knowledge.length > limit && lastKnowledge
            ? {
                subjectKey: lastKnowledge.subject_key as string,
                kind: lastKnowledge.kind as string,
              }
            : null,
        time: awarenessLocalTime(state.time),
      };
    });
  }
  async readDirectorObservedState(
    owner: string,
    worldId: string,
    input: { after?: { version: number; id: string }; limit?: number } = {},
  ) {
    return this.db.transaction(owner, async (sql) => {
      if (
        !(
          await sql.query(
            'SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR SHARE',
            [worldId, owner],
          )
        ).rowCount
      )
        throw Error('AWARENESS_WORLD_NOT_FOUND');
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2',
          [worldId, owner],
        )
      ).rows[0];
      const state: DirectorObservedState = {
        worldId,
        observedThroughVersion: Number(row?.observed_through_version ?? 0),
        evaluatedThroughVersion: Number(row?.evaluated_through_version ?? 0),
        lastEvaluation: row?.last_evaluation ?? null,
      };
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      const rows = (
        await sql.query(
          `SELECT document FROM parallel_life.director_pending_reasons WHERE world_id=$1 AND owner_id=$2
        AND source_version>$3 AND source_version<=$4 AND ($5::integer IS NULL OR (source_version,id)>($5,$6))
        ORDER BY source_version,id LIMIT $7`,
          [
            worldId,
            owner,
            state.evaluatedThroughVersion,
            state.observedThroughVersion,
            input.after?.version ?? null,
            input.after?.id ?? null,
            limit + 1,
          ],
        )
      ).rows;
      const reasons = rows.slice(0, limit).map((r) => r.document as DirectorPendingReason);
      const last = reasons.at(-1);
      return {
        ...state,
        pendingReasons: reasons,
        needsEvaluation: Boolean(
          (
            await sql.query(
              `SELECT 1 FROM parallel_life.director_pending_reasons
          WHERE world_id=$1 AND owner_id=$2 AND source_version>$3 AND source_version<=$4 LIMIT 1`,
              [worldId, owner, state.evaluatedThroughVersion, state.observedThroughVersion],
            )
          ).rowCount,
        ),
        nextCursor:
          rows.length > limit && last ? { version: last.worldVersion, id: last.id } : null,
      };
    });
  }
}
