import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';

/**
 * Input identity keeps the client's version. Only an unchanged recipient may
 * interpret an older private input; paid execution retains its own world CAS.
 * Call under the world lock both at acceptance and before claiming a model run.
 */
export async function acceptsAgentInputVersion(
  sql: SqlClient,
  ownerId: string,
  input: AgentInputReceipt,
  currentVersion: number,
): Promise<boolean> {
  if (input.expectedWorldVersion === currentVersion) return true;
  if (
    input.expectedWorldVersion > currentVersion ||
    input.origin !== 'player' ||
    input.channel !== 'private' ||
    !input.recipientActorId ||
    input.threadId !== input.recipientActorId
  )
    return false;
  const row = (
    await sql.query(
      `SELECT a.projected_world_version,
         EXISTS (
           SELECT 1 FROM parallel_life.world_messages m
           JOIN parallel_life.world_events e
             ON e.world_id=m.world_id AND e.owner_id=m.owner_id
               AND e.id=m.document->>'sourceEventId'
           WHERE m.world_id=a.world_id AND m.owner_id=a.owner_id
             AND m.actor_id=a.actor_id AND e.version>$4
         ) AS has_new_message
       FROM parallel_life.actor_agent_states a
       JOIN parallel_life.agent_runtime_worlds r
         ON r.world_id=a.world_id AND r.owner_id=a.owner_id
       WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3
         AND r.engine_epoch>=2`,
      [input.worldId, ownerId, input.recipientActorId, input.expectedWorldVersion],
    )
  ).rows[0];
  // Interrupt settlement only persists the already visible units; it is not a new NPC decision.
  if (
    row &&
    !row.has_new_message &&
    Number(row.projected_world_version) > input.expectedWorldVersion
  ) {
    const settled = await sql.query(
      `SELECT 1 FROM parallel_life.agent_attempts a
      JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
      WHERE a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.status='committed'
        AND e.version=$5 AND e.payload#>>'{data,stream,attemptId}'=a.id
        AND e.payload#>>'{data,stream,unit}'='final' AND e.payload#>'{data,effects}'='[]'::jsonb
        AND EXISTS(SELECT 1 FROM parallel_life.agent_attempt_stream_segments s WHERE s.world_id=a.world_id AND s.owner_id=a.owner_id
          AND s.attempt_id=a.id AND s.status='committed' AND s.completion_status='superseded')
        AND NOT EXISTS(SELECT 1 FROM parallel_life.world_events u WHERE u.world_id=a.world_id AND u.owner_id=a.owner_id
          AND u.payload#>>'{data,stream,attemptId}'=a.id AND u.id<>e.id AND u.version>$4)`,
      [
        input.worldId,
        ownerId,
        input.recipientActorId,
        input.expectedWorldVersion,
        Number(row.projected_world_version),
      ],
    );
    if (settled.rowCount === 1) return true;
  }
  // Streamed speech can commit before the durable actor revision advances.
  return Boolean(
    row &&
    !row.has_new_message &&
    Number(row.projected_world_version) <= input.expectedWorldVersion,
  );
}
