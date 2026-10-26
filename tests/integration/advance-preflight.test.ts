import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresClockStore,
  readClockInTransaction,
} from '../../src/modules/world/infrastructure/clock-repository.ts';
import { advancePreflightReason } from '../../src/modules/world/application/advance-preflight.ts';

test('advance preflight reads the paused clock without hydrating the world', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  const world = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    await new PostgresWorldRepository(db).initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id: world,
        ownerId: owner,
        version: 0,
        title: '预检测试',
        time: '2026-10-01T08:00:00.000Z',
        actors: [],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    const store = new PostgresClockStore(db);
    await store.ensureAnchor(owner, world, {
      storyNow: '2026-10-01T08:00:00.000Z',
      speed: 1,
      paused: true,
      lastTickAt: '2026-10-01T08:00:00.000Z',
      missedBeats: 0,
      summary: null,
    });
    const paused = await db.transaction(owner, (sql) =>
      readClockInTransaction(sql, owner, world, '2026-10-01T08:01:00.000Z'),
    );
    assert.equal(paused.paused, true);
    assert.equal(advancePreflightReason({ paused: paused.paused, modelCooldown: false }), 'paused');

    await store.setClock(owner, world, { paused: false }, '2026-10-01T08:02:00.000Z');
    const running = await db.transaction(owner, (sql) =>
      readClockInTransaction(sql, owner, world, '2026-10-01T08:02:00.000Z'),
    );
    assert.equal(running.paused, false);
    assert.equal(advancePreflightReason({ paused: running.paused, modelCooldown: false }), null);
  } finally {
    await db.close();
    await admin.end();
  }
});
