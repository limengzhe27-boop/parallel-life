import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresStoryWaitRepository } from '../../src/modules/world/infrastructure/story-wait-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { applyWorldHistoryEvent } from '../../src/modules/world/domain/world-history.ts';
import type { StoryWaitInput } from '../../src/modules/world/domain/story-wait.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('real PG explicit story waits: resume, receipts, interruption, owner and replay fences; zero models', async (t) => {
  const cfg = await localConfig();
  const port = process.env.STORY_WAIT_TEST_PORT ?? '55570';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(cfg.port, Number(port));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  assert.equal(
    (await db.pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]
      .rolbypassrls,
    false,
  );
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db);
  const real = '2026-10-15T12:00:00.000Z',
    story = '2026-10-15T10:00:00.000Z';
  const waits = new PostgresStoryWaitRepository(db, { now: () => real });
  async function fixture(appointment = false) {
    const owner = randomUUID(),
      other = randomUUID(),
      id = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    const state: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Local synthetic clock fixture',
      time: story,
      actors: [{ id: randomUUID(), name: 'Fixture actor', persona: 'Explicit local test only' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      notes: [],
    };
    await worlds.initialize({ userId: owner }, state);
    if (appointment) {
      const actorId = state.actors[0]!.id,
        appointmentId = randomUUID();
      const cmd = {
        id: randomUUID(),
        worldId: id,
        expectedVersion: 0,
        actorId,
        text: 'Explicit local proposal fixture',
      };
      await worlds.commit({ userId: owner }, cmd, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: id,
        commandId: cmd.id,
        version: 1,
        occurredAt: real,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: cmd.text,
          effects: [
            {
              type: 'message.received',
              id: randomUUID(),
              actorId,
              text: 'Explicit local SQL fixture, not a model response.',
            },
            {
              type: 'appointment.proposed',
              id: appointmentId,
              title: 'Existing agreement',
              at: '2026-10-15T11:00:00.000Z',
              participantIds: [actorId],
            },
          ],
        },
      });
      await worlds.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: id,
          id: appointmentId,
          operation: 'accept',
          expectedVersion: 1,
        },
      );
    }

    await clock.write(owner, id, {
      storyNow: story,
      lastTickAt: real,
      speed: 1,
      paused: true,
      missedBeats: 0,
      summary: null,
    });
    const input: StoryWaitInput = {
      commandId: randomUUID(),
      expectedVersion: appointment ? 2 : 0,
      clientId: randomUUID(),
      sequence: 1,
      target: 'short',
    };
    return { owner, other, id, state: await worlds.get({ userId: owner }, id), input };
  }
  await t.test(
    'paused explicit wait atomically resumes browsing with45s lease; projections unchanged',
    async () => {
      const f = await fixture();
      const before = await worlds.get({ userId: f.owner }, f.id);
      const result = await waits.wait(f.owner, f.id, f.input);
      assert.equal(result.storyNow, '2026-10-15T10:30:00.000Z');
      assert.equal(result.version, 1);
      const after = await worlds.get({ userId: f.owner }, f.id);
      assert.deepEqual(after, { ...before, time: result.storyNow, version: 1 });
      const c = await clock.read(f.owner, f.id);
      assert.equal(c.paused, false);
      assert.equal(c.speed, 12);
      assert.equal(c.storyNow, result.storyNow);
      assert.equal(c.activeUntil, '2026-10-15T12:00:45.000Z');
      const event = (
        await admin.query('SELECT payload FROM parallel_life.world_events WHERE world_id=$1', [
          f.id,
        ])
      ).rows[0].payload;
      assert.deepEqual(applyWorldHistoryEvent(f.state, event).state, {
        ...f.state,
        time: result.storyNow,
        version: 1,
      });
      const n = (
        await admin.query('SELECT count(*) n FROM parallel_life.tasks WHERE scope_id=$1', [f.id])
      ).rows[0].n;
      assert.equal(Number(n), 0);
      await clock.setClock(f.owner, f.id, { paused: true }, real);
      assert.deepEqual(await waits.wait(f.owner, f.id, f.input), result);
      assert.equal((await clock.read(f.owner, f.id)).paused, true); // receipt replay must not resume again
      await assert.rejects(
        waits.wait(f.owner, f.id, { ...f.input, target: 'morning' }),
        (e) => (e as { code: string }).code === 'IDEMPOTENCY_CONFLICT',
      );
    },
  );
  await t.test(
    'next appointment needs no venue and never moves or changes invitation dates',
    async () => {
      const f = await fixture(true);
      f.input.target = 'next_appointment';
      const result = await waits.wait(f.owner, f.id, f.input);
      assert.equal(result.storyNow, '2026-10-15T10:50:00.000Z');
      const w = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(w.space, undefined);
      assert.deepEqual(w.appointments, f.state.appointments);
    },
  );
  await t.test(
    'morning uses world next08:00 and earlier appointment stops ten minutes early',
    async () => {
      const f = await fixture();
      f.input.target = 'morning';
      assert.equal((await waits.wait(f.owner, f.id, f.input)).storyNow, '2026-10-16T00:00:00.000Z');
      const early = await fixture(true);
      early.input.target = 'morning';
      const r = await waits.wait(early.owner, early.id, early.input);
      assert.equal(r.stoppedBy.reason, 'appointment');
      assert.equal(r.targetAt, '2026-10-16T00:00:00.000Z');
      assert.equal(r.storyNow, '2026-10-15T10:50:00.000Z');
    },
  );
  await t.test(
    'other owner, stale world and stale tab sequence cannot advance or resume',
    async () => {
      const f = await fixture();
      await assert.rejects(waits.wait(f.other, f.id, f.input));
      await activity.update(
        f.owner,
        f.id,
        { clientId: f.input.clientId, sequence: 2, mode: 'away' },
        real,
      );
      await assert.rejects(
        waits.wait(f.owner, f.id, f.input),
        (e) => (e as { code: string }).code === 'VERSION_CONFLICT',
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      assert.equal((await clock.read(f.owner, f.id)).paused, true);
      await assert.rejects(
        waits.wait(f.owner, f.id, { ...f.input, sequence: 3, expectedVersion: 99 }),
      );
      const visible = await db.transaction(f.other, (sql) =>
        sql.query('SELECT * FROM parallel_life.story_wait_receipts WHERE world_id=$1', [f.id]),
      );
      assert.equal(visible.rowCount, 0);
    },
  );
  await t.test(
    'two different tab commands at one version commit at most once and create no tasks',
    async () => {
      const f = await fixture();
      const rs = await Promise.allSettled([
        waits.wait(f.owner, f.id, f.input),
        waits.wait(f.owner, f.id, { ...f.input, commandId: randomUUID(), clientId: randomUUID() }),
      ]);
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 1);
      assert.equal(
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM parallel_life.story_wait_receipts WHERE world_id=$1',
              [f.id],
            )
          ).rows[0].n,
        ),
        1,
      );
    },
  );
  await t.test(
    'receipt cannot be changed, forged from another event, or read across owners',
    async () => {
      const f = await fixture();
      const r = await waits.wait(f.owner, f.id, f.input);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query('UPDATE parallel_life.story_wait_receipts SET version=9 WHERE world_id=$1', [
            f.id,
          ]),
        ),
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            'INSERT INTO parallel_life.story_wait_receipts(world_id,owner_id,command_id,request_hash,source_event_id,version,document) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [f.id, f.owner, randomUUID(), 'a'.repeat(64), r.sourceEventId, 1, r],
          ),
        ),
      );
      assert.equal(
        (
          await db.transaction(f.other, (sql) =>
            sql.query('SELECT * FROM parallel_life.story_wait_receipts WHERE world_id=$1', [f.id]),
          )
        ).rowCount,
        0,
      );
    },
  );
});
