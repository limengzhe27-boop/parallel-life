import { createHash, randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import type { AuthoritativePosition } from '../domain/world-awareness.ts';
import { readableActivityClock } from '../domain/clock-activity.ts';
import { projectStoryTime } from '../domain/clock.ts';
import { isoInstant } from '../domain/validation.ts';
import {
  evaluateAgentArrival,
  commitAgentArrival,
  type AgentJourney,
} from '../domain/agent-travel.ts';
import {
  applyAgentArrivalEvent,
  type AgentArrivalCommittedEvent,
} from '../domain/agent-arrival-event.ts';
import { storedActivityClock, capClockAtNextAppointment } from './clock-activity-repository.ts';
import {
  readDueAgentJourneysInTransaction,
  recordAgentArrivalInTransaction,
} from './agent-journey-repository.ts';
import { compactWorldState } from './postgres-world-repository.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';

export type AgentArrivalContinuationResult =
  | { status: 'quiet' }
  | { status: 'arrived'; eventId: string; worldVersion: number; storyAt: string; actorId: string };
/** Trusted server continuation, not a player command, model capability or paid actor attempt. */
export async function commitDueAgentArrival(
  db: PostgresDatabase,
  ownerId: string,
  input: {
    worldId: string;
    engineEpoch: number;
    expectedWorldVersion: number;
    /** Trusted server/test wall instant, never accepted from a public request body. */
    realNow?: string;
  },
): Promise<AgentArrivalContinuationResult> {
  if (
    !ownerId ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !['worldId', 'engineEpoch', 'expectedWorldVersion', 'realNow'].includes(k),
    ) ||
    typeof input.worldId !== 'string' ||
    !/^[a-zA-Z0-9_:-]{1,160}$/.test(input.worldId) ||
    !Number.isSafeInteger(input.engineEpoch) ||
    input.engineEpoch < 2 ||
    !Number.isSafeInteger(input.expectedWorldVersion) ||
    input.expectedWorldVersion < 0
  )
    throw new DomainError('INVALID_COMMAND');
  const scope = { ...input };
  if (scope.realNow !== undefined) isoInstant(scope.realNow);
  return db.transaction(ownerId, async (sql) => {
    const auth = (
      await sql.query(`SELECT current_setting('app.user_id',true) owner_id,
      pg_has_role(current_user,'pl_app','MEMBER') app,pg_has_role(current_user,'pl_worker','MEMBER') worker,
      NULLIF(current_setting('app.agent_commit_attempt_id',true),'') attempt_id`)
    ).rows[0];
    if (!auth?.app || auth.worker || auth.owner_id !== ownerId) throw new DomainError('NOT_FOUND');
    if (auth.attempt_id) throw new DomainError('INVALID_COMMAND', 'AGENT_ARRIVAL_MIXED_ATTEMPT');
    const row = (
      await sql.query(
        'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [scope.worldId, ownerId],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    if (Number(row.version) !== scope.expectedWorldVersion)
      throw new DomainError('VERSION_CONFLICT');
    const world = { ...row.state, version: Number(row.version) } as WorldState;
    if (world.id !== scope.worldId || world.ownerId !== ownerId)
      throw new DomainError('INVALID_PROPOSAL', 'AGENT_ARRIVAL_WORLD_SCOPE');
    const control = (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [world.id, ownerId],
      )
    ).rows[0];
    if (Number(control?.engine_epoch ?? 1) !== scope.engineEpoch)
      throw Object.assign(Error('ENGINE_EPOCH_CONFLICT'), { code: 'ENGINE_EPOCH_CONFLICT' });
    let clockRow = (
      await sql.query(
        'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [world.id, ownerId],
      )
    ).rows[0];
    // A different tab may advance the clock anchor while this operation waits for the world lock.
    // Production time is sampled after those locks; explicit test instants retain strict regression checks.
    const realNow = scope.realNow ?? new Date().toISOString();
    if (!clockRow || readableActivityClock(storedActivityClock(clockRow), realNow).paused)
      return { status: 'quiet' };
    if (Date.parse(realNow) < Date.parse(storedActivityClock(clockRow).lastTickAt))
      throw new DomainError('INVALID_COMMAND', 'AGENT_ARRIVAL_CLOCK_REGRESSION');
    // Reuse the actual calendar boundary, including source-qualified reschedules/cancellations.
    await capClockAtNextAppointment(sql, ownerId, world.id, realNow);
    clockRow = (
      await sql.query(
        'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [world.id, ownerId],
      )
    ).rows[0];
    const clock = readableActivityClock(storedActivityClock(clockRow), realNow);
    if (clock.paused) return { status: 'quiet' };
    const storyAt = new Date(
      Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, realNow))),
    ).toISOString();
    // This is ordinary active-clock projection only: no ETA jump, lease renewal, speed or pause change.
    await sql.query(
      'UPDATE parallel_life.world_clock SET story_now=$3,last_tick_at=$4,updated_at=now() WHERE world_id=$1 AND owner_id=$2',
      [world.id, ownerId, storyAt, realNow],
    );
    const due = await readDueAgentJourneysInTransaction(sql, ownerId, {
      worldId: world.id,
      storyAt,
    });
    if (!due.length) return { status: 'quiet' };
    const journey = (
      await sql.query(
        'SELECT document FROM parallel_life.npc_journeys WHERE world_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',
        [world.id, ownerId, due[0]!.id],
      )
    ).rows[0]?.document as AgentJourney | undefined;
    if (!journey || journey.status !== 'in_transit') throw new DomainError('VERSION_CONFLICT');
    const position = (
      await sql.query(
        'SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key=$3 FOR UPDATE',
        [world.id, ownerId, `actor:${journey.actorId}`],
      )
    ).rows[0]?.document as AuthoritativePosition | undefined;
    const evaluated = evaluateAgentArrival({
      frame: { worldId: world.id, actorId: journey.actorId, worldVersion: world.version, storyAt },
      journey,
      ownPosition: position ?? null,
    });
    if (evaluated.status !== 'ready')
      throw new DomainError(
        'INVALID_PROPOSAL',
        `AGENT_ARRIVAL_${'reason' in evaluated ? evaluated.reason.toUpperCase() : 'NOT_READY'}`,
      );
    const commandId = evaluated.continuation.commandId;
    if (
      (
        await sql.query('SELECT id FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
          world.id,
          commandId,
        ])
      ).rowCount
    )
      throw new DomainError('IDEMPOTENCY_CONFLICT');
    const arrival = {
      worldId: world.id,
      actorId: journey.actorId,
      id: randomUUID(),
      commandId,
      eventId: randomUUID(),
      worldVersion: world.version + 1,
      at: storyAt,
      journeyId: journey.id,
    };
    const committed = commitAgentArrival(evaluated.continuation, arrival);
    if (committed.status !== 'arrived')
      throw new DomainError('INVALID_PROPOSAL', 'AGENT_ARRIVAL_INVALID_RECEIPT');
    const event: AgentArrivalCommittedEvent = {
      schemaVersion: 1,
      id: arrival.eventId,
      worldId: world.id,
      commandId,
      version: arrival.worldVersion,
      occurredAt: realNow,
      storyAt,
      type: 'agent.arrival_committed',
      data: {
        actorId: journey.actorId,
        journeyId: journey.id,
        departureEventId: journey.departure.eventId,
        route: journey.route,
        arrival,
      },
    };
    const next = compactWorldState(applyAgentArrivalEvent(world, event));
    const command = {
      kind: 'agent_arrival_continuation',
      worldId: world.id,
      engineEpoch: scope.engineEpoch,
      expectedWorldVersion: world.version,
      journeyId: journey.id,
    };
    await sql.query(
      "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch',$2,true)",
      [world.id, String(control.engine_epoch)],
    );
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'running')",
      [
        commandId,
        world.id,
        ownerId,
        world.version,
        createHash('sha256').update(JSON.stringify(command)).digest('hex'),
        command,
      ],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [event.id, world.id, ownerId, event.version, commandId, event, realNow],
    );
    const saved = await sql.query(
      'UPDATE parallel_life.worlds SET version=$3,state=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$5',
      [world.id, ownerId, event.version, next, world.version],
    );
    if (saved.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
      [world.id, commandId, event.id, next],
    );
    await recordAgentArrivalInTransaction(sql, ownerId, { journey: committed.journey });
    await projectAgentWorldChange(sql, ownerId, world.id, event.id);
    return {
      status: 'arrived',
      eventId: event.id,
      worldVersion: event.version,
      storyAt,
      actorId: journey.actorId,
    };
  });
}
