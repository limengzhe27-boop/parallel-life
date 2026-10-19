import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentCandidate } from '../domain/agent-runtime.ts';
import { DomainError } from '../domain/errors.ts';
import { collectPendingSceneObservationCandidates } from '../domain/actor-observation-candidate.ts';
import { readActorNarrativeObservationSourcesInTransaction } from './actor-narrative-observation-sources.ts';
import { readConsumedSceneObservationSourcesInTransaction } from './actor-observation-consumption-repository.ts';

/** Read-only scheduling hints. Selected actors still require the original full snapshot/kernel. */
export async function readAgentObservationScheduleCandidatesInTransaction(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; engineEpoch: number; worldVersion: number; storyAt: string },
  handledActorIds: readonly string[] = [],
): Promise<AgentCandidate[]> {
  const header = (
    await sql.query(
      `SELECT w.version,c.engine_epoch FROM parallel_life.worlds w
     JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
     WHERE w.id=$1 AND w.owner_id=$2 FOR SHARE OF w`,
      [frame.worldId, owner],
    )
  ).rows[0];
  if (!header) throw new DomainError('NOT_FOUND');
  if (header.version !== frame.worldVersion || header.engine_epoch !== frame.engineEpoch)
    throw new DomainError('VERSION_CONFLICT');
  const actors = (
    await sql.query(
      `SELECT s.actor_id,s.revision FROM parallel_life.actor_agent_states s
     WHERE s.world_id=$1 AND s.owner_id=$2 AND NOT(s.actor_id=ANY($3::text[]))
     AND EXISTS(SELECT 1 FROM parallel_life.actor_narrative_knowledge k
       WHERE k.world_id=s.world_id AND k.owner_id=s.owner_id AND k.actor_id=s.actor_id AND k.source_version<=$4)
     ORDER BY s.actor_id`,
      [frame.worldId, owner, handledActorIds, frame.worldVersion],
    )
  ).rows;
  if (!actors.length) return [];
  const attempts = (
    await sql.query(
      `SELECT a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,a.response,a.event_id,r.document
     FROM parallel_life.agent_attempts a LEFT JOIN parallel_life.agent_input_receipts r
       ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3`,
      [frame.worldId, owner, frame.engineEpoch],
    )
  ).rows;
  const candidates: AgentCandidate[] = [];
  for (const actor of actors) {
    const own = attempts.filter((a) => a.actor_id === actor.actor_id);
    if (
      own.some((a) =>
        ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(a.status),
      )
    )
      continue;
    const actorFrame = { ...frame, actorId: String(actor.actor_id) };
    const packet = await readActorNarrativeObservationSourcesInTransaction(sql, owner, actorFrame);
    if (!packet.sources.length) continue;
    const consumed = await readConsumedSceneObservationSourcesInTransaction(sql, owner, actorFrame);
    const pending = await collectPendingSceneObservationCandidates({
      ...actorFrame,
      actorRevision: actor.revision,
      ...packet,
      consumed,
    });
    for (const candidate of pending) {
      const attempted = own.some((a) => {
        if (
          !a.document ||
          a.document.origin !== 'wake' ||
          a.document.worldId !== frame.worldId ||
          a.document.recipientActorId !== candidate.actorId ||
          a.document.commandId !== a.command_id ||
          !(
            ['committed', 'invalid_output', 'stale_discarded'].includes(a.status) ||
            (a.status === 'cancelled_before_send' &&
              (a.sent_at || a.response_hash || a.response || a.event_id))
          )
        )
          return false;
        try {
          const input = JSON.parse(a.document.text);
          return input.type === 'npc_own_condition_ready' && input.candidateId === candidate.id;
        } catch {
          return false;
        }
      });
      if (!attempted) candidates.push(candidate);
    }
  }
  return candidates;
}
