import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresOutboxScopeDiscovery } from '../../src/modules/tasks/infrastructure/outbox-scope-discovery.ts';
import {
  PostgresOutbox,
  taskCommandId,
} from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { createOutboxWorker } from '../../src/server/outbox-worker.ts';

test('shared restricted Outbox discovery and original owner dispatcher retain queue lifecycle', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55674);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const url = (role: string, password: string) =>
    `postgresql://${role}:${password}@127.0.0.1:${cfg.port}/parallel_life_test`;
  const app = new PostgresDatabase(url('pl_app', cfg.appPassword));
  const scheduler = new PostgresDatabase(url('pl_scheduler', cfg.schedulerPassword));
  const worker = new PostgresTaskQueue(url('pl_worker', cfg.workerPassword));
  const discovery = new PostgresOutboxScopeDiscovery(url('pl_scheduler', cfg.schedulerPassword));
  const owners: string[] = [];
  t.after(async () => {
    await Promise.all([app.close(), scheduler.close(), worker.close(), discovery.close()]);
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
    await admin.end();
  });
  async function fixture(owner = randomUUID()) {
    if (!owners.includes(owner)) {
      await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
      owners.push(owner);
    }
    const world = randomUUID();
    const state = {
      schemaVersion: 1,
      id: world,
      ownerId: owner,
      title: 'Synthetic Outbox scope fixture',
      version: 0,
      time: '2026-10-27T00:00:00.000Z',
      actors: [],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [world, owner, state.title, state],
    );
    let version = 0;
    return {
      owner,
      world,
      async job(
        options: {
          status?: string;
          type?: string;
          lease?: string;
          attempts?: number;
          eventType?: string;
          uncommitted?: boolean;
        } = {},
      ) {
        const event = randomUUID(),
          command = randomUUID(),
          id = randomUUID(),
          requestId = randomUUID();
        version++;
        const eventPayload = {
          schemaVersion: 1,
          id: event,
          worldId: world,
          commandId: command,
          version,
          occurredAt: state.time,
          type: options.eventType ?? 'agent.state_committed',
          data: {},
        };
        await admin.query(
          "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,'{}','running')",
          [command, world, owner, version - 1, '0'.repeat(64)],
        );
        await admin.query(
          'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [event, world, owner, version, command, eventPayload, state.time],
        );
        if (!options.uncommitted)
          await admin.query(
            "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE id=$1 AND world_id=$2",
            [command, world, event, { ...state, version }],
          );
        const payload = {
          id,
          eventId: event,
          worldId: world,
          type: options.type ?? 'image.generate',
          requestId,
          prompt: 'Synthetic scene reference',
        };
        await admin.query(
          'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload,status,lease_until,attempts) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            world,
            owner,
            event,
            payload,
            options.status ?? 'queued',
            options.lease ?? null,
            options.attempts ?? 0,
          ],
        );
        return { id, event, command, requestId, payload, owner, world };
      },
    };
  }
  async function discardJobs() {
    await admin.query(
      "UPDATE parallel_life.outbox_jobs SET status='failed',lease_until=NULL WHERE owner_id=ANY($1::text[]) AND status IN ('queued','running')",
      [owners],
    );
  }

  await t.test(
    'only restricted scheduler reads bounded metadata; ordinary roles receive no discovery or payload privilege',
    async () => {
      const f = await fixture(),
        j = await f.job();
      const before = (
        await admin.query(
          'SELECT to_jsonb(j) AS row FROM parallel_life.outbox_jobs j WHERE id=$1',
          [j.id],
        )
      ).rows[0].row;
      const scopes = await discovery.read(1);
      assert.deepEqual(scopes, [{ ownerId: f.owner, worldId: f.world, eventId: j.event }]);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT to_jsonb(j) AS row FROM parallel_life.outbox_jobs j WHERE id=$1',
            [j.id],
          )
        ).rows[0].row,
        before,
      );
      await assert.rejects(
        app.pool.query('SELECT * FROM parallel_life.discover_due_outbox_scopes(1,NULL)'),
        { code: '42501' },
      );
      await assert.rejects(
        worker.pool.query('SELECT * FROM parallel_life.discover_due_outbox_scopes(1,NULL)'),
        { code: '42501' },
      );
      await assert.rejects(scheduler.pool.query('SELECT payload FROM parallel_life.outbox_jobs'), {
        code: '42501',
      });
      for (const n of [0, 33, -1])
        await assert.rejects(
          scheduler.pool.query('SELECT * FROM parallel_life.discover_due_outbox_scopes($1,NULL)', [
            n,
          ]),
          { code: '22023' },
        );
      assert.equal(
        (
          await admin.query(
            "SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='parallel_life.discover_due_outbox_scopes(integer,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS ok",
          )
        ).rows[0].ok,
        false,
      );
      await discardJobs();
    },
  );
  await t.test(
    'round-robin owner metadata does not let one old owner consume every batch',
    async () => {
      const fs = [await fixture(), await fixture(), await fixture()];
      for (const f of fs) {
        await f.job();
        await f.job();
      }
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) seen.add((await discovery.read(1))[0]!.ownerId);
      assert.equal(seen.size, 3);
      const batch = await discovery.read(3);
      assert.equal(new Set(batch.map((s) => s.ownerId)).size, 3);
      await discardJobs();
    },
  );
  await t.test(
    'unknown, terminal, live leases and uncommitted sources are excluded; expired leases can be recovered',
    async () => {
      const f = await fixture();
      for (const status of ['unknown', 'submitted', 'succeeded', 'failed']) await f.job({ status });
      await f.job({ status: 'running', lease: new Date(Date.now() + 60000).toISOString() });
      await f.job({ uncommitted: true });
      const expired = await f.job({ status: 'running', lease: '2000-01-01T00:00:00.000Z' });
      assert.deepEqual(await discovery.read(4), [
        { ownerId: f.owner, worldId: f.world, eventId: expired.event },
      ]);
      await discardJobs();
    },
  );
  await t.test(
    'actor and scene media dispatch through original ports once, then original queue executes once',
    async () => {
      const f = await fixture();
      const jobs = [await f.job(), await f.job({ eventType: 'scene.opened' })];
      const drain = createOutboxWorker({
        schedulerUrl: url('pl_scheduler', cfg.schedulerPassword),
        appDb: app,
        intervalMs: 1000,
      });
      try {
        const aborted = new AbortController();
        aborted.abort();
        assert.equal((await drain.drain(aborted.signal)).claimed, 0);
        const result = await drain.drain(new AbortController().signal);
        assert.equal(result.submitted, 2);
        assert.equal(result.rejected, 0);
        assert.equal(
          (
            await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1', [
              f.owner,
            ])
          ).rows[0].n,
          2,
        );
        const again = await drain.drain(new AbortController().signal);
        assert.equal(again.claimed, 0);
        let executed = 0;
        for (let i = 0; i < 2; i++)
          assert.equal(
            await runOne(worker, {
              media: async (lease) => {
                executed++;
                await worker.finish(lease, { status: 'succeeded' });
              },
            }),
            true,
          );
        assert.equal(executed, 2);
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1 AND status='succeeded'",
              [f.owner],
            )
          ).rows[0].n,
          2,
        );
        for (const j of jobs) {
          const ports = new PostgresOutbox(app).ports(f.owner, {
            worldId: f.world,
            eventId: j.event,
          });
          assert.equal((await dispatchOutbox(ports)).claimed, 0);
        }
        assert.equal((await discovery.read(4)).length, 0);
      } finally {
        await drain.close();
      }
    },
  );
  await t.test(
    'concurrent consumers and crash after task creation reuse the same original command; unknown task is never requeued',
    async () => {
      const f = await fixture(),
        j = await f.job();
      const ports = new PostgresOutbox(app).ports(f.owner, { worldId: f.world, eventId: j.event });
      const claimed = (await ports.outbox.claim(1))[0]!;
      const created = await ports.tasks.submit(claimed);
      await admin.query(
        "UPDATE parallel_life.tasks SET status='unknown',error_code='UNKNOWN' WHERE id=$1",
        [created.taskId],
      );
      await admin.query(
        "UPDATE parallel_life.outbox_jobs SET lease_until='2000-01-01' WHERE id=$1",
        [j.id],
      );
      const results = await Promise.all([dispatchOutbox(ports), dispatchOutbox(ports)]);
      assert.equal(
        results.reduce((n, r) => n + r.claimed, 0),
        1,
      );
      assert.equal(
        (
          await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1', [
            f.owner,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (await admin.query('SELECT status FROM parallel_life.tasks WHERE id=$1', [created.taskId]))
          .rows[0].status,
        'unknown',
      );
      assert.equal(
        (
          await admin.query('SELECT provider_task_id FROM parallel_life.outbox_jobs WHERE id=$1', [
            j.id,
          ])
        ).rows[0].provider_task_id,
        created.taskId,
      );
      assert.equal((await discovery.read(4)).length, 0);
    },
  );
  await t.test(
    'one unavailable owner scope does not block another owner from reaching the original queue',
    async () => {
      const first = await fixture(),
        second = await fixture();
      const ordered = [first, second].sort((a, b) => a.owner.localeCompare(b.owner));
      const bad = ordered[0]!,
        good = ordered[1]!;
      await bad.job();
      await good.job();
      const facade = Object.create(app) as PostgresDatabase;
      facade.transaction = async (owner, run) => {
        if (owner === bad.owner) throw Error('CONTROLLED_SCOPE_UNAVAILABLE');
        return app.transaction(owner, run);
      };
      const drain = createOutboxWorker({
        schedulerUrl: url('pl_scheduler', cfg.schedulerPassword),
        appDb: facade,
      });
      try {
        await assert.rejects(drain.drain(new AbortController().signal), {
          message: 'OUTBOX_SCOPE_DISPATCH_UNAVAILABLE',
        });
        assert.equal(
          (
            await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1', [
              good.owner,
            ])
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int n FROM parallel_life.outbox_jobs WHERE owner_id=$1 AND status='queued'",
              [bad.owner],
            )
          ).rows[0].n,
          1,
        );
      } finally {
        await drain.close();
        await discardJobs();
      }
    },
  );
  await t.test('no executor rejects once and pre-existing attempt bound is retained', async () => {
    const f = await fixture(),
      missing = await f.job({ type: 'not.supported' }),
      bounded = await f.job({ attempts: 4 });
    await admin.query(
      "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status) VALUES($1,$2,'media',$3,$4,$5,'{}','failed')",
      [randomUUID(), f.owner, bounded.requestId, taskCommandId(bounded.id), '1'.repeat(64)],
    );
    const outbox = new PostgresOutbox(app);
    const a = await dispatchOutbox(
      outbox.ports(f.owner, { worldId: f.world, eventId: missing.event }),
    );
    assert.equal(a.rejected, 1);
    const b = await dispatchOutbox(
      outbox.ports(f.owner, { worldId: f.world, eventId: bounded.event }),
    );
    assert.equal(b.rejected, 1);
    const row = (
      await admin.query(
        'SELECT status,attempts,last_error FROM parallel_life.outbox_jobs WHERE id=$1',
        [bounded.id],
      )
    ).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 5);
    assert.match(row.last_error, /ATTEMPTS_EXCEEDED/);
    assert.equal((await discovery.read(4)).length, 0);
  });
});
