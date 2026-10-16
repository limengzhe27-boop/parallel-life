import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/** Short world -> clock lock; activity is sampled after locking, never across a model call. */
export async function requireActiveAgentDeliveryInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  errorCode: 'DIRECTOR_DELIVERY_DEFERRED' | 'NPC_DELIVERY_DEFERRED' = 'DIRECTOR_DELIVERY_DEFERRED',
) {
  const world = (
    await sql.query(
      'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  if (!world) throw Object.assign(Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const clock = (
    await sql.query(
      'SELECT * FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
      [worldId, ownerId],
    )
  ).rows[0];
  const realNow = new Date().toISOString();
  if (
    clock &&
    (clock.paused ||
      (clock.managed &&
        (!clock.active_until || new Date(clock.active_until).getTime() <= Date.parse(realNow))))
  )
    throw Object.assign(Error(errorCode), {
      code: errorCode,
    });
  return { clock, realNow };
}
