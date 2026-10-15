import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresClockActivityRepository,
  updateClockActivity,
} from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';

test('real owner-scoped activity leases preserve anchors, pause offline and fence stale tabs', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55503, 'activity tests run only on the isolated assigned test cluster');
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db);
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  const at = (seconds: number) =>
    new Date(Date.parse('2026-10-15T00:00:00Z') + seconds * 1000).toISOString();
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    await worlds.initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id: worldId,
        ownerId: owner,
        version: 0,
        title: '合成时间测试',
        time: at(0),
        actors: [],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    await clock.write(owner, worldId, {
      storyNow: at(0),
      lastTickAt: at(0),
      speed: 1,
      paused: false,
      missedBeats: 0,
      summary: null,
    });
    await t.test(
      'first adoption accrues old elapsed at old speed, then unchanged heartbeats retain beat anchor',
      async () => {
        const first = await activity.update(
          owner,
          worldId,
          { clientId: a, sequence: 0, mode: 'browsing' },
          at(10),
        );
        assert.equal(first.storyNow, at(10));
        assert.equal(first.speed, 12);
        assert.equal(first.lastTickAt, at(10));
        const next = await activity.update(
          owner,
          worldId,
          { clientId: a, sequence: 1, mode: 'browsing' },
          at(25),
        );
        assert.equal(next.lastTickAt, first.lastTickAt);
        assert.equal(next.storyNow, first.storyNow);
        assert.equal(projectStoryTime(next, at(25)), at(190));
        await assert.rejects(
          activity.update(other, worldId, { clientId: a, sequence: 2, mode: 'browsing' }, at(25)),
          { code: 'NOT_FOUND' },
        );
      },
    );
    await t.test('multiple tabs aggregate and stale sequence cannot leave or resume', async () => {
      const slow = await activity.update(
        owner,
        worldId,
        { clientId: b, sequence: 0, mode: 'conversation' },
        at(30),
      );
      assert.equal(slow.speed, 1);
      assert.equal(slow.storyNow, at(250));
      const left = await activity.update(
        owner,
        worldId,
        { clientId: a, sequence: 2, mode: 'away' },
        at(35),
      );
      assert.equal(left.paused, false);
      assert.equal(left.speed, 1);
      const stale = await activity.update(
        owner,
        worldId,
        { clientId: b, sequence: 0, mode: 'away' },
        at(36),
      );
      assert.equal(stale.paused, false);
      assert.equal(stale.activeUntil, at(75));
      const offline = await clock.read(owner, worldId, at(100));
      assert.equal(offline.paused, true);
      assert.equal(offline.storyNow, at(295));
      const ignored = await activity.update(
        owner,
        worldId,
        { clientId: b, sequence: 1, mode: 'browsing' },
        at(100),
      );
      assert.equal(ignored.paused, true);
      assert.equal(ignored.storyNow, at(295));
      const resumed = await activity.update(
        owner,
        worldId,
        { clientId: b, sequence: 2, mode: 'browsing', resume: true },
        at(200),
      );
      assert.equal(resumed.paused, false);
      assert.equal(resumed.speed, 12);
      assert.equal(resumed.storyNow, at(295));
    });
    await t.test(
      'a same-mode lease can renew during model advisory lock without rewriting speed or anchor',
      async () => {
        const held = await db.pool.connect();
        try {
          await held.query('BEGIN');
          await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [worldId]);
          const renewed = await activity.update(
            owner,
            worldId,
            { clientId: b, sequence: 3, mode: 'browsing' },
            at(215),
          );
          assert.equal(renewed.lastTickAt, at(200));
          assert.equal(renewed.activeUntil, at(260));
          await assert.rejects(
            activity.update(
              owner,
              worldId,
              { clientId: b, sequence: 4, mode: 'conversation' },
              at(216),
            ),
            { code: 'VERSION_CONFLICT' },
          );
        } finally {
          await held.query('ROLLBACK');
          held.release();
        }
      },
    );
    await t.test(
      'manual pause wins over ordinary heartbeat; explicit resume is required',
      async () => {
        await clock.setClock(owner, worldId, { paused: true }, at(220));
        const frozen = await activity.update(
          owner,
          worldId,
          { clientId: b, sequence: 4, mode: 'browsing' },
          at(225),
        );
        assert.equal(frozen.paused, true);
        assert.equal(frozen.activeUntil, null);
        assert.equal(frozen.storyNow, at(535));
        const resume = await activity.update(
          owner,
          worldId,
          { clientId: b, sequence: 5, mode: 'conversation', resume: true },
          at(300),
        );
        assert.equal(resume.speed, 1);
        assert.equal(resume.storyNow, at(535));
        const state = await worlds.get({ userId: owner }, worldId);
        assert.equal(state.version, 0);
        const denied = await db.transaction(other, (sql) =>
          sql.query('SELECT * FROM parallel_life.world_clock_activity WHERE world_id=$1', [
            worldId,
          ]),
        );
        assert.equal(denied.rowCount, 0);
      },
    );
    await t.test(
      'caller rollback and old clock writes preserve the authoritative presence deadline',
      async () => {
        await assert.rejects(
          db.transaction(owner, async (sql) => {
            await updateClockActivity(
              sql,
              owner,
              worldId,
              { clientId: b, sequence: 6, mode: 'browsing' },
              at(310),
            );
            throw new Error('ROLLBACK_FIXTURE');
          }),
          /ROLLBACK_FIXTURE/,
        );
        const before = await clock.read(owner, worldId, at(310));
        assert.equal(before.speed, 1);
        assert.equal(before.activeUntil, at(345));
        await clock.ensureAnchor(owner, worldId, {
          storyNow: at(0),
          lastTickAt: at(0),
          paused: false,
          speed: 12,
          missedBeats: 0,
          summary: null,
        });
        await clock.write(owner, worldId, {
          storyNow: before.storyNow,
          lastTickAt: before.lastTickAt,
          paused: false,
          speed: 1,
          missedBeats: 0,
          summary: null,
        });
        const after = await clock.read(owner, worldId, at(310));
        assert.equal(after.managed, true);
        assert.equal(after.activeUntil, at(345));
        const seq = (
          await admin.query(
            'SELECT sequence FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
            [worldId, b],
          )
        ).rows[0].sequence;
        assert.equal(Number(seq), 5);
      },
    );
    await t.test(
      'application checks retain partial managed beats in PostgreSQL and quiet due beats never call a model',
      async () => {
        const resume = await activity.update(
          owner,
          worldId,
          { clientId: b, sequence: 6, mode: 'browsing', resume: true },
          at(400),
        );
        let realNow = at(415),
          calls = 0;
        const timedClock = Object.create(clock) as PostgresClockStore;
        timedClock.read = (o, w) => clock.read(o, w, realNow);
        const run = () =>
          advanceWorld(
            {
              clock: timedClock,
              worlds,
              planner: {
                propose: async () => {
                  calls++;
                  throw new Error('EMPTY_WORLD_MUST_NOT_CALL_MODEL');
                },
              },
              now: () => realNow,
              newId: randomUUID,
              automatic: true,
              maxBeats: 1,
            },
            { userId: owner },
            worldId,
          );
        assert.equal((await run()).played, 0);
        let stored = (
          await admin.query(
            'SELECT last_tick_at FROM parallel_life.world_clock WHERE world_id=$1',
            [worldId],
          )
        ).rows[0];
        assert.equal(new Date(stored.last_tick_at).toISOString(), resume.lastTickAt);
        await activity.update(
          owner,
          worldId,
          { clientId: b, sequence: 7, mode: 'browsing' },
          at(430),
        );
        await activity.update(
          owner,
          worldId,
          { clientId: b, sequence: 8, mode: 'browsing' },
          at(460),
        );
        realNow = at(475);
        assert.equal((await run()).played, 0);
        assert.equal(calls, 0);
        stored = (
          await admin.query(
            'SELECT last_tick_at FROM parallel_life.world_clock WHERE world_id=$1',
            [worldId],
          )
        ).rows[0];
        assert.equal(new Date(stored.last_tick_at).toISOString(), at(475));
        assert.equal(
          (await clock.read(owner, worldId, realNow)).storyNow,
          new Date(Date.parse(resume.storyNow) + 15 * 60000).toISOString(),
        );
      },
    );
  } finally {
    await admin.query('DELETE FROM parallel_life.world_clock_activity WHERE world_id=$1', [
      worldId,
    ]);
    await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [worldId]);
    await admin.query('DELETE FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
      worldId,
    ]);
    await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [worldId]);
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.pool.end();
    await admin.end();
  }
});
