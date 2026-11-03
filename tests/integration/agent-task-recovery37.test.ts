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
    return { owner, worldId, actor, other, group, accepted };
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
    'paid group response crosses unrelated quiet; exact attempt only, repeat recovery never rebuy',
    async () => {
      const f = await fixture(),
        old = await faultAfterCompletion(f);
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const command = randomUUID(),
        eventId = randomUUID();
      // Seed a committed other-actor quiet fixture. The recovery and worker below
      // run through the real task API, repository, lease fences and kernel.
      const event = {
        id: eventId,
        worldId: f.worldId,
        commandId: command,
        version: world.version + 1,
        type: 'agent.state_committed',
        occurredAt: world.time,
        data: {
          actorId: f.other,
          effects: [],
          agentRuntime: {
            proposal: { statements: [], actions: [] },
            stateAfter: emptyActorAgentState(
              { worldId: f.worldId, actorId: f.other },
              agentDefinitionRef(world, f.other),
              world.version + 1,
            ),
            results: [],
          },
        },
      };
      await admin.query('BEGIN');
      await admin.query(
        "SELECT set_config('app.agent_engine_epoch','2',true),set_config('app.agent_world_id',$1,true)",
        [f.worldId],
      );
      try {
        await admin.query(
          `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status)
        VALUES($1,$2,$3,$4,'quiet-fixture','{}','queued')`,
          [command, f.worldId, f.owner, world.version],
        );
        await admin.query(
          `INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [eventId, f.worldId, f.owner, event.version, command, event, world.time],
        );
        await admin.query(
          `UPDATE parallel_life.commands SET status='succeeded',result_event_id=$2,result_state='{}'::jsonb WHERE id=$1`,
          [command, eventId],
        );
        await admin.query(
          `UPDATE parallel_life.worlds SET version=$2,state=jsonb_set(state,'{version}',to_jsonb($2::int)) WHERE id=$1`,
          [f.worldId, event.version],
        );
        await admin.query('COMMIT');
      } catch (error) {
        await admin.query('ROLLBACK');
        throw error;
      }
      const unrelatedId = randomUUID();
      await admin.query(
        `INSERT INTO parallel_life.agent_attempts
        SELECT (jsonb_populate_record(NULL::parallel_life.agent_attempts,
          to_jsonb(a)||jsonb_build_object('id',$2::text,'command_id',$3::text,'actor_id',$4::text))).*
        FROM parallel_life.agent_attempts a WHERE a.id=$1`,
        [old.id, unrelatedId, nativeAgentCommandId(randomUUID(), f.other), f.other],
      );
      await admin.query('BEGIN');
      await admin.query('SELECT id FROM parallel_life.agent_attempts WHERE id=$1 FOR UPDATE', [
        unrelatedId,
      ]);
      const queries: string[] = [];
      const recoveryId = randomUUID();
      const restored = await db
        .transaction(f.owner, async (sql) => {
          await sql.query("SET LOCAL lock_timeout='500ms'");
          const traced = new Proxy(sql, {
            get(target, key) {
              if (key !== 'query') return Reflect.get(target, key, target);
              return (q: string, args?: unknown[]) => {
                queries.push(q);
                return target.query(q, args);
              };
            },
          }) as SqlClient;
          return recoverAgentTaskInTransaction(traced, f.owner, f.accepted.task.id, recoveryId);
        })
        .finally(() => admin.query('ROLLBACK'));
      assert.equal(
        (
          await admin.query('SELECT token FROM parallel_life.agent_attempts WHERE id=$1', [
            unrelatedId,
          ])
        ).rows[0].token,
        old.token,
      );
      assert.equal(restored?.status, 'queued');
      const attemptReads = queries.filter((q) => q.includes('FROM parallel_life.agent_attempts'));
      assert.ok(attemptReads.some((q) => q.includes('input_receipt_id')));
      assert.ok(
        attemptReads
          .filter((q) => q.includes('FOR UPDATE'))
          .every((q) => q.includes('id=$1 AND world_id=$2')),
      );
      assert.ok(
        attemptReads.every(
          (q) => !q.includes('SELECT * FROM parallel_life.agent_attempts WHERE world_id='),
        ),
      );
      const renewed = (await store.lookup(f.owner, f.worldId, old.commandId))!;
      assert.equal(renewed.expectedWorldVersion, old.expectedWorldVersion);
      assert.notEqual(renewed.token, old.token);
      await tasks.retry(f.owner, f.accepted.task.id, recoveryId);
      assert.equal((await store.lookup(f.owner, f.worldId, old.commandId))!.token, renewed.token);
      const lease = (await queue.claimForOwner(f.accepted.task.id, f.owner, ['world']))!;
      await nativeNpcTaskHandler(db, () => {
        throw Error('MUST_NOT_REBUY');
      })(lease, new AbortController().signal);
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'succeeded');
      assert.equal((await store.lookup(f.owner, f.worldId, old.commandId))!.status, 'committed');
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
  await t.test('member exit remains a dependency conflict and preserves the paid raw', async () => {
    const f = await fixture(),
      old = await faultAfterCompletion(f);
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    await groups.membership(f.owner, {
      worldId: f.worldId,
      groupId: f.group.groupId,
      commandId: randomUUID(),
      expectedVersion: world.version,
      participant: { kind: 'actor', actorId: f.actor },
      action: 'leave',
    });
    const result = await tasks.retry(f.owner, f.accepted.task.id, randomUUID());
    assert.equal(result.status, 'conflict');
    assert.equal(
      (await store.lookup(f.owner, f.worldId, old.commandId))!.status,
      'stale_discarded',
    );
  });
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
