import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';

/**
 * Media generation is not implemented yet (M-01/M-02/M-03). This handler exists so
 * the outbox has a real consumer: it verifies the request, records *why* nothing
 * was produced, and fails the task. It never fabricates an image and never marks
 * the request as done — an honest failure the phone can show.
 */
export function mediaHandler(queue: PostgresTaskQueue) {
  return async (lease: TaskLease) => {
    if (lease.kind !== 'media')
      throw Object.assign(Error('INVALID_SCOPE'), { code: 'INVALID_COMMAND' });
    const request = await queue.read(lease, async (sql) => {
      const row = (
        await sql.query(
          `SELECT m.document, m.world_id,
                  (SELECT id FROM parallel_life.outbox_jobs o
                    WHERE o.event_id = m.document->>'sourceEventId'
                      AND o.payload->>'requestId' = m.id
                    ORDER BY o.created_at DESC LIMIT 1) AS outbox_id
             FROM parallel_life.world_media_requests m
            WHERE m.id=$1 AND m.owner_id=$2`,
          [lease.scopeId, lease.ownerId],
        )
      ).rows[0];
      if (!row) throw Object.assign(Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      return row as { document: { prompt?: string }; world_id: string; outbox_id: string | null };
    });
    const reason = 'media adapter 未接入（M-01..M-03 待开发）';
    if (request.outbox_id)
      await queue.read(lease, async (sql) => {
        await sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
          request.outbox_id,
          'NOT_IMPLEMENTED:media-adapter',
        ]);
      });
    /* The request stays pending on purpose; the failure is reported, not hidden. */
    throw Object.assign(Error(reason.slice(0, 120)), { code: 'UNAVAILABLE' });
  };
}
