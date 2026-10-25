import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

const time = '2026-10-09T09:00:00.000Z';

test('epoch-2 worlds can be archived and restored by their owner', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  try {
    const worlds = new PostgresWorldRepository(db);
    const owner = randomUUID();
    const id = randomUUID();
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: '归档测试',
        time,
        actors: [{ id: randomUUID(), name: '小陈', persona: '朋友' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    await admin.query(
      'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,2)',
      [id, owner],
    );
    const archived = await worlds.archiveWorld(owner, id);
    assert.equal(archived.status, 'archived');
    const restored = await worlds.restoreWorld(owner, id);
    assert.equal(restored.status, 'active');
  } finally {
    await db.close();
    await admin.end();
  }
});
