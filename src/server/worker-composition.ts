import { WorldPlanner } from '../modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../modules/world/infrastructure/build-handler.ts';
import { DiscoveryPlanner } from '../modules/discovery/infrastructure/discovery-planner.ts';
import { discoveryHandler } from '../modules/discovery/infrastructure/discovery-handler.ts';
import 'server-only';
import { gatewayConfig } from './config.ts';
import { YibuTextModel } from '../modules/ai/infrastructure/yibu-text-model.ts';
import { PostgresTaskQueue } from '../modules/tasks/infrastructure/postgres-task-queue.ts';
import { InterviewPlanner } from '../modules/profile/infrastructure/interview-planner.ts';
import { interviewHandler } from '../modules/profile/infrastructure/interview-handler.ts';
import { memoryHandler } from '../modules/memory/infrastructure/memory-handler.ts';
import { mediaHandler } from '../modules/media/infrastructure/media-handler.ts';
import { CharacterImageSynthesizer } from '../modules/media/infrastructure/image-generator.ts';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { SupabaseStorageStore } from '../modules/media/infrastructure/supabase-storage-store.ts';
import { VercelBlobStore } from '../modules/media/infrastructure/vercel-blob-store.ts';
import { PrivateDiskStore } from '../modules/media/infrastructure/private-disk-store.ts';

export function createWorker() {
  const url = process.env.WORKER_DATABASE_URL;
  if (!url || new URL(url).username.split('.')[0] !== 'pl_worker')
    throw Error('WORKER_NOT_CONFIGURED');
  const config = gatewayConfig(),
    queue = new PostgresTaskQueue(url);

  // Configure private storage store for media generator
  const assetDir = process.env.PRIVATE_ASSET_DIR;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN,
    blobStoreId = process.env.BLOB_STORE_ID,
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseServiceRoleKey =
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'private-assets';

  const assetStore =
    supabaseUrl && supabaseServiceRoleKey
      ? new SupabaseStorageStore({
          url: supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          bucket: supabaseBucket,
        })
      : blobToken || blobStoreId
        ? new VercelBlobStore({ token: blobToken, storeId: blobStoreId })
        : new PrivateDiskStore(assetDir || '.local/assets');

  const appDbUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL ?? url;
  const db = new PostgresDatabase(appDbUrl);
  const synthesizer = new CharacterImageSynthesizer(db, assetStore);

  return {
    queue,
    handlers: {
      'world-build': buildHandler(queue, new WorldPlanner(new YibuTextModel(config)), config.model),
      profile: discoveryHandler(
        queue,
        new DiscoveryPlanner(new YibuTextModel(config)),
        config.model,
      ),
      interview: interviewHandler(
        queue,
        new InterviewPlanner(new YibuTextModel(config)),
        config.model,
      ),
      memory: memoryHandler(queue),
      media: mediaHandler(queue, synthesizer),
    },
  };
}
