import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { projectCommittedWorldAwareness } from './world-awareness-repository.ts';
/** Same kernel projection for all actual epoch-2 writers; reads do not call this. */
export async function projectAgentWorldChange(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  eventId: string,
) {
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
