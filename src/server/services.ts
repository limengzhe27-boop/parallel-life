import { VercelBlobStore } from '../modules/media/infrastructure/vercel-blob-store.ts';
import { SupabaseStorageStore } from '../modules/media/infrastructure/supabase-storage-store.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { BuildRepository } from '../modules/world/infrastructure/build-repository.ts';
import { SeedRepository } from '../modules/discovery/infrastructure/seed-repository.ts';
import { DiscoveryRepository } from '../modules/discovery/infrastructure/discovery-repository.ts';
import 'server-only';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { SignedSession } from '../modules/identity/infrastructure/signed-session.ts';
import { IdentityRepository } from '../modules/identity/infrastructure/identity-repository.ts';
import { dispatchOutbox } from '../modules/tasks/application/dispatch-outbox.ts';
import { PostgresOutbox } from '../modules/tasks/infrastructure/postgres-outbox.ts';
import {
  GUEST_LIMIT_GLOBAL_CEILING,
  GUEST_LIMIT_PER_CALLER,
  GUEST_LIMIT_WINDOW_SECONDS,
  callerBucket,
} from '../modules/identity/infrastructure/guest-bucket.ts';
import { TaskRepository } from '../modules/tasks/infrastructure/task-repository.ts';
import { InterviewRepository } from '../modules/profile/infrastructure/interview-repository.ts';
import { ProfileRepository } from '../modules/profile/infrastructure/profile-repository.ts';
import { AssetRepository } from '../modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../modules/media/infrastructure/private-disk-store.ts';
import { InterviewQuestionRepository } from '../modules/memory/infrastructure/question-repository.ts';
import { MemoryCandidateRepository } from '../modules/memory/infrastructure/candidate-repository.ts';
import { InterviewPlanner } from '../modules/profile/infrastructure/interview-planner.ts';
import { WorldTurnPlanner } from '../modules/world/infrastructure/turn-planner.ts';
import { createTextModel } from './composition.ts';
let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  // Marketplace integrations expose an administrative DATABASE_URL for
  // provisioning. Runtime traffic must use the restricted application role.
  const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL,
    secret = process.env.SESSION_SECRET,
    origin = process.env.APP_ORIGIN;
  if (!url || !secret || !origin) throw Error('SERVER_NOT_CONFIGURED');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username).split('.')[0] !== 'pl_app'
  )
    throw Error('RUNTIME_ROLE_REQUIRED');
  const assetDir = process.env.PRIVATE_ASSET_DIR;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN,
    blobStoreId = process.env.BLOB_STORE_ID,
    supabaseUrl = process.env.SUPABASE_URL,
    supabaseServiceRoleKey =
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'private-assets';
  if (
    !blobToken &&
    !blobStoreId &&
    !(supabaseUrl && supabaseServiceRoleKey) &&
    (!assetDir || process.env.VERCEL)
  )
    throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
  const assetStore =
    supabaseUrl && supabaseServiceRoleKey
      ? new SupabaseStorageStore({
          url: supabaseUrl,
          serviceRoleKey: supabaseServiceRoleKey,
          bucket: supabaseBucket,
        })
      : blobToken || blobStoreId
        ? new VercelBlobStore({ token: blobToken, storeId: blobStoreId })
        : new PrivateDiskStore(assetDir!);
  const db = new PostgresDatabase(url);
  const identity = new IdentityRepository(db);
  return {
    db,
    sessions: new SignedSession(secret),
    /**
     * Guest-creation quota for one caller. The route stays unaware of how a
     * caller is identified or hashed; the policy lives with the server wiring.
     */
    /**
     * Turns durable outbox jobs of one life into queued tasks. Owner-scoped, and
     * safe to call repeatedly: the job id is the idempotency key.
     */
    drainOutbox: (ownerId: string, limit = 20) => {
      const ports = new PostgresOutbox(db).ports(ownerId);
      return dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks, limit });
    },
    reserveGuestCreation: (headers: Headers) =>
      identity.reserveGuestCreation(callerBucket(headers, secret), {
        perCaller: GUEST_LIMIT_PER_CALLER,
        ceiling: GUEST_LIMIT_GLOBAL_CEILING,
        windowSeconds: GUEST_LIMIT_WINDOW_SECONDS,
      }),
    identity,
    discovery: new DiscoveryRepository(db),
    seeds: new SeedRepository(db),
    builds: new BuildRepository(db),
    worlds: new PostgresWorldRepository(db),
    tasks: new TaskRepository(db),
    interview: new InterviewRepository(db),
    interviewPlanner: new InterviewPlanner(createTextModel()),
    worldPlanner: new WorldTurnPlanner(createTextModel()),
    memoryQuestions: new InterviewQuestionRepository(db),
    memoryCandidates: new MemoryCandidateRepository(db),
    profile: new ProfileRepository(db),
    assets: new AssetRepository(db, assetStore),
    origin,
  };
}
export function getServices() {
  return (services ??= createServices());
}
