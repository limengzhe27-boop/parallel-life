import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';

test('group read/list do not wait behind a world writer and retain one authorized snapshot', async (t) => {
  const cfg = await localConfig();
  const portText = process.env.GROUP_READ_LOCK_TEST_PORT ?? '55659';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(portText) <= 65535);
  assert.equal(cfg.port, Number(portText));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  t.after(async () => {
    await admin.query('ROLLBACK').catch(() => {});
    await db.close();
    await admin.end();
  });
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  await new PostgresWorldRepository(db).initialize(
    { userId: owner },
    {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Lock fixture',
      time: new Date().toISOString(),
      actors: [{ id: actorId, name: 'A', persona: 'Independent' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  );
  const groups = new PostgresGroupRepository(db);
  const created = await groups.create(owner, {
    worldId,
    commandId: randomUUID(),
    expectedVersion: 0,
    title: 'Before',
    actorIds: [actorId],
  });
  await admin.query('BEGIN');
  await admin.query('SELECT id FROM parallel_life.worlds WHERE id=$1 FOR UPDATE', [worldId]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reads = Promise.all([
      groups.list(owner, worldId),
      groups.read(owner, worldId, created.groupId),
    ]);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('READ_BLOCKED_BY_WORLD_WRITER')), 2000);
    });
    const [list, read] = await Promise.race([reads, timeout]);
    assert.equal(list.groups[0]!.title, 'Before');
    assert.equal(read.group.title, 'Before');
  } finally {
    clearTimeout(timer);
    await admin.query('ROLLBACK');
  }
  await assert.rejects(groups.list(randomUUID(), worldId), /NOT_FOUND/);

  // Inject a committed group change after the world header read. Both projections
  // must still come from the original repeatable-read snapshot, not mixed versions.
  let injected = false;
  const rawConnect = db.pool.connect.bind(db.pool);
  const proxyDb = {
    pool: {
      async connect() {
        const sql = await rawConnect();
        return new Proxy(sql, {
          get(target, key) {
            if (key === 'query')
              return async (...args: any[]) => {
                const result = await (target.query as any)(...args);
                if (
                  !injected &&
                  typeof args[0] === 'string' &&
                  args[0].startsWith('SELECT state,version,owner_id')
                ) {
                  injected = true;
                  await admin.query('UPDATE parallel_life.world_groups SET title=$2 WHERE id=$1', [
                    created.groupId,
                    'After',
                  ]);
                }
                return result;
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    },
  } as unknown as PostgresDatabase;
  const stable = await new PostgresGroupRepository(proxyDb).list(owner, worldId);
  assert.equal(injected, true);
  assert.equal(stable.groups[0]!.title, 'Before');
  assert.equal((await groups.list(owner, worldId)).groups[0]!.title, 'After');
});
