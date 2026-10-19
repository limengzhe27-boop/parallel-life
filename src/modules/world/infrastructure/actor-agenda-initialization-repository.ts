import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState, AgentInputReceipt } from '../domain/agent-runtime.ts';
import type { ActorAgendaInitializeGrant } from '../domain/actor-agenda-initialization.ts';
import { isAgendaInitializeInput } from '../domain/actor-agenda-initialization.ts';
import { forgottenAgentSourceIds } from './agent-source-authorization.ts';
import type { WorldState } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const definition = (worldId: string, actor: WorldState['actors'][number]) =>
  hash([worldId, actor.id, actor.persona, actor.relationship]);
export function agendaInitializeCommandId(worldId: string, candidateId: string) {
  const h = hash(['npc-wake-v1', worldId, candidateId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Read-only: admission and immutable genesis attest permission; no goals are inferred or stored. */
export async function readAgendaInitializeGrantsInTransaction(
  sql: SqlClient,
  owner: string,
  input: { worldId: string; engineEpoch: number; worldVersion: number; allowCommandId?: string },
): Promise<ActorAgendaInitializeGrant[]> {
  const row = (
    await sql.query(
      `SELECT w.version,w.state,a.engine_epoch AS admission_epoch,a.genesis_hash,md5(i.state::text) AS initial_hash,i.state AS initial_state,c.engine_epoch
 FROM parallel_life.worlds w JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
 LEFT JOIN parallel_life.agent_narrative_admissions a ON a.world_id=w.id AND a.owner_id=w.owner_id
 LEFT JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id
 WHERE w.id=$1 AND w.owner_id=$2`,
      [input.worldId, owner],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (row.version !== input.worldVersion) throw new DomainError('VERSION_CONFLICT');
  if (
    input.engineEpoch < 2 ||
    row.engine_epoch !== input.engineEpoch ||
    row.admission_epoch !== input.engineEpoch ||
    !row.genesis_hash ||
    row.genesis_hash !== row.initial_hash
  )
    return [];
  const states = (
    await sql.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
      [input.worldId, owner],
    )
  ).rows.map((r) => r.document as ActorAgentState);
  const prior = (
    await sql.query(
      'SELECT actor_id,command_id,status,sent_at,response_hash,expected_world_version,expected_actor_revision FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3',
      [input.worldId, owner, input.engineEpoch],
    )
  ).rows;
  const result: ActorAgendaInitializeGrant[] = [];
  for (const state of states) {
    if (
      state.goals.length ||
      state.plans.length ||
      state.actions.length ||
      state.responsibilities.length ||
      state.decisions.length ||
      state.episodeParticipations?.length ||
      state.questions?.some((q) => q.status === 'open')
    )
      continue;
    const current = (row.state as WorldState).actors?.find((a) => a.id === state.actorId),
      initial = (row.initial_state as WorldState | null)?.actors?.find(
        (a) => a.id === state.actorId,
      );
    if (
      !current ||
      !initial ||
      state.definitionRef !== definition(input.worldId, current) ||
      state.definitionRef !== definition(input.worldId, initial)
    )
      continue;
    const sourceId = `definition:${state.definitionRef}`;
    const blocked = await forgottenAgentSourceIds(sql, owner, input.worldId, state.actorId);
    if (blocked.has(sourceId) || blocked.has(state.definitionRef)) continue;
    const policy = 'npc_agenda_initialize_v1' as const;
    const candidateId = `agenda_initialize:${hash([policy, input.worldId, state.actorId, input.engineEpoch, row.genesis_hash, state.definitionRef])}`;
    // Quiet, known paid failure and unknown keep their slot. Only a proven zero-send
    // cancellation at the exact original CAS may use the existing recovery path.
    const commandId = agendaInitializeCommandId(input.worldId, candidateId);
    if (
      prior.some(
        (p) =>
          p.command_id !== input.allowCommandId &&
          ((p.command_id === commandId &&
            !(
              p.status === 'cancelled_before_send' &&
              p.sent_at === null &&
              p.response_hash === null &&
              p.expected_world_version === row.version &&
              p.expected_actor_revision === state.revision
            )) ||
            (p.actor_id === state.actorId &&
              ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(
                p.status,
              ))),
      )
    )
      continue;
    result.push({
      worldId: input.worldId,
      actorId: state.actorId,
      engineEpoch: input.engineEpoch,
      policy,
      definitionRef: state.definitionRef,
      admissionGenesisHash: row.genesis_hash,
      candidateId,
      sourceIds: [sourceId],
    });
  }
  return result;
}
export function agendaInitializeInputText(grant: ActorAgendaInitializeGrant) {
  return JSON.stringify({
    type: 'npc_agenda_initialize',
    candidateId: grant.candidateId,
    policy: grant.policy,
    definitionRef: grant.definitionRef,
    basisSourceIds: grant.sourceIds,
    instruction:
      'Consider your own bounded short-term agenda using only your visible context. You may remain quiet. This permission is not a player message, a goal, a deadline, an invitation or an instruction to speak. Do not invent completed actions.',
  });
}
/** Called under original world lock on accept and before paid send. No new execution authority. */
export async function requireAgendaInitializeInputInTransaction(
  sql: SqlClient,
  owner: string,
  receipt: AgentInputReceipt,
  engineEpoch?: number,
) {
  if (!isAgendaInitializeInput(receipt)) return;
  if (
    receipt.origin !== 'wake' ||
    receipt.channel !== 'private' ||
    !receipt.recipientActorId ||
    receipt.threadId !== receipt.recipientActorId
  )
    throw new DomainError('INVALID_COMMAND');
  const epoch =
    engineEpoch ??
    (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [receipt.worldId, owner],
      )
    ).rows[0]?.engine_epoch;
  const grants = await readAgendaInitializeGrantsInTransaction(sql, owner, {
    worldId: receipt.worldId,
    engineEpoch: epoch,
    worldVersion: receipt.expectedWorldVersion,
    ...(engineEpoch === undefined ? {} : { allowCommandId: receipt.commandId }),
  });
  const grant = grants.find(
    (g) =>
      g.actorId === receipt.recipientActorId &&
      receipt.commandId === agendaInitializeCommandId(receipt.worldId, g.candidateId),
  );
  if (!grant || receipt.text !== agendaInitializeInputText(grant))
    throw new DomainError(engineEpoch === undefined ? 'INVALID_COMMAND' : 'VERSION_CONFLICT');
  return grant;
}
