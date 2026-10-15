import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { Appointment, WorldState } from '../domain/types.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { InvitationEvent } from '../domain/invitations.ts';
import { DomainError } from '../domain/errors.ts';
import { replayWorldHistory, type WorldHistoryEvent } from '../domain/world-history.ts';
import { readPublicationInvitationLinks } from '../../settings/infrastructure/publication-story-repository.ts';
import {
  applyAgentExternalProjection,
  projectInvitationAgentDecision,
  type AgentExternalProjection,
  type ProjectedInvitationEvent,
} from '../domain/agent-external-projection.ts';

type ExternalInput = { event: InvitationEvent; beforeAppointment: Appointment };
type Prepared = {
  actorId: string;
  stateAfter: ActorAgentState;
  projection: AgentExternalProjection;
};
const fail = (reason: string): never => {
  throw new DomainError('INVALID_PROPOSAL', reason);
};
async function worldAndEpoch(sql: SqlClient, owner: string, input: ExternalInput) {
  const world = (
    await sql.query(
      'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [input.event.worldId, owner],
    )
  ).rows[0];
  if (!world) throw new DomainError('NOT_FOUND');
  const epoch = Number(
    (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [input.event.worldId, owner],
      )
    ).rows[0]?.engine_epoch ?? 1,
  );
  return { world, epoch };
}
/** Verify from actual immutable history; the supplied appointment is an assertion, not authority. */
async function beforeAppointment(
  sql: SqlClient,
  owner: string,
  input: ExternalInput,
): Promise<Appointment> {
  const event = input.event;
  const initial = (
    await sql.query(
      'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
      [event.worldId, owner],
    )
  ).rows[0]?.state as WorldState | undefined;
  if (
    !initial ||
    initial.id !== event.worldId ||
    initial.ownerId !== owner ||
    initial.version !== 0
  )
    fail('CALENDAR_BASELINE_NOT_FOUND');
  const rows = (
    await sql.query(
      `SELECT e.payload,e.version FROM parallel_life.world_events e JOIN parallel_life.commands c
    ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
    AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 ORDER BY e.version`,
      [event.worldId, owner, event.data.expectedVersion],
    )
  ).rows;
  const events = rows.map((r) => r.payload as WorldHistoryEvent);
  const rebuilt = replayWorldHistory(
    initial!,
    events,
    event.data.expectedVersion,
    await readPublicationInvitationLinks(sql, owner, event.worldId),
  ).world;
  if (rebuilt.version !== event.data.expectedVersion) fail('CALENDAR_HISTORY_GAP');
  const appointment = rebuilt.appointments.find((a) => a.id === event.data.id);
  if (!appointment || !isDeepStrictEqual(appointment, input.beforeAppointment))
    fail('CALENDAR_APPOINTMENT_MISMATCH');
  return appointment!;
}
async function actorStates(
  sql: SqlClient,
  owner: string,
  worldId: string,
  appointment: Appointment,
  actors: { id: string }[],
) {
  const ids = [...new Set(appointment.participantIds)].sort();
  if (ids.some((id) => !actors.some((a) => a.id === id))) fail('CALENDAR_PARTICIPANT_NOT_FOUND');
  return (
    await sql.query(
      `SELECT actor_id,revision,projected_world_version,document FROM parallel_life.actor_agent_states
    WHERE world_id=$1 AND owner_id=$2 AND actor_id=ANY($3::text[]) ORDER BY actor_id FOR UPDATE`,
      [worldId, owner, ids],
    )
  ).rows;
}

/** Phase 1: compute deltas while original player UoW holds world/actor locks; writes nothing. */
export async function prepareExplicitInvitationProjections(
  sql: SqlClient,
  owner: string,
  input: ExternalInput,
): Promise<Prepared[]> {
  const { world, epoch } = await worldAndEpoch(sql, owner, input);
  if (epoch < 2 || !['accept', 'cancel'].includes(input.event.data.operation)) return [];
  if (world.version !== input.event.data.expectedVersion) throw new DomainError('VERSION_CONFLICT');
  if ((input.event as ProjectedInvitationEvent).data.agentProjections !== undefined)
    fail('CALENDAR_PREPARE_ALREADY_PROJECTED');
  const appointment = await beforeAppointment(sql, owner, input);
  const result: Prepared[] = [];
  for (const row of await actorStates(
    sql,
    owner,
    input.event.worldId,
    appointment,
    world.state.actors,
  )) {
    const state = row.document as ActorAgentState;
    if (
      state.actorId !== row.actor_id ||
      state.revision !== row.revision ||
      state.projectedWorldVersion !== row.projected_world_version
    )
      fail('CALENDAR_STATE_MISMATCH');
    const projected = projectInvitationAgentDecision(state, input.event, appointment);
    if (projected) result.push(projected);
  }
  return result;
}

/** Phase 2: actual successful event + receipt must contain exactly the prepared replay deltas. */
export async function projectExplicitInvitationDecision(
  sql: SqlClient,
  owner: string,
  input: ExternalInput,
): Promise<Prepared[]> {
  const { world, epoch } = await worldAndEpoch(sql, owner, input);
  if (epoch < 2 || !['accept', 'cancel'].includes(input.event.data.operation)) return [];
  const event = input.event as ProjectedInvitationEvent;
  const actual = (
    await sql.query(
      `SELECT e.payload,e.version,c.request_hash,c.request_payload,c.expected_version,c.status,c.result_event_id
    FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3`,
      [event.worldId, owner, event.id],
    )
  ).rows[0];
  const { agentProjections, ...command } = event.data;
  const expectedHash = createHash('sha256')
    .update(
      JSON.stringify([
        'invitation.responded',
        event.worldId,
        event.data.id,
        event.data.expectedVersion,
        event.data.operation,
        event.data.at ?? null,
      ]),
    )
    .digest('hex');
  if (
    !actual ||
    actual.status !== 'succeeded' ||
    actual.result_event_id !== event.id ||
    actual.version !== event.version ||
    actual.expected_version !== event.data.expectedVersion ||
    event.version !== event.data.expectedVersion + 1 ||
    world.version < event.version ||
    actual.request_hash !== expectedHash ||
    !isDeepStrictEqual(actual.request_payload, JSON.parse(JSON.stringify(command))) ||
    !isDeepStrictEqual(actual.payload, JSON.parse(JSON.stringify(event))) ||
    !Array.isArray(agentProjections)
  )
    fail('CALENDAR_EVENT_NOT_COMMITTED');
  const appointment = await beforeAppointment(sql, owner, input);
  const rows = await actorStates(sql, owner, event.worldId, appointment, world.state.actors);
  if (new Set(agentProjections!.map((p) => p.actorId)).size !== agentProjections!.length)
    fail('DUPLICATE_CALENDAR_ACTOR');
  const expected: Prepared[] = [];
  for (const row of rows) {
    const state = row.document as ActorAgentState;
    if (
      state.actorId !== row.actor_id ||
      state.revision !== row.revision ||
      state.projectedWorldVersion !== row.projected_world_version
    )
      fail('CALENDAR_STATE_MISMATCH');
    const saved = agentProjections!.find((p) => p.actorId === state.actorId);
    let prepared: Prepared | null;
    if (saved && state.revision >= saved.actorRevisionAfter) {
      if (
        saved.worldId !== event.worldId ||
        saved.appointmentId !== appointment.id ||
        saved.operation !== command.operation ||
        saved.source.recordId !== event.id ||
        saved.source.worldVersion !== event.version ||
        saved.source.at !== event.storyTime
      )
        fail('CALENDAR_METADATA_MISMATCH');
      prepared = {
        actorId: state.actorId,
        stateAfter: applyAgentExternalProjection(state, saved),
        projection: saved,
      };
    } else {
      prepared = projectInvitationAgentDecision(state, event, appointment);
      if (prepared && !isDeepStrictEqual(prepared.projection, saved))
        fail('CALENDAR_METADATA_MISMATCH');
      if (!prepared && saved) fail('CALENDAR_METADATA_MISMATCH');
    }
    if (prepared) expected.push(prepared);
  }
  if (expected.length !== agentProjections!.length) fail('CALENDAR_METADATA_MISMATCH');
  // All deltas verified before any state write. The enclosing world UoW rolls back on any failure.
  for (const prepared of expected) {
    const row = rows.find((r) => r.actor_id === prepared.actorId)!;
    if (row.revision >= prepared.projection.actorRevisionAfter) continue;
    if (Buffer.byteLength(JSON.stringify(prepared.stateAfter), 'utf8') > 240000)
      fail('CALENDAR_STATE_BUDGET');
    const written = await sql.query(
      `UPDATE parallel_life.actor_agent_states SET revision=$4,projected_world_version=$5,document=$6,updated_at=now()
      WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND revision=$7`,
      [
        event.worldId,
        owner,
        prepared.actorId,
        prepared.stateAfter.revision,
        prepared.stateAfter.projectedWorldVersion,
        prepared.stateAfter,
        prepared.projection.actorRevisionBefore,
      ],
    );
    if (written.rowCount !== 1)
      throw new DomainError('VERSION_CONFLICT', 'AGENT_REVISION_CONFLICT');
  }
  return expected;
}
