import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';

test('checked-out connection loss rejects its transaction, rolls back writes and permits a fresh connection', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.POSTGRES_DISCONNECT_TEST_PORT ?? 55432));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await queue.close();
    await admin.end();
  });
  const owner = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);
  const before = (
    await admin.query('SELECT version FROM parallel_life.profiles WHERE owner_id=$1', [owner])
  ).rows[0].version;
  await assert.rejects(
    db.transaction(owner, async (sql) => {
      assert.ok(
        sql.listenerCount('error') > 0,
        'a checked-out client has a process-safe error observer',
      );
      const pid = (await sql.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await sql.query('UPDATE parallel_life.profiles SET version=version+1 WHERE owner_id=$1', [
        owner,
      ]);
      const lost = new Promise<void>((resolve) => sql.once('error', () => resolve()));
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await lost;
      return 'must not commit';
    }),
    { code: '08006' },
  );
  const after = await db.transaction(
    owner,
    async (sql) =>
      (await sql.query('SELECT version FROM parallel_life.profiles WHERE owner_id=$1', [owner]))
        .rows[0].version,
  );
  assert.equal(after, before, 'the disconnected write was rolled back');
  const worker = await queue.pool.connect();
  try {
    assert.ok(
      worker.listenerCount('error') > 0,
      'task worker also observes errors while checked out',
    );
  } finally {
    worker.release();
  }
});
