import 'server-only';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { runOwnedTask } from './run-task.ts';

/** Execute only durable media emitted by this committed chat, under the original worker lease.
 * Next after() keeps execution inside the platform request lifetime. No detached promises,
 * unrelated owner tasks, failed/unknown retries, or second media implementation.
 */
export async function runCommittedChatMedia(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  eventId: string,
  run: (owner: string, task: string) => Promise<void> = runOwnedTask,
) {
  const tasks = await db.transaction(
    ownerId,
    async (sql) =>
      (
        await sql.query(
          `SELECT t.id FROM parallel_life.tasks t
       JOIN parallel_life.world_media_requests r ON r.id=t.scope_id AND r.owner_id=t.owner_id
       WHERE t.owner_id=$1 AND r.world_id=$2 AND r.document->>'sourceEventId'=$3
         AND t.scope_kind='media' AND t.status='queued'
       ORDER BY t.created_at,t.id LIMIT 2`,
          [ownerId, worldId, eventId],
        )
      ).rows,
  );
  await Promise.all(
    tasks.map(async (task) => {
      try {
        await run(ownerId, String(task.id));
      } catch {
        console.warn(JSON.stringify({ scope: 'chat-media-task', code: 'EXECUTION_UNAVAILABLE' }));
      }
    }),
  );
}
