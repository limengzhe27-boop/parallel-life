import { randomUUID } from 'node:crypto';
import { Id } from '../../../contracts/api.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

export const PUBLICATION_VIDEO_MAX_BYTES = 50_000_000;
export const PUBLICATION_IMAGE_MAX_BYTES = 10_000_000;

export type PublicationMediaKind = 'image' | 'video';
export type PublicationMediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
const extensions: Record<PublicationMediaMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

type MediaRow = {
  id: string;
  work_id: string;
  storage_key: string;
  kind: PublicationMediaKind;
  mime_type: PublicationMediaMime;
  declared_bytes: string | number;
  byte_length: string | number | null;
  status: 'pending' | 'ready';
};

function assertId(value: string) {
  if (!Id.safeParse(value).success) throw new TaskError('INVALID_INPUT');
}

function publicMedia(row: MediaRow) {
  return {
    assetId: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    byteLength: Number(row.byte_length),
  };
}

export function publicationMediaKind(mimeType: string, byteLength: number) {
  const extension = extensions[mimeType as PublicationMediaMime];
  if (!extension || !Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new TaskError('INVALID_INPUT');
  }
  const kind: PublicationMediaKind = mimeType === 'video/mp4' ? 'video' : 'image';
  if (byteLength > (kind === 'video' ? PUBLICATION_VIDEO_MAX_BYTES : PUBLICATION_IMAGE_MAX_BYTES)) {
    throw new TaskError('CONTENT_TOO_LARGE');
  }
  return { kind, mimeType: mimeType as PublicationMediaMime, extension };
}

export function publicationMediaMagic(mimeType: PublicationMediaMime, header: Uint8Array) {
  if (mimeType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      header.length >= 8 &&
      Buffer.from(header.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mimeType === 'image/webp') {
    return (
      header.length >= 12 &&
      Buffer.from(header.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(header.subarray(8, 12)).toString('ascii') === 'WEBP'
    );
  }
  // ISO-BMFF MP4: major brand at offset 8. QuickTime MOV is intentionally not
  // accepted under an MP4 declaration because mobile browser support differs.
  if (header.length < 16 || Buffer.from(header.subarray(4, 8)).toString('ascii') !== 'ftyp') {
    return false;
  }
  const boxSize = Buffer.from(header).readUInt32BE(0);
  if (boxSize < 16 || boxSize > 4096) return false;
  const brand = Buffer.from(header.subarray(8, 12)).toString('ascii');
  return /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV|hvc1|hev1)$/.test(brand);
}

export interface PublicationMediaStore {
  signUpload(key: string): Promise<{ uploadUrl: string; uploadToken: string }>;
  inspect(key: string): Promise<{ byteLength: number; mimeType: string; header: Uint8Array }>;
  signRead(key: string): Promise<string>;
}

/** Private Supabase Storage bucket. Credentials never leave the server. */
export class SupabasePublicationMediaStore implements PublicationMediaStore {
  private readonly origin: string;
  private readonly key: string;
  private readonly bucket = 'publication-media';

  constructor(config: { url: string; serviceRoleKey: string }) {
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new TaskError('UNAVAILABLE');
    }
    if (parsed.protocol !== 'https:' || !config.serviceRoleKey.trim()) {
      throw new TaskError('UNAVAILABLE');
    }
    this.origin = parsed.origin;
    this.key = config.serviceRoleKey;
  }

  private storage(path: string) {
    return `${this.origin}/storage/v1/${path}`;
  }

  private headers() {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key };
  }

  private objectPath(key: string) {
    if (!/^works\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(key)) {
      throw new TaskError('INVALID_INPUT');
    }
    return `${this.bucket}/${key}`;
  }

  async signUpload(key: string) {
    const objectPath = this.objectPath(key);
    const response = await fetch(this.storage(`object/upload/sign/${objectPath}`), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new TaskError('UNAVAILABLE');
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== 'string') throw new TaskError('UNAVAILABLE');
    const signed = new URL(
      body.url.startsWith('/object/upload/sign/') ? this.storage(body.url.slice(1)) : body.url,
    );
    const expected = new URL(this.storage(`object/upload/sign/${objectPath}`));
    const token = signed.searchParams.get('token');
    if (signed.origin !== expected.origin || signed.pathname !== expected.pathname || !token) {
      throw new TaskError('UNAVAILABLE');
    }
    return { uploadUrl: signed.toString(), uploadToken: token };
  }

  async inspect(key: string) {
    const objectPath = this.objectPath(key);
    const infoResponse = await fetch(this.storage(`object/info/${objectPath}`), {
      headers: this.headers(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (infoResponse.status === 404) throw new TaskError('INVALID_STATE');
    if (!infoResponse.ok) throw new TaskError('UNAVAILABLE');
    const info = (await infoResponse.json()) as {
      size?: unknown;
      content_type?: unknown;
      metadata?: { size?: unknown; mimetype?: unknown };
    };
    const byteLength = Number(info.size ?? info.metadata?.size);
    const mimeType = info.content_type ?? info.metadata?.mimetype;
    if (!Number.isSafeInteger(byteLength) || typeof mimeType !== 'string') {
      throw new TaskError('INVALID_INPUT');
    }
    const response = await fetch(this.storage(`object/authenticated/${objectPath}`), {
      headers: { ...this.headers(), Range: 'bytes=0-4095' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 206) throw new TaskError('UNAVAILABLE');
    const contentRange = response.headers.get('content-range');
    if (!contentRange || !contentRange.endsWith(`/${byteLength}`)) {
      throw new TaskError('UNAVAILABLE');
    }
    const header = new Uint8Array(await response.arrayBuffer());
    if (header.length < 16 || header.length > 4096) throw new TaskError('INVALID_INPUT');
    return { byteLength, mimeType, header };
  }

  async signRead(key: string) {
    const objectPath = this.objectPath(key);
    const response = await fetch(this.storage(`object/sign/${objectPath}`), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new TaskError('UNAVAILABLE');
    const body = (await response.json()) as { signedURL?: unknown };
    if (typeof body.signedURL !== 'string') throw new TaskError('UNAVAILABLE');
    const signed = new URL(
      body.signedURL.startsWith('/object/sign/')
        ? this.storage(body.signedURL.slice(1))
        : body.signedURL,
    );
    const expected = new URL(this.storage(`object/sign/${objectPath}`));
    if (
      signed.origin !== expected.origin ||
      signed.pathname !== expected.pathname ||
      !signed.searchParams.has('token')
    ) {
      throw new TaskError('UNAVAILABLE');
    }
    return signed.toString();
  }
}

export class PublicationMediaRepository {
  private readonly db: PostgresDatabase;
  private readonly store: PublicationMediaStore;
  constructor(db: PostgresDatabase, store: PublicationMediaStore) {
    this.db = db;
    this.store = store;
  }

  private async publisherTx<T>(
    principal: string,
    permission: 'edit' | 'review',
    run: (sql: SqlClient) => Promise<T>,
  ) {
    assertId(principal);
    try {
      return await this.db.transaction(principal, async (sql) => {
        await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
        await sql.query('SELECT parallel_life.publisher_lock_permission($1)', [permission]);
        return run(sql);
      });
    } catch (error) {
      if (error instanceof TaskError) throw error;
      if ((error as { code?: string }).code === '42501') throw new TaskError('FORBIDDEN');
      throw new TaskError('UNAVAILABLE');
    }
  }

  async begin(principal: string, workId: string, input: { mimeType: string; byteLength: number }) {
    assertId(workId);
    const { kind, mimeType, extension } = publicationMediaKind(input.mimeType, input.byteLength);
    const assetId = randomUUID();
    const storageKey = `works/${workId}/${assetId}.${extension}`;
    await this.publisherTx(principal, 'edit', async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `publication-media:${workId}`,
      ]);
      const work = await sql.query('SELECT 1 FROM parallel_life.publication_works WHERE id=$1', [
        workId,
      ]);
      if (!work.rowCount) throw new TaskError('NOT_FOUND');
      const usage = (
        await sql.query(
          'SELECT count(*)::integer count,coalesce(sum(declared_bytes),0)::bigint bytes FROM parallel_life.publication_media_assets WHERE work_id=$1',
          [workId],
        )
      ).rows[0] as { count: number; bytes: string };
      if (usage.count >= 100 || Number(usage.bytes) + input.byteLength > 500_000_000) {
        throw new TaskError('RATE_LIMITED');
      }
      await sql.query(
        'INSERT INTO parallel_life.publication_media_assets(id,work_id,created_by,storage_key,kind,mime_type,declared_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [assetId, workId, principal, storageKey, kind, mimeType, input.byteLength],
      );
    });
    const signed = await this.store.signUpload(storageKey);
    return { assetId, kind, mimeType, byteLength: input.byteLength, ...signed };
  }

  async finalize(principal: string, workId: string, assetId: string) {
    assertId(workId);
    assertId(assetId);
    const row = await this.publisherTx(principal, 'edit', async (sql) => {
      const result = await sql.query(
        'SELECT * FROM parallel_life.publication_media_assets WHERE work_id=$1 AND id=$2',
        [workId, assetId],
      );
      if (!result.rowCount) throw new TaskError('NOT_FOUND');
      return result.rows[0] as MediaRow;
    });
    if (row.status === 'ready') return publicMedia(row);
    const real = await this.store.inspect(row.storage_key);
    if (
      real.byteLength !== Number(row.declared_bytes) ||
      real.mimeType !== row.mime_type ||
      !publicationMediaMagic(row.mime_type, real.header)
    ) {
      throw new TaskError('INVALID_INPUT');
    }
    return this.publisherTx(principal, 'edit', async (sql) => {
      const current = (
        await sql.query(
          'SELECT * FROM parallel_life.publication_media_assets WHERE work_id=$1 AND id=$2 FOR UPDATE',
          [workId, assetId],
        )
      ).rows[0] as MediaRow | undefined;
      if (!current) throw new TaskError('NOT_FOUND');
      if (current.status === 'ready') return publicMedia(current);
      const finished = (
        await sql.query(
          "UPDATE parallel_life.publication_media_assets SET status='ready',byte_length=$3,confirmed_at=now() WHERE work_id=$1 AND id=$2 RETURNING *",
          [workId, assetId, real.byteLength],
        )
      ).rows[0] as MediaRow;
      return publicMedia(finished);
    });
  }

  async publisherAsset(principal: string, workId: string, assetId: string) {
    assertId(workId);
    assertId(assetId);
    return this.publisherTx(principal, 'review', async (sql) => {
      const row = (
        await sql.query(
          "SELECT storage_key,mime_type,byte_length FROM parallel_life.publication_media_assets WHERE work_id=$1 AND id=$2 AND status='ready'",
          [workId, assetId],
        )
      ).rows[0] as { storage_key: string; mime_type: string; byte_length: string } | undefined;
      if (!row) throw new TaskError('NOT_FOUND');
      return row;
    });
  }

  async playerAsset(ownerId: string, worldId: string, assetId: string) {
    assertId(worldId);
    assertId(assetId);
    const row = await this.db.transaction(ownerId, async (sql) => {
      const result = await sql.query(
        'SELECT * FROM parallel_life.publication_media_for_world($1,$2)',
        [worldId, assetId],
      );
      return result.rows[0] as
        { storage_key: string; mime_type: string; byte_length: string } | undefined;
    });
    if (!row) throw new TaskError('NOT_FOUND');
    return row;
  }

  signedRead(key: string) {
    return this.store.signRead(key);
  }
}
