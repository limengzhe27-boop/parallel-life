import sharp from 'sharp';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AssetStore } from '../../media/application/asset-store.ts';
import type {
  InterviewPhotoReaderPort,
  InterviewPhotoReadRequest,
} from '../application/interview-photo-input.ts';
import { MODEL_IMAGE_BYTE_LIMIT } from '../../ai/application/model-content.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { Id } from '../../../contracts/api.ts';
/** Recheck the durable message/asset/owner tuple, including for a leased background worker. */
export async function interviewPhotoMetadata(sql: SqlClient, input: InterviewPhotoReadRequest) {
  if (
    ![input.interviewId, input.sourceMessageId, input.assetId].every(
      (value) => Id.safeParse(value).success,
    )
  )
    throw new TaskError('NOT_FOUND');
  const row = (
    await sql.query(
      `SELECT a.storage_key FROM parallel_life.interviews i
    JOIN parallel_life.interview_messages m ON m.interview_id=i.id AND m.owner_id=i.owner_id
    JOIN parallel_life.assets a ON a.id=m.photo_asset_id AND a.owner_id=m.owner_id
    WHERE i.owner_id=$1 AND i.id=$2 AND m.id=$3 AND m.role='user' AND m.photo_asset_id=$4
    AND a.status='ready' AND a.origin='upload' AND a.revision=1 AND a.world_id IS NULL`,
      [input.ownerId, input.interviewId, input.sourceMessageId, input.assetId],
    )
  ).rows[0];
  if (!row) throw new TaskError('NOT_FOUND');
  return { storageKey: String(row.storage_key) };
}
export class InterviewPhotoReader implements InterviewPhotoReaderPort {
  private readonly metadata: (input: InterviewPhotoReadRequest) => Promise<{ storageKey: string }>;
  private readonly store: () => AssetStore;
  constructor(
    metadata: (input: InterviewPhotoReadRequest) => Promise<{ storageKey: string }>,
    store: () => AssetStore,
  ) {
    this.metadata = metadata;
    this.store = store;
  }
  async read(input: InterviewPhotoReadRequest) {
    const { storageKey } = await this.metadata(input);
    const bytes = await this.store().get(storageKey);
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new TaskError('INVALID_INPUT');
    try {
      const source = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const metadata = await source.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw Error('INVALID_IMAGE');
      const image = await source
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      if (image.length > MODEL_IMAGE_BYTE_LIMIT) throw Error('IMAGE_BUDGET');
      return {
        sourceMessageId: input.sourceMessageId,
        mimeType: 'image/webp' as const,
        base64: image.toString('base64'),
        detail: 'low' as const,
      };
    } catch {
      throw new TaskError('INVALID_INPUT');
    }
  }
}
