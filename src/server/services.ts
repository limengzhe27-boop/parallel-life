import { BuildRepository } from '../modules/world/infrastructure/build-repository.ts';
import { SeedRepository } from '../modules/discovery/infrastructure/seed-repository.ts';
import { DiscoveryRepository } from '../modules/discovery/infrastructure/discovery-repository.ts';
import 'server-only';
import { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { SignedSession } from '../modules/identity/infrastructure/signed-session.ts';
import { IdentityRepository } from '../modules/identity/infrastructure/identity-repository.ts';
import { TaskRepository } from '../modules/tasks/infrastructure/task-repository.ts';
import { InterviewRepository } from '../modules/profile/infrastructure/interview-repository.ts';
import { ProfileRepository } from '../modules/profile/infrastructure/profile-repository.ts';
import { AssetRepository } from '../modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../modules/media/infrastructure/private-disk-store.ts';
let services: ReturnType<typeof createServices> | undefined;
function createServices() {
  const url = process.env.DATABASE_URL,
    secret = process.env.SESSION_SECRET,
    origin = process.env.APP_ORIGIN;
  if (!url || !secret || !origin) throw Error('SERVER_NOT_CONFIGURED');
  const parsed = new URL(url);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.username) !== 'pl_app'
  )
    throw Error('RUNTIME_ROLE_REQUIRED');
  const assetDir = process.env.PRIVATE_ASSET_DIR;
  if (!assetDir) throw Error('PRIVATE_STORAGE_NOT_CONFIGURED');
  const db = new PostgresDatabase(url);
  return {
    db,
    sessions: new SignedSession(secret),
    identity: new IdentityRepository(db),
    discovery: new DiscoveryRepository(db),
    seeds: new SeedRepository(db),
    builds: new BuildRepository(db),
    tasks: new TaskRepository(db),
    interview: new InterviewRepository(db),
    profile: new ProfileRepository(db),
    assets: new AssetRepository(db, new PrivateDiskStore(assetDir)),
    origin,
  };
}
export function getServices() {
  return (services ??= createServices());
}
