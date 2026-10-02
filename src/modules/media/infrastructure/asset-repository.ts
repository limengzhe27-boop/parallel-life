import { albumPhotos } from './album-projection.ts';
import { AlbumUploadSchema } from '../../../contracts/album.ts';
import { Id } from '../../../contracts/api.ts';
import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { AssetSchema, ProfileSchema } from '../../../contracts/api.ts';
import type { AssetStore } from '../application/asset-store.ts';
import { isValidImageMagicBytes } from '../domain/magic-bytes.ts';
function publicAsset(row: Record<string, unknown>) {
  return AssetSchema.parse({
    id: row.id,
    revision: row.revision,
    kind: row.origin,
    status: row.status,
    width: row.width,
    height: row.height,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}
export class AssetRepository {
  private db: PostgresDatabase;
  private store: AssetStore;
  constructor(db: PostgresDatabase, store: AssetStore) {
    this.db = db;
    this.store = store;
  }
  async requireWorld(ownerId: string, worldId: string) {
    await this.db.transaction(ownerId, async (sql) => {
      const row = (await sql.query('SELECT id FROM parallel_life.worlds WHERE id=$1', [worldId]))
        .rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
    });
  }
  async uploadToAlbum(ownerId: string, worldId: string, bytes: Buffer, input: unknown) {
    const parsed = AlbumUploadSchema.safeParse(input);
    if (!parsed.success || !Id.safeParse(worldId).success) throw new TaskError('INVALID_INPUT');
    await this.requireWorld(ownerId, worldId);
    const asset = await this.upload(ownerId, bytes, { ...parsed.data, worldId });
    return this.db.transaction(ownerId, async (sql) => {
      const photo = (await albumPhotos(sql, worldId)).find((p) => p.id === asset.id);
      if (!photo) throw new TaskError('NOT_FOUND');
      return photo;
    });
  }
  async upload(
    ownerId: string,
    bytes: Buffer,
    album?: { worldId: string; commandId: string; title: string },
  ) {
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new TaskError('INVALID_INPUT');
    if (!isValidImageMagicBytes(bytes)) throw new TaskError('INVALID_INPUT');
    let data: Buffer, width: number, height: number;
    try {
      const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning' }),
        metadata = await image.metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        (metadata.pages ?? 1) > 1 ||
        (metadata.width ?? 0) < 32 ||
        (metadata.height ?? 0) < 32
      )
        throw Error('INVALID_IMAGE');
      const output = await image
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer({ resolveWithObject: true });
      data = output.data;
      width = output.info.width;
      height = output.info.height;
    } catch {
      throw new TaskError('INVALID_INPUT');
    }
    const id = randomUUID(),
      key = `${id}.webp`;
    const hash = album
      ? createHash('sha256')
          .update(bytes)
          .update(JSON.stringify([album.worldId, album.title]))
          .digest('hex')
      : '';
    await this.store.put(key, data);
    try {
      const saved = await this.db.transaction(ownerId, async (sql) => {
        await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
        let storyAt: string | undefined;
        if (album) {
          const world = (
            await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1 FOR SHARE', [
              album.worldId,
            ])
          ).rows[0];
          if (!world) throw new TaskError('NOT_FOUND');
          storyAt = world.state.time;
          const previous = (
            await sql.query(
              'SELECT p.request_hash,a.* FROM parallel_life.world_album p JOIN parallel_life.assets a ON a.id=p.asset_id WHERE p.world_id=$1 AND p.command_id=$2',
              [album.worldId, album.commandId],
            )
          ).rows[0];
          if (previous) {
            if (previous.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
            if (previous.status !== 'ready') throw new TaskError('NOT_FOUND');
            return publicAsset(previous);
          }
        }
        const usage = (
          await sql.query(
            "SELECT count(*)::integer count,coalesce(sum(byte_length),0)::bigint bytes FROM parallel_life.assets WHERE owner_id=$1 AND status='ready'",
            [ownerId],
          )
        ).rows[0];
        if (usage.count >= 100 || Number(usage.bytes) + data.length > 256 * 1024 * 1024)
          throw new TaskError('RATE_LIMITED');
        const row = (
          await sql.query(
            "INSERT INTO parallel_life.assets(id,owner_id,storage_key,mime_type,byte_length,width,height,origin,world_id) VALUES($1,$2,$3,'image/webp',$4,$5,$6,'upload',$7) RETURNING *",
            [id, ownerId, key, data.length, width, height, album?.worldId ?? null],
          )
        ).rows[0];
        if (album)
          await sql.query(
            'INSERT INTO parallel_life.world_album(asset_id,world_id,owner_id,command_id,request_hash,title,story_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [id, album.worldId, ownerId, album.commandId, hash, album.title, storyAt],
          );
        return publicAsset(row);
      });
      if (saved.id !== id) await this.store.remove(key);
      return saved;
    } catch (error) {
      // A lost COMMIT acknowledgement is ambiguous. Never delete bytes that SQL may reference.
      let unreferenced = false;
      try {
        unreferenced = await this.db.transaction(
          ownerId,
          async (sql) =>
            !(await sql.query('SELECT id FROM parallel_life.assets WHERE id=$1', [id])).rowCount,
        );
      } catch {
        // Keep the file for reconciliation if the database is unavailable.
      }
      if (unreferenced) await this.store.remove(key);
      throw error;
    }
  }
  async read(ownerId: string, id: string) {
    const row = await this.db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            "SELECT storage_key FROM parallel_life.assets WHERE id=$1 AND status='ready'",
            [id],
          )
        ).rows[0],
    );
    if (!row) throw new TaskError('NOT_FOUND');
    return this.store.get(row.storage_key);
  }
  async discardUnreferencedUpload(ownerId: string, id: string) {
    const key = await this.db.transaction(ownerId, async (sql) => {
      // Interview sends lock the account first. This also serializes a late send
      // against disposal of the upload after an uncertain network response.
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const profile = (
        await sql.query(
          'SELECT document FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      const asset = (
        await sql.query(
          "SELECT storage_key,status FROM parallel_life.assets WHERE id=$1 AND owner_id=$2 AND origin='upload' AND world_id IS NULL FOR UPDATE",
          [id, ownerId],
        )
      ).rows[0];
      if (!asset) throw new TaskError('NOT_FOUND');
      if (asset.status === 'deleted') return asset.storage_key as string;
      if (asset.status !== 'ready') throw new TaskError('INVALID_STATE');
      const document = profile?.document;
      if (
        document?.portraitAssetId === id ||
        document?.referenceAssetIds?.includes(id) ||
        document?.people?.some((person: { assetId: string | null }) => person.assetId === id)
      )
        throw new TaskError('CONFLICT');
      const used = await sql.query(
        `SELECT 1 FROM parallel_life.interview_messages
         WHERE owner_id=$1 AND role='user' AND position($2 in text)>0 LIMIT 1`,
        [ownerId, `[照片:/api/v1/assets/${id}]`],
      );
      if (used.rowCount) throw new TaskError('CONFLICT');
      const seeded = await sql.query(
        `SELECT 1 FROM parallel_life.world_initial_snapshots
         WHERE owner_id=$1 AND position($2 in approved_seed::text)>0 LIMIT 1`,
        [ownerId, id],
      );
      if (seeded.rowCount) throw new TaskError('CONFLICT');
      await sql.query(
        "UPDATE parallel_life.assets SET status='deleted',revision=revision+1 WHERE id=$1",
        [id],
      );
      return asset.storage_key as string;
    });
    await this.store.remove(key);
  }
  async remove(ownerId: string, id: string) {
    const key = await this.db.transaction(ownerId, async (sql) => {
      const p = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      const asset = (
        await sql.query('SELECT storage_key FROM parallel_life.assets WHERE id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!asset) throw new TaskError('NOT_FOUND');
      if (
        p?.document.portraitAssetId === id ||
        (p?.document.people ?? []).some(
          (person: { assetId: string | null }) => person.assetId === id,
        )
      ) {
        const profile = ProfileSchema.parse({
          ...p.document,
          version: p.version + 1,
          portraitAssetId: p.document.portraitAssetId === id ? null : p.document.portraitAssetId,
          people: (p.document.people ?? []).map((person: { assetId: string | null }) =>
            person.assetId === id ? { ...person, assetId: null } : person,
          ),
          updatedAt: new Date().toISOString(),
        });
        await sql.query(
          'UPDATE parallel_life.profiles SET document=$2,version=$3,updated_at=now() WHERE owner_id=$1',
          [ownerId, profile, profile.version],
        );
      }
      await sql.query(
        "UPDATE parallel_life.assets SET status='deleted',revision=revision+1 WHERE id=$1 AND status<>'deleted'",
        [id],
      );
      return asset.storage_key;
    });
    await this.store.remove(key);
  }
}
