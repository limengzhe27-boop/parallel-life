import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresTaskQueue,
  LeaseLost,
} from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { enqueue, requestHash } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import type { TaskLease } from '../../src/modules/tasks/domain/types.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { withLeasedAgentDatabase } from '../../src/modules/world/infrastructure/leased-agent-database.ts';

test('trusted monolith leased app facade guards every short transaction without granting worker Agent tables', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.LEASED_AGENT_DATABASE_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const appUrl = `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`;
  const workerUrl = `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`;
  const db = new PostgresDatabase(appUrl),
    worker = new PostgresDatabase(workerUrl),
    queue = new PostgresTaskQueue(workerUrl);
  const owned: { id: string; owner: string; lease: TaskLease }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          "UPDATE parallel_life.tasks SET status='cancelled',error_code='CANCELLED' WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running','unknown')",
          [f.lease.id, f.owner],
        );
    } finally {
      await db.close();
      await worker.close();
      await queue.close();
      await admin.end();
    }
  });
  async function fixture(epoch2 = true) {
    const owner = randomUUID(),
      id = randomUUID(),
      actor = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    await new PostgresWorldRepository(db).initialize(
      { userId: owner },
      {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: 'Explicit leased Agent SQL fixture',
        time: '2026-10-15T08:00:00.000Z',
        actors: [{ id: actor, name: 'Fixture actor', persona: 'Explicit synthetic actor' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );
    const state = emptyActorAgentState(
      { worldId: id, actorId: actor },
      'authored:lease-fixture',
      0,
    );
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      if (epoch2)
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: 0,
          expectedEpoch: 1,
          nextEpoch: 2,
        });
    });
    const input = {
      channel: 'private',
      worldId: id,
      actorId: actor,
      text: 'Explicit local task input',
      nested: { order: [1, 2], flag: true },
    };
    const task = await db.transaction(owner, (sql) =>
      enqueue(sql, owner, 'world', id, randomUUID(), input, requestHash(input)),
    );
    const lease = (await queue.claimForOwner(task.id, owner, ['world']))!;
    assert.ok(lease);
    const f = { owner, id, actor, lease, state };
    owned.push(f);
    return f;
  }
  async function status(id: string) {
    return (
      await admin.query('SELECT status,input,lease_until FROM parallel_life.tasks WHERE id=$1', [
        id,
      ])
    ).rows[0];
  }
  async function denied(lease: TaskLease, owner = lease.ownerId, database = db) {
    let entered = false;
    await assert.rejects(
      withLeasedAgentDatabase(database, lease).transaction(owner, async () => {
        entered = true;
      }),
      LeaseLost,
    );
    assert.equal(entered, false);
  }
  await t.test(
    'real claimed task can read Agent state through shared app pool; facade close never closes its owner',
    async () => {
      const f = await fixture();
      const facade = withLeasedAgentDatabase(db, f.lease);
      assert.equal(facade.pool, db.pool);
      assert.deepEqual(
        await new PostgresAgentRuntimeRepository(facade).read(f.owner, {
          worldId: f.id,
          actorId: f.actor,
        }),
        f.state,
      );
      const identity = await facade.transaction(
        f.owner,
        async (sql) =>
          (
            await sql.query(
              "SELECT current_user AS role,current_setting('app.user_id',true) AS owner,current_setting('app.agent_commit_attempt_id',true) AS marker",
            )
          ).rows[0],
      );
      assert.equal(identity.role, 'pl_app');
      assert.equal(identity.owner, f.owner);
      assert.ok(!identity.marker);
      await facade.close();
      assert.equal((await db.pool.query('SELECT 1 AS n')).rows[0].n, 1);
      assert.equal((await status(f.lease.id)).status, 'running');
    },
  );
  await t.test(
    'wrong transaction owner, lease owner, world, token, ID and changed nested/array input never reach callback',
    async () => {
      const f = await fixture(),
        foreign = await fixture();
      await denied(f.lease, foreign.owner);
      await denied({ ...f.lease, ownerId: foreign.owner });
      await denied({ ...f.lease, scopeId: foreign.id });
      await denied({ ...f.lease, token: randomUUID() });
      await denied({ ...f.lease, id: randomUUID() });
      await denied({
        ...f.lease,
        input: { ...(f.lease.input as object), nested: { order: [2, 1], flag: true } },
      });
      await denied({ ...f.lease, input: { ...(f.lease.input as object), extra: null } });
      assert.throws(
        () => withLeasedAgentDatabase(db, { ...f.lease, kind: 'interview' }),
        LeaseLost,
      );
      // JSON object key order is immaterial; actual nested values remain exact.
      const raw = f.lease.input as Record<string, unknown>;
      const reordered = Object.fromEntries(Object.entries(raw).reverse());
      assert.equal(
        await withLeasedAgentDatabase(db, { ...f.lease, input: reordered }).transaction(
          f.owner,
          async () => 'accepted',
        ),
        'accepted',
      );
    },
  );
  await t.test(
    'capture is detached from later lease/input mutation and rejects non-JSON input',
    async () => {
      const f = await fixture();
      const mutable = structuredClone(f.lease),
        facade = withLeasedAgentDatabase(db, mutable);
      mutable.token = randomUUID();
      mutable.ownerId = randomUUID();
      (mutable.input as Record<string, unknown>).text = 'changed after capture';
      assert.equal(
        await facade.transaction(f.owner, async () => 'original lease'),
        'original lease',
      );
      for (const invalid of [
        undefined,
        { a: undefined },
        { a: Number.NaN },
        { a: new Date() },
        { a: () => null },
        [1, , 2],
      ])
        assert.throws(() => withLeasedAgentDatabase(db, { ...f.lease, input: invalid }), LeaseLost);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      assert.throws(() => withLeasedAgentDatabase(db, { ...f.lease, input: cyclic }), LeaseLost);
    },
  );
  await t.test(
    'database status, expiry, scope kind/input and actual world owner/epoch are authoritative',
    async () => {
      for (const next of ['queued', 'cancelled', 'failed', 'unknown', 'succeeded']) {
        const f = await fixture();
        await admin.query('UPDATE parallel_life.tasks SET status=$2 WHERE id=$1', [
          f.lease.id,
          next,
        ]);
        await denied(f.lease);
        assert.equal((await status(f.lease.id)).status, next, 'no retry or status rewrite');
      }
      const expired = await fixture();
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [expired.lease.id],
      );
      await denied(expired.lease);
      const changed = await fixture();
      await admin.query(
        "UPDATE parallel_life.tasks SET input=jsonb_set(input,'{text}','\"changed in SQL\"') WHERE id=$1",
        [changed.lease.id],
      );
      await denied(changed.lease);
      const kind = await fixture();
      await admin.query("UPDATE parallel_life.tasks SET scope_kind='interview' WHERE id=$1", [
        kind.lease.id,
      ]);
      await denied(kind.lease);
      const other = await fixture(),
        mismatched = await fixture();
      await admin.query('UPDATE parallel_life.tasks SET scope_id=$2 WHERE id=$1', [
        mismatched.lease.id,
        other.id,
      ]);
      await denied({ ...mismatched.lease, scopeId: other.id });
      const old = await fixture(false);
      await denied(old.lease);
    },
  );
  await t.test(
    'every store read rechecks live lease instead of retaining authorization after cancellation',
    async () => {
      const f = await fixture(),
        facade = withLeasedAgentDatabase(db, f.lease),
        store = new PostgresAgentRuntimeRepository(facade);
      assert.ok(await store.read(f.owner, { worldId: f.id, actorId: f.actor }));
      await admin.query("UPDATE parallel_life.tasks SET status='cancelled' WHERE id=$1", [
        f.lease.id,
      ]);
      await assert.rejects(store.read(f.owner, { worldId: f.id, actorId: f.actor }), LeaseLost);
      assert.equal((await status(f.lease.id)).status, 'cancelled');
    },
  );
  await t.test(
    'actual task update lock excludes external cancellation during the short transaction and releases afterwards',
    async () => {
      const f = await fixture(),
        facade = withLeasedAgentDatabase(db, f.lease);
      let release!: () => void, arrived!: () => void;
      const entered = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const guarded = facade.transaction(f.owner, async () => {
        arrived();
        await barrier; // Local concurrency barrier only; no model/network operation.
        return 'committed before cancellation';
      });
      await entered;
      const cancel = db.transaction(f.owner, (sql) =>
        sql.query("UPDATE parallel_life.tasks SET status='cancelled' WHERE id=$1", [f.lease.id]),
      );
      try {
        await assert.rejects(
          admin.query('SELECT id FROM parallel_life.tasks WHERE id=$1 FOR UPDATE NOWAIT', [
            f.lease.id,
          ]),
          { code: '55P03' },
        );
      } finally {
        release();
      }
      assert.equal(await guarded, 'committed before cancellation');
      await cancel;
      assert.equal((await status(f.lease.id)).status, 'cancelled');
      await denied(f.lease);
    },
  );
  await t.test(
    'same-lease terminal transactions serialize before world lock; duplicate cannot enter after success',
    async () => {
      const f = await fixture(),
        facade = withLeasedAgentDatabase(db, f.lease);
      let release!: () => void,
        arrived!: () => void,
        duplicateEntered = false;
      const entered = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = facade.transaction(f.owner, async (sql) => {
        arrived();
        await barrier;
        await sql.query(
          "UPDATE parallel_life.tasks SET status='succeeded',result_version=0 WHERE id=$1",
          [f.lease.id],
        );
        return 'first terminal callback';
      });
      await entered;
      const duplicate = facade.transaction(f.owner, async () => {
        duplicateEntered = true;
      });
      // Attach rejection handlers before releasing the first transaction.
      const both = Promise.allSettled([first, duplicate]);
      try {
        await assert.rejects(
          admin.query('SELECT id FROM parallel_life.tasks WHERE id=$1 FOR UPDATE NOWAIT', [
            f.lease.id,
          ]),
          { code: '55P03' },
        );
        assert.equal(duplicateEntered, false);
      } finally {
        release();
      }
      const [a, b] = await both;
      assert.deepEqual(a, { status: 'fulfilled', value: 'first terminal callback' });
      assert.equal(b.status, 'rejected');
      if (b.status === 'rejected') assert.ok(b.reason instanceof LeaseLost);
      assert.equal(duplicateEntered, false);
      assert.equal((await status(f.lease.id)).status, 'succeeded');
    },
  );
  await t.test(
    'callback failure, expiry, identity/epoch/input changes rollback all short-transaction writes',
    async () => {
      const f = await fixture(),
        facade = withLeasedAgentDatabase(db, f.lease);
      await assert.rejects(
        facade.transaction(f.owner, async (sql) => {
          await sql.query("UPDATE parallel_life.tasks SET error_code='FIXTURE_WRITE' WHERE id=$1", [
            f.lease.id,
          ]);
          throw Error('INJECTED_CALLBACK_FAILURE');
        }),
        /INJECTED_CALLBACK_FAILURE/,
      );
      assert.equal(
        (await admin.query('SELECT error_code FROM parallel_life.tasks WHERE id=$1', [f.lease.id]))
          .rows[0].error_code,
        null,
      );
      for (const mutate of [
        (sql: Parameters<Parameters<PostgresDatabase['transaction']>[1]>[0]) =>
          sql.query(
            "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
            [f.lease.id],
          ),
        (sql: Parameters<Parameters<PostgresDatabase['transaction']>[1]>[0]) =>
          sql.query("SELECT set_config('app.user_id','wrong_owner',true)"),
        (sql: Parameters<Parameters<PostgresDatabase['transaction']>[1]>[0]) =>
          sql.query(
            'UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=3 WHERE world_id=$1',
            [f.id],
          ),
        (sql: Parameters<Parameters<PostgresDatabase['transaction']>[1]>[0]) =>
          sql.query("UPDATE parallel_life.tasks SET input='{}'::jsonb WHERE id=$1", [f.lease.id]),
        (sql: Parameters<Parameters<PostgresDatabase['transaction']>[1]>[0]) =>
          sql.query("UPDATE parallel_life.tasks SET status='unknown' WHERE id=$1", [f.lease.id]),
      ])
        await assert.rejects(
          facade.transaction(f.owner, async (sql) => {
            await mutate(sql);
          }),
          LeaseLost,
        );
      assert.equal((await status(f.lease.id)).status, 'running');
      assert.deepEqual((await status(f.lease.id)).input, f.lease.input);
      assert.equal(
        (
          await admin.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].engine_epoch,
        2,
      );
      const expiring = await fixture();
      await admin.query(
        "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()+interval '500 milliseconds' WHERE id=$1",
        [expiring.lease.id],
      );
      let entered = false;
      await assert.rejects(
        withLeasedAgentDatabase(db, expiring.lease).transaction(expiring.owner, async (sql) => {
          entered = true;
          await sql.query(
            "UPDATE parallel_life.tasks SET error_code='MUST_ROLL_BACK' WHERE id=$1",
            [expiring.lease.id],
          );
          await sql.query('SELECT pg_sleep(0.6)');
        }),
        LeaseLost,
      );
      assert.equal(entered, true);
      assert.equal(
        (
          await admin.query('SELECT error_code FROM parallel_life.tasks WHERE id=$1', [
            expiring.lease.id,
          ])
        ).rows[0].error_code,
        null,
      );
    },
  );
  await t.test(
    'callback terminal hook permits succeeded only after entering as running; business proof remains the kernel responsibility',
    async () => {
      const f = await fixture(),
        facade = withLeasedAgentDatabase(db, f.lease);
      // Explicit SQL task-status fixture only: this is not evidence of NPC/model success.
      await facade.transaction(f.owner, async (sql) => {
        await sql.query(
          "UPDATE parallel_life.tasks SET status='succeeded',result_version=0 WHERE id=$1",
          [f.lease.id],
        );
      });
      assert.equal((await status(f.lease.id)).status, 'succeeded');
      await assert.rejects(
        facade.transaction(f.owner, async () => null),
        LeaseLost,
      );
    },
  );
  await t.test(
    'worker with actual lease and forged app.user_id still cannot use Agent tables or facade',
    async () => {
      const f = await fixture();
      await denied(f.lease, f.owner, worker);
      await assert.rejects(
        worker.transaction(f.owner, async (sql) => {
          await sql.query(
            "SELECT set_config('app.task_id',$1,true),set_config('app.lease_token',$2,true)",
            [f.lease.id, f.lease.token],
          );
          await sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1',
            [f.id],
          );
        }),
        { code: '42501' },
      );
      assert.equal(
        (
          await admin.query(
            "SELECT has_table_privilege('pl_worker','parallel_life.actor_agent_states','SELECT') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
    },
  );
  await t.test(
    'pooled identity stays transaction-local across owners and facade lifetimes',
    async () => {
      const a = await fixture(),
        b = await fixture();
      await withLeasedAgentDatabase(db, a.lease).transaction(a.owner, async (sql) => {
        assert.equal(
          (await sql.query("SELECT current_setting('app.user_id',true) AS owner")).rows[0].owner,
          a.owner,
        );
      });
      await withLeasedAgentDatabase(db, b.lease).transaction(b.owner, async (sql) => {
        assert.equal(
          (await sql.query("SELECT current_setting('app.user_id',true) AS owner")).rows[0].owner,
          b.owner,
        );
        assert.equal(
          (await sql.query('SELECT id FROM parallel_life.tasks WHERE id=$1', [a.lease.id]))
            .rowCount,
          0,
        );
      });
      const clients = await Promise.all(Array.from({ length: 3 }, () => db.pool.connect()));
      try {
        for (const sql of clients)
          assert.ok(
            !(await sql.query("SELECT current_setting('app.user_id',true) AS owner")).rows[0].owner,
          );
      } finally {
        clients.forEach((sql) => sql.release());
      }
    },
  );
});
