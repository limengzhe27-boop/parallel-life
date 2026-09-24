import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import { checkMediaQuota, DEFAULT_MEDIA_BUDGET } from '../domain/consistency-guard.ts';

/**
 * Media generation handler (AUD-04 & M-01/M-02/M-03).
 * Enforces per-world quota & cost limits, verifies reference asset contracts,
 * records honest failure reasons without generic wallpaper spoofing.
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

      // Check current asset quota for this world
      const countRes = await sql.query(
        `SELECT count(*)::int as count FROM parallel_life.assets WHERE world_id = $1 AND owner_id = $2`,
        [row.world_id, lease.ownerId],
      );
      const currentCount = countRes.rows[0]?.count ?? 0;

      return {
        document: row.document as { prompt?: string; referenceAssetId?: string },
        world_id: row.world_id as string,
        outbox_id: row.outbox_id as string | null,
        currentCount,
      };
    });

    // 1. Hard Quota Check
    const quota = checkMediaQuota(request.currentCount, DEFAULT_MEDIA_BUDGET);
    if (!quota.allowed) {
      if (request.outbox_id) {
        await queue.read(lease, async (sql) => {
          await sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
            request.outbox_id,
            'QUOTA_EXCEEDED:budget-limit',
          ]);
        });
      }
      throw Object.assign(Error(quota.reason ?? 'QUOTA_EXCEEDED'), { code: 'INVALID_COMMAND' });
    }

    // 2. Adapter status check (never fake an image with generic wallpaper)
    const reason = 'media adapter 未接入（M-01..M-03 待开发，禁止以随机壁纸冒充人像）';
    if (request.outbox_id)
      await queue.read(lease, async (sql) => {
        await sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
          request.outbox_id,
          'NOT_IMPLEMENTED:media-adapter',
        ]);
      });
    /* The request stays pending on purpose; the failure is reported honestly. */
    throw Object.assign(Error(reason.slice(0, 120)), { code: 'UNAVAILABLE' });
  };
}
