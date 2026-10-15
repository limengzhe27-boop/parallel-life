import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { recoverAgentTaskInTransaction } from '../../src/modules/world/infrastructure/agent-task-recovery.ts';
import {
  nativeNpcTaskHandler,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';

test('explicit original task recovery preserves known raw, fences both leases and never retries unknown calls (real PostgreSQL)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_TASK_RECOVERY_TEST_PORT ?? 55564));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    groups = new PostgresGroupRepository(db),
    tasks = new TaskRepository(db, { recoverWorldTask: recoverAgentTaskInTransaction }),
    store = new PostgresAgentRuntimeRepository(db);
  const owners: string[] = [];
  t.after(async () => {
    try {
      for (const owner of owners) {
        await admin.query('DELETE FROM parallel_life.agent_runtime_worlds WHERE owner_id=$1', [
          owner,
        ]);
        await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
      }
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actor = randomUUID(),
      other = randomUUID();
    owners.push(owner);
    await new IdentityRepository(db).ensureGuest(owner);
    const world = {
      schemaVersion: 1 as const,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic recovery',
      time: new Date().toISOString(),
      actors: [
        { id: actor, name: '甲', persona: '认真，有自己的安排。' },
        { id: other, name: '乙', persona: '独立生活。' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    const group = await groups.create(owner, {
      worldId,
      commandId: randomUUID(),
      expectedVersion: 0,
      title: '合成群',
      actorIds: [actor, other],
    });
    await db.transaction(owner, async (sql) => {
      for (const actorId of [actor, other])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId },
            agentDefinitionRef(world, actorId),
            group.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: group.version,
      });
    });
    const accepted = await groups.send(owner, {
      worldId,
      groupId: group.groupId,
      commandId: randomUUID(),
      expectedVersion: group.version,
      text: '@甲 最近怎么样？',
    });
    return { owner, worldId, actor, group, accepted };
  }
  const proposal = JSON.stringify({
    statements: [{ text: '忙完手头的事，我再告诉你。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  });
  async function faultAfterCompletion(f: Awaited<ReturnType<typeof fixture>>, shortLease = false) {
    const name = `recovery_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(
      `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.accepted.task.id}' AND NEW.status='succeeded' THEN RAISE EXCEPTION 'RECOVERY_FIXTURE_STORAGE_FAILURE'; END IF; RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE UPDATE ON parallel_life.tasks FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
    );
    let calls = 0;
    // A short lease is supplied at the real INSERT, not by weakening SQL expiry/token fences.
    const shortDb: PostgresDatabase = {
      pool: db.pool,
      close: () => db.close(),
      transaction: (ownerId, run) =>
        db.transaction(ownerId, async (sql) => {
          const proxy = new Proxy(sql, {
            get(target, property) {
              if (property !== 'query') return Reflect.get(target, property, target);
              return (query: string, values?: unknown[]) => {
                if (shortLease && query.startsWith('INSERT INTO parallel_life.agent_attempts(')) {
                  values = [...values!];
                  values[11] = new Date(Date.now() + 1200).toISOString();
                }
                return target.query(query, values);
              };
            },
          }) as SqlClient;
          return run(proxy);
        }),
    };
    try {
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(f.accepted.task.id, f.owner, kinds),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        {
          world: async (l, signal) => {
            await nativeNpcTaskHandler(shortDb, () => ({
              async complete() {
                calls++;
                return proposal;
              },
            }))(l, signal);
          },
        },
      );
    } finally {
      await admin.query(`DROP TRIGGER ${name} ON parallel_life.tasks`);
      await admin.query(`DROP FUNCTION parallel_life.${name}()`);
    }
    const attempt = await store.lookup(
      f.owner,
      f.worldId,
      nativeAgentCommandId(f.accepted.task.id, f.actor),
    );
    assert.equal(calls, 1);
    assert.equal(attempt?.status, 'response_received');
    assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'failed');
    return attempt!;
  }
  await t.test(
    'actual failed task retry/run reuses original task and expired protected completion, with no model factory',
    async () => {
      const f = await fixture(),
        old = await faultAfterCompletion(f, true);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, Date.parse(old.leaseUntil) - Date.now() + 30)),
      );
      const command = randomUUID(),
        before = await store.readResponse(f.owner, old);
      const restored = await tasks.retry(f.owner, f.accepted.task.id, command);
      assert.equal(restored.id, f.accepted.task.id);
      assert.equal(restored.status, 'queued');
      const renewed = (await store.lookup(f.owner, f.worldId, old.commandId))!;
      assert.notEqual(renewed.token, old.token);
      assert.ok(Date.parse(renewed.leaseUntil) > Date.now());
      assert.deepEqual(await store.readResponse(f.owner, renewed), before);
      await assert.rejects(store.readResponse(f.owner, old), /ATTEMPT_STALE/);
      await tasks.retry(f.owner, f.accepted.task.id, command);
      assert.equal(
        (await store.lookup(f.owner, f.worldId, old.commandId))!.token,
        renewed.token,
        'same recovery command cannot rotate again',
      );
      await assert.rejects(
        tasks.retry(f.owner, f.accepted.task.id, randomUUID()),
        /VERSION_CONFLICT/,
      );
      const lease = (await queue.claimForOwner(restored.id, f.owner, ['world']))!;
      await nativeNpcTaskHandler(db, () => {
        throw Error('MUST_NOT_CONSTRUCT_MODEL');
      })(lease, new AbortController().signal);
      assert.equal((await tasks.get(f.owner, restored.id)).status, 'succeeded');
      assert.equal((await store.lookup(f.owner, f.worldId, old.commandId))!.status, 'committed');
      assert.equal(
        (await store.read(f.owner, { worldId: f.worldId, actorId: f.actor }))!.revision,
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
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_task_recoveries WHERE owner_id=$1',
            [f.owner],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'a known raw after world changes becomes traced conflict, preserving raw and not creating a new task',
    async () => {
      const f = await fixture(),
        old = await faultAfterCompletion(f);
      // A second independent player command changes world state but cannot consume the failed task.
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      await groups.create(f.owner, {
        worldId: f.worldId,
        commandId: randomUUID(),
        expectedVersion: world.version,
        title: '另一个群',
        actorIds: [f.actor],
      });
      const result = await tasks.retry(f.owner, f.accepted.task.id, randomUUID());
      assert.equal(result.status, 'conflict');
      const latest = (await store.lookup(f.owner, f.worldId, old.commandId))!;
      assert.equal(latest.status, 'stale_discarded');
      assert.deepEqual(
        await store.readResponse(f.owner, latest),
        await store.readResponse(f.owner, old),
      );
    },
  );
  await t.test(
    'unknown after send cannot fall through to another paid task; other owner cannot recover it',
    async () => {
      const f = await fixture();
      await runOne(
        {
          claim: (kinds) => queue.claimForOwner(f.accepted.task.id, f.owner, kinds),
          renew: (l) => queue.renew(l),
          finish: (l, o) => queue.finish(l, o),
        },
        {
          world: async (lease, signal) => {
            await nativeNpcTaskHandler(db, () => ({
              async complete() {
                throw Error('SIMULATED_TRANSPORT_UNKNOWN');
              },
            }))(lease, signal);
          },
        },
      );
      await assert.rejects(tasks.retry(f.owner, f.accepted.task.id, randomUUID()), /UNKNOWN/);
      const stranger = await fixture();
      await assert.rejects(
        tasks.retry(stranger.owner, f.accepted.task.id, randomUUID()),
        /NOT_FOUND/,
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
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_task_recoveries WHERE owner_id=$1',
            [f.owner],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'SQL forbids unreceipted token rotation and raw replacement; recovery ledger is owner-only append-only',
    async () => {
      const f = await fixture(),
        old = await faultAfterCompletion(f);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query('UPDATE parallel_life.agent_attempts SET token=$2 WHERE id=$1', [
            old.id,
            randomUUID(),
          ]),
        ),
        /AGENT_RECOVERY_REQUIRED/,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query("UPDATE parallel_life.agent_attempts SET response='{}'::jsonb WHERE id=$1", [
            old.id,
          ]),
        ),
        /IMMUTABLE_AGENT_RESPONSE/,
      );
      await tasks.retry(f.owner, f.accepted.task.id, randomUUID());
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.agent_task_recoveries SET reason='changed' WHERE attempt_id=$1",
            [old.id],
          ),
        ),
        /permission denied/,
      );
      const stranger = await fixture();
      assert.equal(
        (
          await db.transaction(stranger.owner, (sql) =>
            sql.query('SELECT * FROM parallel_life.agent_task_recoveries WHERE attempt_id=$1', [
              old.id,
            ]),
          )
        ).rowCount,
        0,
      );
      const grants = (
        await admin.query(
          "SELECT has_table_privilege('pl_worker','parallel_life.agent_task_recoveries','SELECT') ok",
        )
      ).rows[0];
      assert.equal(grants.ok, false);
    },
  );
});
