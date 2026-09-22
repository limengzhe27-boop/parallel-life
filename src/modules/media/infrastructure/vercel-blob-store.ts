import { put, get, del } from '@vercel/blob';
import type { AssetStore } from '../application/asset-store.ts';
/** All objects are private; callers never receive a public blob URL. */
export class VercelBlobStore implements AssetStore {
  private credentials: { token?: string; storeId?: string };
  constructor(credentials: { token?: string; storeId?: string }) {
    if (!credentials.token && !credentials.storeId) throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
    this.credentials = credentials;
  }
  private path(key: string) {
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) throw Error('INVALID_STORAGE_KEY');
    return `assets/${key}`;
  }
  async put(key: string, data: Buffer) {
    await put(this.path(key), data, {
      ...this.credentials,
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'image/webp',
      abortSignal: AbortSignal.timeout(30000),
    });
  }
  async get(key: string) {
    const result = await get(this.path(key), {
      ...this.credentials,
      access: 'private',
      useCache: false,
      abortSignal: AbortSignal.timeout(30000),
    });
    if (!result || result.statusCode !== 200) throw Error('PRIVATE_ASSET_UNAVAILABLE');
    if (result.blob.size > 16 * 1024 * 1024) {
      await result.stream.cancel();
      throw Error('PRIVATE_ASSET_TOO_LARGE');
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  async remove(key: string) {
    await del(this.path(key), { ...this.credentials, abortSignal: AbortSignal.timeout(30000) });
  }
}
