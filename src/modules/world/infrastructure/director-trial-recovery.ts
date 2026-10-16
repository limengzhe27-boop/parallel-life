import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import type { TrialDirectorStatus } from '../../../contracts/publication-worlds.ts';

/** One paid successor per failed attempt; refreshes and duplicate clicks retain this identity. */
export function directorExplicitRetryCommandId(worldId: string, attemptId: string) {
  const h = createHash('sha256')
    .update(JSON.stringify(['director-explicit-retry-v1', worldId, attemptId]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function requireDirectorTrialRetrySource(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  attemptId: string,
  engineEpoch: number,
) {
  return db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        `SELECT a.status,a.sent_at,a.response_hash,a.snapshot FROM parallel_life.director_runtime_attempts a
      JOIN parallel_life.worlds w ON w.id=a.world_id AND w.owner_id=a.owner_id
      JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id AND r.engine_epoch=a.engine_epoch
      WHERE a.world_id=$1 AND a.owner_id=$2 AND a.id=$3 AND a.engine_epoch=$4`,
        [worldId, ownerId, attemptId, engineEpoch],
      )
    ).rows[0];
    if (!row) throw new DomainError('NOT_FOUND');
    // Native group/scene turn routing must be recovered with its original accepted turn.
    if (
      row.status !== 'invalid_output' ||
      !row.sent_at ||
      !row.response_hash ||
      row.snapshot.nativeTurn
    )
      throw new DomainError('INVALID_COMMAND', '这次结果不能重新生成，请核对原请求。');
    return directorExplicitRetryCommandId(worldId, attemptId);
  });
}
export async function readTrialDirectorStatus(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<TrialDirectorStatus> {
  return db.transaction(ownerId, async (sql) => {
    const world = (
      await sql.query(
        `SELECT r.engine_epoch FROM parallel_life.worlds w LEFT JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id AND r.owner_id=w.owner_id WHERE w.id=$1 AND w.owner_id=$2`,
        [worldId, ownerId],
      )
    ).rows[0];
    if (!world) throw new DomainError('NOT_FOUND');
    if (Number(world.engine_epoch ?? 1) < 2) return { status: 'legacy', attemptId: null };
    const a = (
      await sql.query(
        `SELECT id,status,sent_at,response_hash,snapshot FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,
        [worldId, ownerId, world.engine_epoch],
      )
    ).rows[0];
    if (!a) return { status: 'ready', attemptId: null };
    if (a.status === 'invalid_output' && a.sent_at && a.response_hash && !a.snapshot.nativeTurn)
      return { status: 'failed', attemptId: a.id };
    if (['request_sent', 'unknown_after_send'].includes(a.status))
      return { status: 'unknown', attemptId: a.id };
    if (['reserved', 'response_received'].includes(a.status))
      return { status: 'pending', attemptId: a.id };
    if (['invalid_output', 'stale_discarded'].includes(a.status))
      return { status: 'blocked', attemptId: a.id };
    return { status: 'ready', attemptId: null };
  });
}
