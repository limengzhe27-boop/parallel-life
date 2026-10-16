import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttempt } from '../domain/agent-runtime.ts';
import {
  commitAgentDeparture,
  commitAgentArrival,
  type AgentJourney,
  type AgentTravelPlan,
} from '../domain/agent-travel.ts';
import { DomainError } from '../domain/errors.ts';
import { worldDateTimeInput } from '../domain/display-time.ts';

function fail(message: string): never {
  throw new DomainError('INVALID_PROPOSAL', message);
}
export type AgentJourneyWrite = { status: 'recorded' | 'replayed'; journey: AgentJourney };
/** Revalidate persisted domain outputs, including exact canonical/whitelisted shape. No SQL trust claim. */
function checked(value: AgentJourney): AgentJourney {
  try {
    const { departure, status, revision, ...rest } = value;
    const { arrival: ignored, ...basis } = rest as typeof rest & { arrival?: unknown };
    void ignored;
    const plan: AgentTravelPlan = { ...basis, status: 'planned' };
    const start = commitAgentDeparture(plan, {
      ...departure,
      handledResponsibilityIds: [],
      evidenceSourceIds: [],
    });
    if (start.status !== 'in_transit') return fail('INVALID_JOURNEY_DOCUMENT');
    if (status === 'in_transit' && revision === 0 && isDeepStrictEqual(value, start.journey))
      return start.journey;
    if (status === 'arrived' && revision === 1) {
      const finish = commitAgentArrival(
        {
          commandId: value.arrival.commandId,
          frame: {
            worldId: value.worldId,
            actorId: value.actorId,
            worldVersion: value.arrival.worldVersion - 1,
            storyAt: value.arrival.at,
          },
          journey: { ...start.journey, status: 'in_transit', revision: 0 },
        },
        value.arrival,
      );
      if (finish.status === 'arrived' && isDeepStrictEqual(value, finish.journey))
        return finish.journey;
    }
  } catch {
    /* Malformed JSON is not a domain journey. */
  }
  return fail('INVALID_JOURNEY_DOCUMENT');
}
async function authority(sql: SqlClient, owner: string) {
  const auth = (
    await sql.query(`SELECT current_setting('app.user_id',true) AS owner,
    pg_has_role(current_user,'pl_app','MEMBER') AS app,
    pg_has_role(current_user,'pl_worker','MEMBER') AS worker`)
  ).rows[0];
  if (!auth || auth.owner !== owner || !auth.app || auth.worker) throw new DomainError('NOT_FOUND');
}
async function lockWorld(sql: SqlClient, owner: string, worldId: string) {
  await authority(sql, owner);
  const world = (
    await sql.query(
      'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, owner],
    )
  ).rows[0];
  if (!world) throw new DomainError('NOT_FOUND');
  return world;
}
async function existing(sql: SqlClient, owner: string, journey: AgentJourney) {
  return (
    await sql.query(
      'SELECT document FROM parallel_life.npc_journeys WHERE world_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',
      [journey.worldId, owner, journey.id],
    )
  ).rows[0]?.document as AgentJourney | undefined;
}
/**
 * Same SqlClient AFTER finishAgentCommitInTransaction. Trigger independently checks real attempt,
 * command/event/result, proposal, certified departure effect, route and actual own position.
 * Does not update world, position, goal, clock, command, event, result or outbox.
 */
export async function recordAgentDepartureInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    attempt: AgentAttempt;
    journey: AgentJourney;
  },
): Promise<AgentJourneyWrite> {
  const journey = checked(input.journey),
    attempt = input.attempt;
  if (
    journey.status !== 'in_transit' ||
    journey.worldId !== attempt.worldId ||
    journey.actorId !== attempt.actorId ||
    journey.preparedAtVersion !== attempt.expectedWorldVersion
  )
    fail('INVALID_JOURNEY_ATTEMPT');
  await lockWorld(sql, owner, journey.worldId);
  const found = (
    await sql.query(
      `SELECT id FROM parallel_life.agent_attempts WHERE id=$1 AND owner_id=$2
    AND world_id=$3 AND actor_id=$4 AND command_id=$5 AND input_receipt_id=$6 AND input_hash=$7 AND token=$8
    AND engine_epoch=$9 AND expected_world_version=$10 AND expected_actor_revision=$11
    AND status='committed' AND event_id=$12`,
      [
        attempt.id,
        owner,
        attempt.worldId,
        attempt.actorId,
        attempt.commandId,
        attempt.inputReceiptId,
        attempt.inputHash,
        attempt.token,
        attempt.engineEpoch,
        attempt.expectedWorldVersion,
        attempt.expectedActorRevision,
        journey.departure.eventId,
      ],
    )
  ).rows[0];
  if (!found) fail('INVALID_JOURNEY_ATTEMPT');
  const prior = await existing(sql, owner, journey);
  if (prior) {
    // A completed journey cannot be overwritten/reopened by replaying its old begin.
    const { arrival: ignored, ...basis } = prior as AgentJourney & { arrival?: unknown };
    void ignored;
    const priorDeparture = { ...basis, status: 'in_transit', revision: 0 };
    if (!isDeepStrictEqual(priorDeparture, journey)) throw new DomainError('IDEMPOTENCY_CONFLICT');
    return { status: 'replayed', journey: checked(prior) };
  }
  await sql.query(
    `INSERT INTO parallel_life.npc_journeys(
    world_id,owner_id,id,actor_id,engine_epoch,status,revision,departure_attempt_id,departure_action_id,
    departure_result_id,origin_event_id,origin_version,departure_event_id,departure_version,departed_at,planned_arrival_at,document)
    VALUES($1,$2,$3,$4,$5,'in_transit',0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      journey.worldId,
      owner,
      journey.id,
      journey.actorId,
      attempt.engineEpoch,
      attempt.id,
      journey.beginActionId,
      journey.departure.id,
      journey.origin.sourceEventId,
      journey.origin.worldVersion,
      journey.departure.eventId,
      journey.departure.worldVersion,
      journey.departedAt,
      journey.plannedArrivalAt,
      journey,
    ],
  );
  return { status: 'recorded', journey };
}
/** Root must first anchor lawful story time and persist its dedicated continuation event/command. */
export async function recordAgentArrivalInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    journey: AgentJourney;
  },
): Promise<AgentJourneyWrite> {
  const journey = checked(input.journey);
  if (journey.status !== 'arrived') fail('INVALID_JOURNEY_ARRIVAL');
  await lockWorld(sql, owner, journey.worldId);
  const prior = await existing(sql, owner, journey);
  if (!prior) throw new DomainError('NOT_FOUND');
  if (prior.status === 'arrived') {
    if (!isDeepStrictEqual(prior, journey)) throw new DomainError('IDEMPOTENCY_CONFLICT');
    return { status: 'replayed', journey: checked(prior) };
  }
  const { arrival: ignored, ...basis } = journey;
  void ignored;
  if (!isDeepStrictEqual({ ...basis, status: 'in_transit', revision: 0 }, prior))
    fail('IMMUTABLE_JOURNEY_BASIS');
  const r = journey.arrival;
  const saved = await sql.query(
    `UPDATE parallel_life.npc_journeys SET status='arrived',revision=1,
    arrival_command_id=$4,arrival_event_id=$5,arrival_version=$6,arrival_receipt_id=$7,arrived_at=$8,document=$9
    WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND actor_id=$10 AND status='in_transit' AND revision=0`,
    [
      journey.worldId,
      owner,
      journey.id,
      r.commandId,
      r.eventId,
      r.worldVersion,
      r.id,
      r.at,
      journey,
      journey.actorId,
    ],
  );
  if (saved.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
  return { status: 'recorded', journey };
}
/** Only the requested NPC's own ledger. Never reads player position or initializes state. */
export async function readAgentJourneysInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    worldId: string;
    actorId: string;
  },
): Promise<AgentJourney[]> {
  await authority(sql, owner);
  const rows = await sql.query(
    `SELECT document FROM parallel_life.npc_journeys
    WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 ORDER BY departure_version,id`,
    [input.worldId, owner, input.actorId],
  );
  return rows.rows.map((r) => checked(r.document));
}
/** Director/server-only due view. No calls, scheduling or player-location reads; paused worlds quiet. */
export async function readDueAgentJourneysInTransaction(
  sql: SqlClient,
  owner: string,
  input: {
    worldId: string;
    actorId?: string;
    storyAt: string;
  },
): Promise<AgentJourney[]> {
  await authority(sql, owner);
  if (!worldDateTimeInput(input.storyAt)) fail('INVALID_JOURNEY_TIME');
  const clock = (
    await sql.query(
      'SELECT story_now,paused FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
      [input.worldId, owner],
    )
  ).rows[0];
  if (!clock) return [];
  if (Date.parse(input.storyAt) > new Date(clock.story_now).getTime())
    fail('JOURNEY_TIME_NOT_ANCHORED');
  if (clock.paused) return [];
  const rows = await sql.query(
    `SELECT j.document FROM parallel_life.npc_journeys j
    JOIN parallel_life.agent_runtime_worlds control ON control.world_id=j.world_id AND control.owner_id=j.owner_id AND control.engine_epoch=j.engine_epoch
    JOIN parallel_life.worlds w ON w.id=j.world_id AND w.owner_id=j.owner_id
    JOIN parallel_life.world_clock clock ON clock.world_id=j.world_id AND clock.owner_id=j.owner_id
    WHERE j.world_id=$1 AND j.owner_id=$2 AND ($3::text IS NULL OR j.actor_id=$3)
     AND j.status='in_transit' AND j.planned_arrival_at<=$4::timestamptz AND j.departure_version<=w.version
     AND clock.paused=false AND clock.story_now>=$4::timestamptz
    ORDER BY j.planned_arrival_at,j.id`,
    [input.worldId, owner, input.actorId ?? null, input.storyAt],
  );
  return rows.rows.map((r) => checked(r.document));
}
/** The supplied database owns its pool. Each operation borrows/releases one short transaction. */
export class PostgresAgentJourneyRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  readOwn(owner: string, input: { worldId: string; actorId: string }) {
    return this.db.transaction(owner, (sql) => readAgentJourneysInTransaction(sql, owner, input));
  }
  readDue(owner: string, input: { worldId: string; actorId?: string; storyAt: string }) {
    return this.db.transaction(owner, (sql) =>
      readDueAgentJourneysInTransaction(sql, owner, input),
    );
  }
}
