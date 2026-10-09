import 'server-only';
import type { AssetStore } from '../modules/media/application/asset-store.ts';
import { VercelBlobStore } from '../modules/media/infrastructure/vercel-blob-store.ts';
import { SupabaseStorageStore } from '../modules/media/infrastructure/supabase-storage-store.ts';
import { PrivateDiskStore } from '../modules/media/infrastructure/private-disk-store.ts';
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
  return supabaseUrl && supabaseServiceRoleKey
    ? new SupabaseStorageStore({
        url: supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        bucket: supabaseBucket,
      })
    : blobToken || blobStoreId
      ? new VercelBlobStore({ token: blobToken, storeId: blobStoreId })
      : new PrivateDiskStore(assetDir!);
}
