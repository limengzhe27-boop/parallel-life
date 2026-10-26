import 'server-only';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { runCommittedChatMedia } from './chat-media-tasks.ts';
/** Reuse the existing durable outbox executor after the original scene task has actually committed. */
export async function runCommittedSceneMedia(
  db: PostgresDatabase,
  ownerId: string,
  taskId: string,
) {
  const row = await db.transaction(
    ownerId,
    async (sql) =>
      (
        await sql.query(
          `SELECT e.id,e.world_id FROM parallel_life.tasks t
    JOIN parallel_life.world_events e ON e.world_id=t.scope_id AND e.owner_id=t.owner_id AND e.version=t.result_version
    JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_kind='world' AND t.status='succeeded' AND t.input->>'type'='scene'
      AND t.input->'actionId'='null'::jsonb AND e.payload->>'type'='scene.opened'
      AND e.payload->'data'->'environment'->>'taskId'=t.id::text
      AND e.payload->'data'->'environment'->'renderRequest'->>'purpose'='scene'`,
          [taskId, ownerId],
        )
      ).rows[0],
  );
  if (row) await runCommittedChatMedia(db, ownerId, String(row.world_id), String(row.id));
}
