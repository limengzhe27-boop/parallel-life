import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalWorkerEnvironment } from '../scripts/local-runtime-worker-policy.mjs';
const target = { host: '127.0.0.1', port: 55432, database: 'parallel_life_clone_fixture' };
const manifest = {
  schemaVersion: 1,
  target,
  capturedAt: '2026-10-26T10:00:00Z',
  excludedTaskIds: ['old-task'],
  excludedOutboxIds: ['old-outbox'],
  preserveUnknown: true,
};
const env = {
  DATABASE_URL: 'postgresql://pl_app:fixture@127.0.0.1:55432/parallel_life_clone_fixture',
  WORKER_DATABASE_URL: 'postgresql://pl_worker:fixture@127.0.0.1:55432/parallel_life_clone_fixture',
  PRIVATE_ASSET_DIR: '/private/fixture',
};
const local = { port: 55432, adminPassword: 'fixture' };
test('local clone guard fails closed for remote databases, mixed roles, cloud storage and invalid manifests', () => {
  assert.deepEqual(validateLocalWorkerEnvironment(env, manifest, local).target, target);
  for (const patch of [
    { DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example.com') },
    { DATABASE_URL: env.DATABASE_URL.replace('clone_fixture', 'dev') },
    { WORKER_DATABASE_URL: env.DATABASE_URL },
    { SCHEDULER_DATABASE_URL: env.WORKER_DATABASE_URL.replace('127.0.0.1', 'db.example.com') },
    { DATABASE_URL: env.DATABASE_URL + '?host=db.example.com' },
    { APP_DATABASE_URL: env.DATABASE_URL.replace('clone_fixture', 'other') },
    { SUPABASE_URL: 'https://fixture.example' },
    { BLOB_READ_WRITE_TOKEN: 'fixture' },
    { VERCEL: '1' },
    { PRIVATE_ASSET_DIR: 'relative' },
  ])
    assert.throws(() => validateLocalWorkerEnvironment({ ...env, ...patch }, manifest, local));
  for (const patch of [
    { schemaVersion: 0 },
    { preserveUnknown: false },
    { excludedTaskIds: undefined },
    { capturedAt: 'invalid' },
    { target: { ...target, database: 'parallel_life_dev' } },
  ])
    assert.throws(() => validateLocalWorkerEnvironment(env, { ...manifest, ...patch }, local));
  assert.throws(() => validateLocalWorkerEnvironment(env, manifest, { ...local, port: 55433 }));
});
