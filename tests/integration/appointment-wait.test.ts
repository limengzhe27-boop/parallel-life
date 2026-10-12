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
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresAppointmentWaitRepository } from '../../src/modules/world/infrastructure/appointment-wait-repository.ts';
import { AppointmentWaitEventSchema } from '../../src/contracts/appointment-wait.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('real PG owner-scoped wait, atomic event/clock/receipt, replay, conflicts and guards (synthetic world/proposal fixtures; no model)', async (t) => {
  const cfg = await localConfig(),
    port = process.env.APPOINTMENT_WAIT_TEST_PORT ?? '55482';
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  assert.equal(cfg.port, Number(port));
  const admin = await adminClient('parallel_life_test');
  t.after(() => admin.end());
  await migrate(admin);
  const url = `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    db = new PostgresDatabase(url);
  t.after(() => db.close());
  const worlds = new PostgresWorldRepository(db),
    clock = new PostgresClockStore(db),
    identity = new IdentityRepository(db);
  const waits = new PostgresAppointmentWaitRepository(db);
  async function fixture(options: { early?: 'confirmed' | 'proposed'; crossDay?: boolean } = {}) {
    const owner = randomUUID(),
      id = randomUUID(),
      actorId = randomUUID(),
      invitationId = randomUUID(),
      earlyId = randomUUID();
    await identity.ensureGuest(owner);
    const realNow = new Date().toISOString(),
      time = '2026-10-16T08:00:00.000Z',
      source = { kind: 'seed_genesis' as const, seedId: randomUUID(), snapshotVersion: 0 as const };
    const state: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: '独立PG合成世界',
      time,
      actors: [{ id: actorId, name: '合成角色', persona: '仅测试SQL，不是真实模型' }],
      actorTies: [],
      facts: [],
      messages: [],
      notes: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'other',
        positionSource: source,
        places: [
          {
            id: 'other',
            name: '出发地点',
            description: '已有地点',
            source,
            contactActorIds: [],
            appointmentIds: options.early ? [earlyId] : [],
          },
          {
            id: 'shop',
            name: '约定地点',
            description: '已有地点',
            source,
            contactActorIds: [actorId],
            appointmentIds: [invitationId],
          },
        ],
        routes: [
          {
            id: 'to_shop',
            fromPlaceId: 'other',
            toPlaceId: 'shop',
            durationMinutes: 20,
            modeLabel: '步行',
            source,
          },
          {
            id: 'to_other',
            fromPlaceId: 'shop',
            toPlaceId: 'other',
            durationMinutes: 20,
            modeLabel: '步行',
            source,
          },
        ],
      },
    };
    await worlds.initialize({ userId: owner }, state);
    await clock.setClock(owner, id, { paused: false, speed: 1 });
    const cmd = {
      id: randomUUID(),
      worldId: id,
      expectedVersion: 0,
      actorId,
      text: '明确的本地合成输入',
    };
    const ap = {
      type: 'appointment.proposed' as const,
      id: invitationId,
      title: '本人周五约定',
      at: options.crossDay ? '2026-10-17T10:00:00.000Z' : '2026-10-16T19:30:00.000Z',
      participantIds: [actorId],
    };
    await worlds.commit({ userId: owner }, cmd, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: id,
      commandId: cmd.id,
      version: 1,
      occurredAt: realNow,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: cmd.text,
        effects: [
          {
            type: 'message.received',
            id: randomUUID(),
            actorId,
            text: '本地合成事件，不代表真实模型回复。',
          },
          ap,
          ...(options.early
            ? [
                {
                  ...ap,
                  id: earlyId,
                  title: '更早另一个地点的约定',
                  at: '2026-10-16T09:00:00.000Z',
                },
              ]
            : []),
        ],
      },
    });
    let version = 1;
    await worlds.respondToInvitation(
      { userId: owner },
      {
        commandId: randomUUID(),
        worldId: id,
        id: invitationId,
        operation: 'accept',
        expectedVersion: version++,
      },
    );
    if (options.early === 'confirmed')
      await worlds.respondToInvitation(
        { userId: owner },
        {
          commandId: randomUUID(),
          worldId: id,
          id: earlyId,
          operation: 'accept',
          expectedVersion: version++,
        },
      );
    const travel = await new PostgresWorldSpace(db, officialLifeCatalog).travel(owner, id, {
      commandId: randomUUID(),
      expectedVersion: version,
      routeId: 'to_shop',
    });
    version = travel.version;
    return {
      owner,
      id,
      actorId,
      invitationId,
      earlyId,
      version,
      travel,
      request: { commandId: randomUUID(), expectedVersion: version, invitationId },
    };
  }
  async function counts(owner: string) {
    const out: Record<string, number> = {};
    for (const table of [
      'tasks',
      'outbox_jobs',
      'world_messages',
      'world_appointments',
      'world_notes',
      'world_facts',
      'world_media_requests',
      'world_initial_snapshots',
      'player_experiences',
    ])
      out[table] = Number(
        (
          await admin.query(`SELECT count(*) AS n FROM parallel_life.${table} WHERE owner_id=$1`, [
            owner,
          ])
        ).rows[0].n,
      );
    return out;
  }
  await t.test(
    'actual20-minute travel then wait until confirmed19:30 preserves all other projections and never marks attendance',
    async () => {
      const f = await fixture(),
        before = await counts(f.owner),
        rawBefore = (
          await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [f.id])
        ).rows[0].state;
      assert.equal(Date.parse(f.travel.arrivedAt) - Date.parse(f.travel.departedAt), 20 * 60000);
      const r = await waits.wait(f.owner, f.id, f.request);
      assert.equal(r.storyNow, '2026-10-16T19:30:00.000Z');
      assert.ok(Date.parse(r.fromStoryAt) >= Date.parse(f.travel.arrivedAt));
      assert.equal(r.version, f.version + 1);
      assert.deepEqual(await counts(f.owner), before);
      const stored = (
        await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id])
      ).rows[0];
      assert.deepEqual(stored.state, { ...rawBefore, time: r.storyNow, version: r.version });
      const hydrated = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(hydrated.appointments.find((a) => a.id === f.invitationId)!.status, 'confirmed');
      assert.equal(hydrated.space!.currentPlaceId, 'shop');
      const e = AppointmentWaitEventSchema.parse(
        (
          await admin.query('SELECT payload FROM parallel_life.world_events WHERE id=$1', [
            r.sourceEventId,
          ])
        ).rows[0].payload,
      );
      assert.equal(e.commandId, f.request.commandId);
      assert.equal(e.data.toStoryAt, r.storyNow);
      const c = await clock.read(f.owner, f.id);
      assert.equal(c.storyNow, r.storyNow);
      assert.equal(c.lastTickAt, e.occurredAt);
      assert.equal(c.speed, 1);
      assert.equal(c.paused, false);
    },
  );
  await t.test(
    'original command replay after pausing and time becoming due returns the original event receipt',
    async () => {
      const f = await fixture();
      const r = await waits.wait(f.owner, f.id, f.request);
      await clock.setClock(f.owner, f.id, { paused: true });
      assert.deepEqual(await waits.wait(f.owner, f.id, f.request), r);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*) n FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
            [f.id, f.request.commandId],
          )
        ).rows[0].n,
        '1',
      );
    },
  );
  await t.test(
    'same command changed request rejects rather than targeting a different invitation',
    async () => {
      const f = await fixture();
      await waits.wait(f.owner, f.id, f.request);
      await assert.rejects(waits.wait(f.owner, f.id, { ...f.request, invitationId: f.earlyId }), {
        code: 'IDEMPOTENCY_CONFLICT',
      });
    },
  );
  await t.test(
    'other owner and direct RLS queries cannot read or replay this world/command/event',
    async () => {
      const f = await fixture(),
        other = randomUUID();
      await identity.ensureGuest(other);
      const r = await waits.wait(f.owner, f.id, f.request);
      await assert.rejects(waits.wait(other, f.id, f.request), { code: 'NOT_FOUND' });
      const rows = await db.transaction(other, async (sql) => ({
        world: (await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1', [f.id])).rowCount,
        command: (await sql.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1', [f.id]))
          .rowCount,
        event: (
          await sql.query('SELECT 1 FROM parallel_life.world_events WHERE id=$1', [r.sourceEventId])
        ).rowCount,
      }));
      assert.deepEqual(rows, { world: 0, command: 0, event: 0 });
    },
  );
  await t.test(
    'a new real database connection reconstructs the receipt from SQL without process-memory state',
    async () => {
      const f = await fixture(),
        r = await waits.wait(f.owner, f.id, f.request),
        second = new PostgresDatabase(url);
      try {
        assert.deepEqual(
          await new PostgresAppointmentWaitRepository(second).wait(f.owner, f.id, f.request),
          r,
        );
      } finally {
        await second.close();
      }
    },
  );
  await t.test('paused waiting refuses without a command, event or time update', async () => {
    const f = await fixture();
    await clock.setClock(f.owner, f.id, { paused: true });
    const old = await clock.read(f.owner, f.id);
    await assert.rejects(waits.wait(f.owner, f.id, f.request), { reason: 'PAUSED' });
    assert.equal(
      (
        await admin.query(
          'SELECT count(*) n FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
          [f.id, f.request.commandId],
        )
      ).rows[0].n,
      '0',
    );
    assert.deepEqual(await clock.read(f.owner, f.id), old);
  });
  await t.test(
    'reschedule and cancellation invalidate old expectedVersion, never silently wait to a new time',
    async () => {
      for (const operation of ['reschedule', 'cancel'] as const) {
        const f = await fixture();
        await worlds.respondToInvitation(
          { userId: f.owner },
          {
            commandId: randomUUID(),
            worldId: f.id,
            id: f.invitationId,
            operation,
            expectedVersion: f.version,
            ...(operation === 'reschedule' ? { at: '2026-10-18T10:00:00.000Z' } : {}),
          },
        );
        await assert.rejects(waits.wait(f.owner, f.id, f.request), { code: 'VERSION_CONFLICT' });
      }
    },
  );
  await t.test('earlier confirmed appointment elsewhere is not silently skipped', async () => {
    const f = await fixture({ early: 'confirmed' });
    await assert.rejects(waits.wait(f.owner, f.id, f.request), { reason: 'EARLIER_APPOINTMENT' });
  });
  await t.test(
    'optional proposed earlier invitation does not lock waiting or get auto-cancelled',
    async () => {
      const f = await fixture({ early: 'proposed' });
      await waits.wait(f.owner, f.id, f.request);
      const state = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(state.appointments.find((a) => a.id === f.earlyId)!.status, 'proposed');
    },
  );
  await t.test(
    'cross-day wait retains an actual confirmed Saturday time instead of making a synthetic attendance event',
    async () => {
      const f = await fixture({ crossDay: true });
      const r = await waits.wait(f.owner, f.id, f.request);
      assert.equal(r.storyNow, '2026-10-17T10:00:00.000Z');
      assert.notEqual(r.fromStoryAt.slice(0, 10), r.storyNow.slice(0, 10));
      assert.equal(
        (
          await admin.query(
            "SELECT count(*) n FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='scene.entered'",
            [f.id],
          )
        ).rows[0].n,
        '0',
      );
    },
  );
  await t.test(
    'real scene queued task blocks waiting; even a cancelled task does not authorize leaving an active scene',
    async () => {
      const f = await fixture();
      const entered = await new SceneRepository(db).enterPlace(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: f.version,
        placeId: 'shop',
      });
      const request = { ...f.request, expectedVersion: entered.version };
      await assert.rejects(waits.wait(f.owner, f.id, request), { code: 'BUSY' });
      await admin.query(
        "UPDATE parallel_life.tasks SET status='cancelled' WHERE scope_kind='world' AND scope_id=$1",
        [f.id],
      );
      await assert.rejects(waits.wait(f.owner, f.id, request), { reason: 'ACTIVE_SCENE' });
    },
  );
  await t.test(
    'a late clock write failure rolls back the entire event/command/state mutation',
    async () => {
      const f = await fixture(),
        before = (
          await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id])
        ).rows[0];
      await admin.query(
        `CREATE OR REPLACE FUNCTION public.test_wait_fail_clock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'INJECTED_WAIT_CLOCK_FAILURE'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        'CREATE TRIGGER test_wait_clock_failure BEFORE UPDATE ON parallel_life.world_clock FOR EACH ROW EXECUTE FUNCTION public.test_wait_fail_clock()',
      );
      try {
        await assert.rejects(waits.wait(f.owner, f.id, f.request), /INJECTED_WAIT_CLOCK_FAILURE/);
        assert.deepEqual(
          (await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id]))
            .rows[0],
          before,
        );
        assert.equal(
          (
            await admin.query(
              'SELECT count(*) n FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
              [f.id, f.request.commandId],
            )
          ).rows[0].n,
          '0',
        );
      } finally {
        await admin.query('DROP TRIGGER test_wait_clock_failure ON parallel_life.world_clock');
        await admin.query('DROP FUNCTION public.test_wait_fail_clock()');
      }
    },
  );
  await t.test(
    'different concurrent commands can only advance once; same-command retry returns the winner receipt',
    async () => {
      const f = await fixture(),
        second = { ...f.request, commandId: randomUUID() };
      const results = await Promise.allSettled([
        waits.wait(f.owner, f.id, f.request),
        waits.wait(f.owner, f.id, second),
      ]);
      const wins = results.filter((r) => r.status === 'fulfilled');
      assert.equal(wins.length, 1);
      for (const r of results)
        if (r.status === 'rejected')
          assert.ok(['BUSY', 'VERSION_CONFLICT'].includes(r.reason.code));
      const r = wins[0]!;
      if (r.status === 'fulfilled')
        assert.deepEqual(
          await waits.wait(
            f.owner,
            f.id,
            r.value.commandId === f.request.commandId ? f.request : second,
          ),
          r.value,
        );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*) n FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='appointment.waited'",
            [f.id],
          )
        ).rows[0].n,
        '1',
      );
    },
  );
});
