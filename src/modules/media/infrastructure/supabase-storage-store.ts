import type { AssetStore } from '../application/asset-store.ts';

/** Server-only adapter for a private Supabase Storage bucket. */
export class SupabaseStorageStore implements AssetStore {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly bucket: string;

  constructor(config: { url: string; serviceRoleKey: string; bucket: string }) {
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
    }
    if (
      parsed.protocol !== 'https:' ||
      !config.serviceRoleKey.trim() ||
      !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(config.bucket)
    )
      throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
    this.baseUrl = `${parsed.origin}/storage/v1/object`;
    this.key = config.serviceRoleKey;
    this.bucket = config.bucket;
  }

  private path(key: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) throw Error('INVALID_STORAGE_KEY');
    return `${this.baseUrl}/${this.bucket}/assets/${key}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.key}`,
      apikey: this.key,
      ...extra,
    };
  }

  async put(key: string, data: Buffer) {
    const response = await fetch(this.path(key), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'image/webp', 'x-upsert': 'false' }),
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('PRIVATE_ASSET_UNAVAILABLE');
  }

  async get(key: string) {
    const response = await fetch(`${this.baseUrl}/authenticated/${this.bucket}/assets/${key}`, {
      headers: this.headers(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('PRIVATE_ASSET_UNAVAILABLE');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 16 * 1024 * 1024) throw Error('PRIVATE_ASSET_TOO_LARGE');
    return bytes;
  }

  async remove(key: string) {
    const response = await fetch(`${this.baseUrl}/remove`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [`${this.bucket}/assets/${key}`] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok && response.status !== 404) throw Error('PRIVATE_ASSET_UNAVAILABLE');
  }
}
