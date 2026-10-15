import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { projectCommittedWorldAwareness } from './world-awareness-repository.ts';
/** Same kernel projection for all actual epoch-2 writers; reads do not call this. */
export async function projectAgentWorldChange(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  eventId: string,
) {
  // Epoch1's legacy queue worker has no grants on Agent tables. Its world write
  // has already passed the DB epoch fence; do not query new owner-only tables
  // merely to discover that this is an old-engine commit. Epoch2 task execution
  // uses the trusted application facade and reaches the projection below.
  const role = (
    await sql.query(
      `SELECT pg_has_role(current_user,'pl_worker','MEMBER') AS worker,
            pg_has_role(current_user,'pl_app','MEMBER') AS app`,
    )
  ).rows[0];
  if (role?.worker && !role.app) return;
  const control = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
      [worldId, ownerId],
    )
  ).rows[0];
  if (Number(control?.engine_epoch ?? 1) < 2) return;
  const event = (
    await sql.query(
      'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [worldId, ownerId, eventId],
    )
  ).rows[0]?.payload;
  if (!event) throw Error('AWARENESS_EVENT_NOT_FOUND');
  await projectCommittedWorldAwareness(sql, ownerId, event);
}
