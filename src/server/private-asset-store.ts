import 'server-only';
import type { AssetStore } from '../modules/media/application/asset-store.ts';
import { VercelBlobStore } from '../modules/media/infrastructure/vercel-blob-store.ts';
import { SupabaseStorageStore } from '../modules/media/infrastructure/supabase-storage-store.ts';
import { PrivateDiskStore } from '../modules/media/infrastructure/private-disk-store.ts';
class FallbackAssetStore implements AssetStore {
  private primary: AssetStore;
  private fallback: AssetStore;
  constructor(primary: AssetStore, fallback: AssetStore) {
    this.primary = primary;
    this.fallback = fallback;
  }
  async put(key: string, data: Buffer): Promise<void> {
    try {
      await this.primary.put(key, data);
    } catch (err) {
      console.warn(
        'Primary asset store put failed, attempting fallback store:',
        (err as Error)?.message || err,
      );
      await this.fallback.put(key, data);
    }
  }
  async get(key: string): Promise<Buffer> {
    try {
      return await this.primary.get(key);
    } catch {
      return await this.fallback.get(key);
    }
  }
  async remove(key: string): Promise<void> {
    await Promise.allSettled([this.primary.remove(key), this.fallback.remove(key)]);
  }
}

/** Shared web/worker composition, lazy for text-only background tasks. */
export function createPrivateAssetStore(): AssetStore {
  const assetDir = process.env.PRIVATE_ASSET_DIR;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN,
    blobStoreId = process.env.BLOB_STORE_ID;
  const supabaseUrl = process.env.SUPABASE_URL,
    supabaseServiceRoleKey =
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'private-assets';
  if (
    !blobToken &&
    !blobStoreId &&
    !(supabaseUrl && supabaseServiceRoleKey) &&
    (!assetDir || process.env.VERCEL)
  )
    throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');

  const supabaseStore =
    supabaseUrl && supabaseServiceRoleKey
      ? new SupabaseStorageStore({
          url: supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          bucket: supabaseBucket,
        })
      : null;

  const blobStore =
    blobToken || blobStoreId
      ? new VercelBlobStore({ token: blobToken, storeId: blobStoreId })
      : null;

  if (supabaseStore && blobStore) {
    return new FallbackAssetStore(supabaseStore, blobStore);
  }
  if (supabaseStore) return supabaseStore;
  if (blobStore) return blobStore;
  return new PrivateDiskStore(assetDir!);
}
