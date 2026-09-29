import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresSchedulerRepository } from '../../src/modules/world/infrastructure/scheduler-repository.ts';

test('daily scheduler claims at most two due worlds across owners without leaking private tables', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  await admin.query(`ALTER ROLE pl_scheduler PASSWORD '${config.schedulerPassword}'`);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const schedulerUrl = `postgresql://pl_scheduler:${config.schedulerPassword}@127.0.0.1:${config.port}/parallel_life_test`;
  const scheduler = new PostgresSchedulerRepository(schedulerUrl);
  const limited = new pg.Client(schedulerUrl);
  const worlds = new PostgresWorldRepository(app);
  const clock = new PostgresClockStore(app);
  const old = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const ids = Array.from({ length: 4 }, () => ({ ownerId: randomUUID(), worldId: randomUUID() }));
  try {
    for (const [index, item] of ids.entries()) {
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [item.ownerId]);
      await worlds.initialize(
        { userId: item.ownerId },
        {
          schemaVersion: 1,
          id: item.worldId,
          ownerId: item.ownerId,
          version: 0,
          title: '调度验收',
          time: old,
          actors: [{ id: randomUUID(), name: '朋友', persona: '有自己的生活' }],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      );
      const anchor = await clock.read(item.ownerId, item.worldId);
      await clock.ensureAnchor(item.ownerId, item.worldId, anchor);
      if (index === 3) await clock.setClock(item.ownerId, item.worldId, { paused: true });
    }
    await limited.connect();
    await assert.rejects(
      limited.query('SELECT state FROM parallel_life.worlds'),
      /permission denied/,
    );
    const batches = await Promise.all([scheduler.claimDue(), scheduler.claimDue()]);
    const all = batches.flat();
    assert.equal(all.length, 2);
    assert.equal(new Set(all.map((item) => item.worldId)).size, 2);
    assert.ok(
      all.every((item) =>
        ids.some((known) => known.worldId === item.worldId && known.ownerId === item.ownerId),
      ),
    );
    assert.equal(
      all.some((item) => item.worldId === ids[3]!.worldId),
      false,
    );
    assert.deepEqual(await scheduler.claimDue(), []);
  } finally {
    await limited.end().catch(() => {});
    await scheduler.close();
    await app.close();
    for (const item of ids)
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [item.ownerId]);
    await admin.end();
  }
});
