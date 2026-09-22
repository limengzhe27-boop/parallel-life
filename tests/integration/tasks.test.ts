import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresTaskQueue,
  LeaseLost,
} from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { TaskRepository, enqueue } from '../../src/modules/tasks/infrastructure/task-repository.ts';
test('durable tasks: exclusive claims, lease fencing, cancelled results, unknown no auto-retry and scoped worker RLS', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    owner = randomUUID(),
    other = randomUUID(),
    scope = randomUUID();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    repo = new TaskRepository(db);
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    await admin.query(
      "INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,'{}'),($3,$4,'{}')",
      [randomUUID(), owner, randomUUID(), other],
    );
    const first = await db.transaction(owner, (sql) =>
      enqueue(sql, owner, 'interview', scope, randomUUID(), { text: 'x' }, 'first'),
    );
    assert.equal((await queue.pool.query('SELECT * FROM parallel_life.profiles')).rowCount, 0);
    const candidates = await Promise.all([queue.claim(['interview']), queue.claim(['interview'])]);
    const leases = candidates.filter((x) => x !== null);
    assert.equal(leases.length, 1);
    const lease = leases[0]!;
    assert.equal(
      (await queue.read(lease, (sql) => sql.query('SELECT owner_id FROM parallel_life.profiles')))
        .rowCount,
      1,
    );
    await assert.rejects(
      queue.commit({ ...lease, token: randomUUID() }, async () => ({
        value: null,
        outcome: { status: 'succeeded' },
      })),
      LeaseLost,
    );
    await repo.cancel(owner, first.id);
    await assert.rejects(queue.finish(lease, { status: 'succeeded' }), LeaseLost);
    const retry = await repo.retry(owner, first.id, randomUUID());
    const active = await queue.claim(['interview']);
    assert.equal(active?.id, retry.id);
    assert(active);
    await admin.query(
      "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
      [active.id],
    );
    assert.equal(await queue.claim(['interview']), null);
    assert.equal((await repo.get(owner, active.id)).status, 'unknown');
    await assert.rejects(queue.finish(active, { status: 'succeeded' }), LeaseLost);
    assert.equal(await queue.claim(['interview']), null);
    const final = await repo.retry(owner, active.id, randomUUID());
    const finalLease = await queue.claim(['interview']);
    assert(finalLease);
    await queue.finish(finalLease, { status: 'succeeded', resultVersion: 1 });
    assert.equal((await repo.get(owner, final.id)).status, 'succeeded');
    await assert.rejects(repo.get(other, final.id), { code: 'NOT_FOUND' });
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
  }
});
