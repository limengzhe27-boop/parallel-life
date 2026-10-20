import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  episodeDispatchAttempt,
  episodeRequestWorkState,
} from './agent-episode-dispatch-eligibility.ts';

/** Read-only transport classification; never consumes or retries an episode request. */
export async function hasPendingEpisodeWork(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  engineEpoch: number,
  actorId?: string,
): Promise<boolean> {
  const requests = await sql.query(
    `SELECT id FROM parallel_life.agent_episode_requests
     WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND status='pending'
     AND ($4::text IS NULL OR actor_id=$4::text)`,
    [worldId, ownerId, engineEpoch, actorId ?? null],
  );
  if (!requests.rowCount) return false;
  const rows = await sql.query(
    `SELECT a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,b.request_id AS bound_request_id,r.document
     FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
     ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
     LEFT JOIN parallel_life.agent_episode_attempt_bindings b ON b.world_id=a.world_id AND b.owner_id=a.owner_id AND b.attempt_id=a.id
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3
     AND ($4::text IS NULL OR a.actor_id=$4::text)`,
    [worldId, ownerId, engineEpoch, actorId ?? null],
  );
  const attempts = rows.rows.map(episodeDispatchAttempt);
  return requests.rows.some((r) => episodeRequestWorkState(r.id, attempts) !== 'paid_terminal');
}
