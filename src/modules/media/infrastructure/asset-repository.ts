import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { AssetSchema, ProfileSchema } from '../../../contracts/api.ts';
import { PrivateDiskStore } from './private-disk-store.ts';
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
  private store: PrivateDiskStore;
  constructor(db: PostgresDatabase, store: PrivateDiskStore) {
    this.db = db;
    this.store = store;
  }
  async upload(ownerId: string, bytes: Buffer) {
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new TaskError('INVALID_INPUT');
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
    await this.store.put(key, data);
    try {
      return await this.db.transaction(ownerId, async (sql) => {
        await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
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
            "INSERT INTO parallel_life.assets(id,owner_id,storage_key,mime_type,byte_length,width,height,origin) VALUES($1,$2,$3,'image/webp',$4,$5,$6,'upload') RETURNING *",
            [id, ownerId, key, data.length, width, height],
          )
        ).rows[0];
        return publicAsset(row);
      });
    } catch (error) {
      await this.store.remove(key);
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
