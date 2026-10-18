import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { MediaPipelineService } from './media-pipeline-service.ts';
import type {
  ImageGenerationIntent,
  VideoGenerationIntent,
  MediaPurpose,
} from '../domain/types.ts';
import { randomUUID } from 'node:crypto';

export type MediaTaskDocument = {
  id?: string;
  worldId?: string;
  prompt?: string;
  title?: string;
  targetActorId?: string;
  isPlayer?: boolean;
  referenceAssetId?: string;
  purpose?: string;
  mediaType?: 'image' | 'video';
  status?: string;
  assetId?: string;
  providerTaskId?: string;
  sourceEventId?: string;
  deliveryIntent?: {
    channel: 'chat' | 'album' | 'evidence_board';
    targetRecipientActorId?: string;
    storyAt?: string;
  };
};

function imagePurpose(doc: MediaTaskDocument): MediaPurpose {
  switch (doc.purpose) {
    case 'portrait':
    case 'scene':
    case 'memorial':
    case 'evidence':
    case 'author_asset':
      return doc.purpose;
    case undefined:
    case '':
      // Earlier committed requests had no purpose. Keep their old behavior.
      return doc.targetActorId ? 'portrait' : 'scene';
    default:
      throw Object.assign(new Error('Invalid image purpose'), { code: 'INVALID_COMMAND' });
  }
}

function videoPurpose(doc: MediaTaskDocument): VideoGenerationIntent['purpose'] {
  if (doc.purpose === undefined || doc.purpose === '') return 'character_action';
  if (doc.purpose === 'scene_moment' || doc.purpose === 'character_action') return doc.purpose;
  throw Object.assign(new Error('Invalid video purpose'), { code: 'INVALID_COMMAND' });
}

/**
 * Enhanced media pipeline handler executing the full async lifecycle:
 * - Idempotent replay for already completed requests
 * - Character reference authorization
 * - Provider generation via MediaPipelineService
 * - Asset creation in parallel_life.assets
 * - Pre-delivery check and album/outbox delivery
 */
export function createMediaPipelineHandler(
  queue: PostgresTaskQueue,
  pipelineServiceOrFactory?: MediaPipelineService | (() => MediaPipelineService),
) {
  return async (lease: TaskLease) => {
    if (lease.kind !== 'media') {
      throw Object.assign(new Error('INVALID_SCOPE'), { code: 'INVALID_COMMAND' });
    }
    const pipelineService =
      typeof pipelineServiceOrFactory === 'function'
        ? pipelineServiceOrFactory()
        : pipelineServiceOrFactory;

    // Phase 1: Read state in short query
    const readData = await queue.read(lease, async (sql) => {
      const row = (
        await sql.query(
          `SELECT m.document, m.world_id,
                  (SELECT id FROM parallel_life.outbox_jobs o
                    WHERE o.event_id = m.document->>'sourceEventId'
                      AND o.payload->>'requestId' = m.id
                    ORDER BY o.created_at DESC LIMIT 1) AS outbox_id
             FROM parallel_life.world_media_requests m
            WHERE m.id = $1 AND m.owner_id = $2`,
          [lease.scopeId, lease.ownerId],
        )
      ).rows[0];

      if (!row) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }

      const doc = (row.document ?? {}) as MediaTaskDocument;

      // Check current asset quota for this world and media type
      const isVideo = doc.mediaType === 'video';
      const countRes = await sql.query(
        isVideo
          ? `SELECT count(*)::int as count FROM parallel_life.assets WHERE world_id = $1 AND owner_id = $2 AND mime_type = 'video/mp4'`
          : `SELECT count(*)::int as count FROM parallel_life.assets WHERE world_id = $1 AND owner_id = $2 AND (mime_type IS NULL OR mime_type != 'video/mp4')`,
        [row.world_id, lease.ownerId],
      );
      const currentCount = Number(countRes.rows[0]?.count ?? 0);

      // Check if world is cancelled
      const worldRes = await sql.query(
        `SELECT state->>'status' AS status FROM parallel_life.worlds WHERE id = $1 AND owner_id = $2`,
        [row.world_id, lease.ownerId],
      );
      const worldIsCancelled = worldRes.rows[0]?.status === 'cancelled';

      return {
        doc,
        worldId: String(row.world_id),
        outboxId: row.outbox_id as string | null,
        currentCount,
        worldIsCancelled,
      };
    });

    const { doc, worldId, outboxId, currentCount: currentAssetCount, worldIsCancelled } = readData;

    // Idempotency check: If already succeeded, return immediately without re-generation
    if (doc.status === 'ready' && doc.assetId) {
      if (outboxId) {
        await queue.read(lease, async (sql) => {
          await sql.query("SELECT parallel_life.finish_outbox_job($1,'succeeded',NULL,$2)", [
            outboxId,
            doc.assetId,
          ]);
        });
      }
      return;
    }

    // Fallback: Honest failure if pipeline service is not connected
    if (!pipelineService) {
      await queue.read(lease, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_media_requests
             SET document = document || '{"status":"failed","errorCode":"UNAVAILABLE"}'::jsonb
           WHERE id=$1 AND owner_id=$2`,
          [lease.scopeId, lease.ownerId],
        );
        if (outboxId) {
          await sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
            outboxId,
            'UNAVAILABLE:media-adapter',
          ]);
        }
      });
      throw Object.assign(new Error('媒体生成服务尚未接入'), { code: 'UNAVAILABLE' });
    }

    // Phase 2: Execute Generation Pipeline
    let pipelineResult;
    try {
      if (doc.mediaType === 'video') {
        const purpose = videoPurpose(doc);
        const videoIntent: VideoGenerationIntent = {
          purpose,
          actionDescription: doc.prompt || '动作记录',
          // The sender remains in the stored request. A scene-only clip must not
          // acquire their portrait anchor merely because they sent the message.
          targetActorId: purpose === 'scene_moment' ? undefined : doc.targetActorId,
          sourceEventId: doc.sourceEventId,
          deliveryIntent: doc.deliveryIntent,
        };
        pipelineResult = await pipelineService.executeVideoPipeline({
          ownerId: lease.ownerId,
          worldId,
          intent: videoIntent,
          currentAssetCount,
          callerActorId: doc.targetActorId || 'player',
          isCallerPlayer: doc.isPlayer ?? doc.targetActorId === 'player',
          worldIsCancelled,
        });
      } else {
        const imageIntent: ImageGenerationIntent = {
          purpose: imagePurpose(doc),
          sceneDescription: doc.prompt || '平行人生留影',
          targetActorId: doc.targetActorId,
          sourceEventId: doc.sourceEventId,
          deliveryIntent: doc.deliveryIntent,
        };
        pipelineResult = await pipelineService.executeImagePipeline({
          ownerId: lease.ownerId,
          worldId,
          intent: imageIntent,
          currentAssetCount,
          callerActorId: doc.targetActorId || 'player',
          isCallerPlayer: doc.isPlayer ?? doc.targetActorId === 'player',
          worldIsCancelled,
        });
      }
    } catch (err: any) {
      const errorCode = err?.code || 'GENERATION_FAILED';
      const errorMessage = err?.message || 'Media generation failed';
      const status = errorCode === 'STATUS_UNKNOWN' ? 'unknown' : 'failed';

      await queue.read(lease, async (sql) => {
        await sql.query(
          `UPDATE parallel_life.world_media_requests
             SET document = jsonb_set(
               jsonb_set(
                 document,
                 '{status}',
                 to_jsonb($2::text)
               ),
               '{errorCode}',
               to_jsonb($3::text)
             )
           WHERE id = $1 AND owner_id = $4`,
          [lease.scopeId, status, errorCode, lease.ownerId],
        );
        if (outboxId) {
          await sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
            outboxId,
            `${errorCode}:${errorMessage}`,
          ]);
        }
      });
      throw err;
    }

    // Phase 3: Short transaction commit
    await queue.commit(lease, async (sql) => {
      // 1. Insert into parallel_life.assets
      await sql.query(
        `INSERT INTO parallel_life.assets (
           id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated', 'ready')`,
        [
          pipelineResult.assetId,
          lease.ownerId,
          worldId,
          pipelineResult.storageKey,
          pipelineResult.mimeType,
          pipelineResult.byteLength,
          pipelineResult.width,
          pipelineResult.height,
        ],
      );

      // 2. Update world_media_requests with ready status, assetId, and deliveryDecision
      await sql.query(
        `UPDATE parallel_life.world_media_requests
            SET document = jsonb_set(
              jsonb_set(
                jsonb_set(document, '{status}', '"ready"'),
                '{assetId}',
                to_jsonb($2::text)
              ),
              '{deliveryDecision}',
              to_jsonb($3::jsonb)
            )
          WHERE id = $1`,
        [lease.scopeId, pipelineResult.assetId, JSON.stringify(pipelineResult.deliveryDecision)],
      );

      // 4. Finish outbox job
      if (outboxId) {
        await sql.query("SELECT parallel_life.finish_outbox_job($1,'succeeded',NULL,$2)", [
          outboxId,
          pipelineResult.assetId,
        ]);
      }

      return {
        value: { assetId: pipelineResult.assetId },
        outcome: {
          status: 'succeeded',
          resultVersion: 1,
        },
      };
    });
  };
}
