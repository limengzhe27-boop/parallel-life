import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import { checkMediaQuota, DEFAULT_MEDIA_BUDGET } from '../domain/consistency-guard.ts';
import type { CharacterImageSynthesizer } from './image-generator.ts';

/**
 * Media generation handler (AUD-04 & M-01/M-02/M-03).
 * Enforces per-world quota & cost limits, verifies reference asset contracts,
 * generates character portraits and event memorial photos into the album,
 * or records honest failure reasons if the adapter is not connected.
 */
export function mediaHandler(
  queue: PostgresTaskQueue,
  synthesizer?: CharacterImageSynthesizer,
) {
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

      let referenceAssetId = (row.document as { referenceAssetId?: string }).referenceAssetId;
      if (!referenceAssetId) {
        const snapRes = await sql.query(
          `SELECT approved_seed->>'portraitAssetId' AS portrait_id FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2`,
          [row.world_id, lease.ownerId],
        );
        referenceAssetId = snapRes.rows[0]?.portrait_id ?? undefined;
      }

      return {
        document: {
          ...(row.document as { prompt?: string; title?: string }),
          referenceAssetId,
        },
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

    // 2. Real Image Generation & Album Commit (when synthesizer is active)
    if (synthesizer) {
      const result = await synthesizer.generateAndCommit({
        ownerId: lease.ownerId,
        worldId: request.world_id,
        prompt: request.document.prompt || '平行人生留影',
        title: request.document.title || '平行人生留影',
        referenceAssetId: request.document.referenceAssetId,
      });

      await queue.commit(lease, async (sql) => {
        await sql.query(
          "UPDATE parallel_life.world_media_requests SET document = jsonb_set(jsonb_set(document, '{status}', '\"ready\"'), '{assetId}', to_jsonb($2::text)) WHERE id = $1",
          [lease.scopeId, result.assetId],
        );
        if (request.outbox_id) {
          await sql.query("SELECT parallel_life.finish_outbox_job($1,'succeeded',NULL,$2)", [
            request.outbox_id,
            result.assetId,
          ]);
        }
        return {
          value: { assetId: result.assetId },
          outcome: {
            status: 'succeeded',
            resultVersion: 1,
          },
        };
      });
      return;
    }

    // 3. Fallback: Honest failure reporting when adapter is not wired
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
