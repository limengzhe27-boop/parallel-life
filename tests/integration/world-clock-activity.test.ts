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
  capClockAtNextAppointment,
} from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { switchAgentEngineEpochInTransaction } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';

test('real owner-scoped activity leases preserve anchors, pause offline and fence stale tabs', async (t) => {
  const cfg = await localConfig();
  const port = process.env.CLOCK_ACTIVITY_TEST_PORT ?? '55503';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(
    cfg.port,
    Number(port),
    'activity test requires its explicitly assigned local test port',
  );
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close().catch(() => {});
    await admin.end().catch(() => {});
  });
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db);
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  // Explicit authored-genesis fixture: insert its immutable snapshot once with appointments.
  async function initializeCalendarFixture(
    session: { userId: string },
    state: Record<string, unknown>,
  ) {
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [state.id, session.userId, state.title, state],
    );
  }
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
    await t.test('manual pause clears a live business conversation focus atomically', async () => {
      const focusedWorld = randomUUID(),
        actor = randomUUID(),
        tab = randomUUID();
      await initializeCalendarFixture(
        { userId: owner },
        {
          schemaVersion: 1,
          id: focusedWorld,
          ownerId: owner,
          version: 0,
          title: '合成对话暂停',
          time: at(0),
          actors: [{ id: actor, name: '合成人物', persona: '合成' }],
          facts: [],
          messages: [
            {
              id: randomUUID(),
              actorId: actor,
              role: 'assistant',
              text: '合成历史',
              at: at(0),
              sourceEventId: 'fixture-genesis',
            },
          ],
          appointments: [],
          mediaRequests: [],
        },
      );
      await admin.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) SELECT id,owner_id,state,$${}$$::jsonb FROM parallel_life.worlds WHERE id=$1',
        [focusedWorld],
      );
      await activity.update(
        owner,
        focusedWorld,
        {
          clientId: tab,
          sequence: 0,
          mode: 'conversation',
          focus: { channel: 'private', threadId: actor },
        },
        at(0),
      );
      await clock.setClock(owner, focusedWorld, { paused: true }, at(1));
      const lease = (
        await admin.query(
          'SELECT mode,focus FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
          [focusedWorld, tab],
        )
      ).rows[0];
      assert.equal(lease.mode, 'away');
      assert.equal(lease.focus, null);
      assert.equal((await clock.read(owner, focusedWorld, at(2))).paused, true);
      await admin.query('DELETE FROM parallel_life.world_clock_activity WHERE world_id=$1', [
        focusedWorld,
      ]);
      await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [focusedWorld]);
    });
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
        const notResumed = await activity.update(
          owner,
          worldId,
          { clientId: randomUUID(), sequence: 1, mode: 'browsing', resume: true },
          at(250),
        );
        assert.equal(notResumed.paused, true);
        await clock.setClock(owner, worldId, { paused: false }, at(299));
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
    await t.test(
      'expired tab tombstones do not block new windows or erase stale-sequence fences',
      async () => {
        await admin.query(
          `INSERT INTO parallel_life.world_clock_activity(world_id,owner_id,client_id,sequence,mode,expires_at)
        SELECT $1,$2,md5('clock-fixture-'||g::text)::uuid,42,'away',$3 FROM generate_series(1,150) g`,
          [worldId, owner, at(0)],
        );
        const fresh = randomUUID();
        const admitted = await activity.update(
          owner,
          worldId,
          { clientId: fresh, sequence: 0, mode: 'browsing' },
          at(480),
        );
        assert.equal(admitted.paused, false);
        const old = (
          await admin.query(
            'SELECT sequence FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
            [worldId, a],
          )
        ).rows[0];
        assert.equal(Number(old.sequence), 2);
        await activity.update(
          owner,
          worldId,
          { clientId: a, sequence: 1, mode: 'conversation', resume: true },
          at(481),
        );
        const saved = (
          await admin.query(
            'SELECT sequence,mode FROM parallel_life.world_clock_activity WHERE world_id=$1 AND client_id=$2',
            [worldId, a],
          )
        ).rows[0];
        assert.equal(Number(saved.sequence), 2);
        assert.equal(saved.mode, 'away');
        await admin.query(
          `INSERT INTO parallel_life.world_clock_activity(world_id,owner_id,client_id,sequence,mode,expires_at)
        SELECT $1,$2,md5('clock-live-fixture-'||g::text)::uuid,1,'browsing',$3 FROM generate_series(1,30) g`,
          [worldId, owner, at(520)],
        );
        await assert.rejects(
          activity.update(
            owner,
            worldId,
            { clientId: randomUUID(), sequence: 0, mode: 'browsing' },
            at(482),
          ),
          { code: 'INVALID_COMMAND' },
        );
        await activity.update(
          owner,
          worldId,
          { clientId: fresh, sequence: 1, mode: 'browsing' },
          at(483),
        );
      },
    );
    await t.test(
      'normal browsing freezes at confirmed appointments and only explicit continue crosses the unchanged instant',
      async () => {
        const testWorld = randomUUID(),
          tab = randomUUID(),
          actor = randomUUID(),
          appointmentId = 'fixed_appointment';
        const appointment = {
          id: appointmentId,
          title: '合成约定',
          at: at(300),
          status: 'confirmed',
          participantIds: [actor],
          sourceEventId: randomUUID(),
        };
        await initializeCalendarFixture(
          { userId: owner },
          {
            schemaVersion: 1,
            id: testWorld,
            ownerId: owner,
            version: 0,
            title: '边界合成',
            time: at(0),
            actors: [{ id: actor, name: '合成人物', persona: '合成' }],
            facts: [],
            messages: [],
            appointments: [],
            mediaRequests: [],
          },
        );
        try {
          await admin.query(
            "INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) SELECT id,owner_id,jsonb_set(state,'{appointments}',$2::jsonb),'{}'::jsonb FROM parallel_life.worlds WHERE id=$1",
            [testWorld, JSON.stringify([appointment])],
          );
          const first = await activity.update(
            owner,
            testWorld,
            { clientId: tab, sequence: 0, mode: 'browsing' },
            at(0),
          );
          assert.equal(first.activeUntil, at(25));
          const renewal = await activity.update(
            owner,
            testWorld,
            { clientId: tab, sequence: 1, mode: 'browsing' },
            at(15),
          );
          assert.equal(renewal.activeUntil, at(25));
          const due = await clock.read(owner, testWorld, at(26));
          assert.equal(due.paused, true);
          assert.equal(due.storyNow, at(300));
          const still = await activity.update(
            owner,
            testWorld,
            { clientId: tab, sequence: 2, mode: 'browsing' },
            at(30),
          );
          assert.equal(still.paused, true);
          assert.equal(still.storyNow, at(300));
          const resumed = await activity.update(
            owner,
            testWorld,
            { clientId: tab, sequence: 3, mode: 'browsing', resume: true },
            at(40),
          );
          assert.equal(resumed.paused, false);
          assert.equal(projectStoryTime(resumed, at(45)), at(360));
          const initial = (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [testWorld],
            )
          ).rows[0].state;
          assert.deepEqual(initial.appointments, [appointment]);
          // Root calls this helper inside a committed invitation transaction. It only shrinks deadlines.
          await clock.write(owner, testWorld, {
            storyNow: at(0),
            lastTickAt: at(0),
            speed: 12,
            paused: false,
            missedBeats: 0,
            summary: null,
          });
          await db.transaction(owner, (sql) =>
            capClockAtNextAppointment(sql, owner, testWorld, at(10)),
          );
          assert.equal((await clock.read(owner, testWorld, at(10))).activeUntil, at(25));
          // The tab lease is still live: explicit continue must also rebase a raw expired boundary,
          // without needing a preceding heartbeat to persist paused=true.
          const directContinue = await activity.update(
            owner,
            testWorld,
            { clientId: tab, sequence: 4, mode: 'browsing', resume: true },
            at(30),
          );
          assert.equal(directContinue.paused, false);
          assert.equal(directContinue.storyNow, at(300));
          assert.equal(directContinue.lastTickAt, at(30));
          assert.equal(directContinue.activeUntil, at(75));
          await clock.write(owner, testWorld, {
            storyNow: at(0),
            lastTickAt: at(0),
            speed: 1,
            paused: false,
            missedBeats: 0,
            summary: null,
          });
          await clock.setClock(owner, testWorld, { speed: 12 }, at(10));
          const spedUp = await clock.read(owner, testWorld, at(10));
          assert.equal(spedUp.activeUntil, at(34.167));
          const stopped = await clock.read(owner, testWorld, at(35));
          assert.equal(stopped.paused, true);
          assert.ok(
            Date.parse(stopped.storyNow) >= Date.parse(at(300)) &&
              Date.parse(stopped.storyNow) - Date.parse(at(300)) < 12,
          );
          await clock.setClock(owner, testWorld, { paused: false }, at(100));
          assert.equal((await clock.read(owner, testWorld, at(200))).storyNow, stopped.storyNow);
          assert.equal((await clock.read(owner, testWorld, at(200))).paused, true);
        } finally {
          await admin.query('DELETE FROM parallel_life.world_clock_activity WHERE world_id=$1', [
            testWorld,
          ]);
          await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [testWorld]);
          await admin.query('DELETE FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
            testWorld,
          ]);
          await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [testWorld]);
        }
      },
    );
    await t.test(
      'a saved invitation cancellation overrides an initial confirmed appointment',
      async () => {
        const testWorld = randomUUID(),
          actor = randomUUID();
        await initializeCalendarFixture(
          { userId: owner },
          {
            schemaVersion: 1,
            id: testWorld,
            ownerId: owner,
            version: 0,
            title: '取消边界合成',
            time: at(0),
            actors: [{ id: actor, name: '合成人物', persona: '合成' }],
            facts: [],
            messages: [],
            appointments: [],
            mediaRequests: [],
          },
        );
        try {
          await admin.query(
            "INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) SELECT id,owner_id,jsonb_set(state,'{appointments}',$2::jsonb),'{}'::jsonb FROM parallel_life.worlds WHERE id=$1",
            [
              testWorld,
              JSON.stringify([
                {
                  id: 'cancelled_appointment',
                  title: '合成约定',
                  at: at(300),
                  status: 'confirmed',
                  participantIds: [actor],
                  sourceEventId: randomUUID(),
                },
              ]),
            ],
          );
          await worlds.respondToInvitation(
            { userId: owner },
            {
              commandId: randomUUID(),
              worldId: testWorld,
              id: 'cancelled_appointment',
              expectedVersion: 0,
              operation: 'cancel',
            },
          );
          const next = await activity.update(
            owner,
            testWorld,
            { clientId: randomUUID(), sequence: 0, mode: 'browsing' },
            at(0),
          );
          assert.equal(next.activeUntil, at(45));
        } finally {
          await admin.query('DELETE FROM parallel_life.world_clock_activity WHERE world_id=$1', [
            testWorld,
          ]);
          await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [testWorld]);
          await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [testWorld]);
        }
      },
    );
    await t.test(
      'continuous normal entry and away preserve offline time, SQL parity and manual stop',
      async () => {
        const id = randomUUID();
        await worlds.initialize(
          { userId: owner },
          {
            schemaVersion: 1,
            id,
            ownerId: owner,
            version: 0,
            title: 'Continuous synthetic world',
            time: at(0),
            actors: [],
            facts: [],
            messages: [],
            appointments: [],
            mediaRequests: [],
          },
        );
        await db.transaction(owner, (sql) =>
          switchAgentEngineEpochInTransaction(sql, owner, {
            worldId: id,
            expectedEpoch: 1,
            nextEpoch: 2,
            expectedWorldVersion: 0,
          }),
        );
        await clock.write(owner, id, {
          storyNow: at(0),
          lastTickAt: at(0),
          speed: 1,
          paused: false,
          missedBeats: 0,
          summary: null,
        });
        const clientId = randomUUID();
        const entered = await activity.update(
          owner,
          id,
          { clientId, sequence: 1, mode: 'browsing', resume: true },
          at(0),
        );
        assert.equal(entered.continuityMode, 'continuous');
        const away = await activity.update(
          owner,
          id,
          { clientId, sequence: 2, mode: 'away' },
          at(10),
        );
        assert.equal(away.paused, false);
        assert.equal(away.speed, 1);
        assert.equal(away.activeUntil, null);
        assert.equal(projectStoryTime(away, at(3610)), at(3720));
        const row = await db.transaction(
          owner,
          async (sql) =>
            (
              await sql.query(
                'SELECT now() at, parallel_life.publication_story_clock($1) projected',
                [id],
              )
            ).rows[0],
        );
        assert.equal(
          new Date(row.projected).getTime(),
          Date.parse(projectStoryTime(away, new Date(row.at).toISOString())),
        );
        const returned = await activity.update(
          owner,
          id,
          { clientId, sequence: 3, mode: 'browsing', resume: true },
          at(3610),
        );
        assert.equal(returned.storyNow, at(3720));
        assert.equal(returned.speed, 12);
        await clock.setClock(owner, id, { paused: true }, at(3620));
        assert.equal(
          (
            await activity.update(
              owner,
              id,
              { clientId, sequence: 4, mode: 'browsing', resume: true },
              at(4000),
            )
          ).paused,
          true,
        );
        assert.equal((await worlds.get({ userId: owner }, id)).version, 0);
        // Owned fixture cleanup; no production or other task data involved.
        await admin.query('DELETE FROM parallel_life.world_clock_activity WHERE world_id=$1', [id]);
        await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=$1', [id]);
        await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE world_id=$1', [id]);
        await admin.query('DELETE FROM parallel_life.world_initial_snapshots WHERE world_id=$1', [
          id,
        ]);
        await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [id]);
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
