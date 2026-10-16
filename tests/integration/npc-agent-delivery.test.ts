import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import {
  nativeNpcTaskHandler,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { recoverAgentTaskInTransaction } from '../../src/modules/world/infrastructure/agent-task-recovery.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';

// Actual app/worker repositories and database gates; synthetic worlds and explicit local models only.
const empty = (): AgentProposal => ({
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
const reply = () => ({
  ...empty(),
  statements: [{ text: 'I will finish my own work first.', dependsOnActionIds: [] }],
});
const code = (expected: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const api = (expected: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'apiCode' in error && error.apiCode === expected;

test('ordinary NPC delivery uses actual activity gates and original zero-send identity (real PG82)', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.NPC_AGENT_DELIVERY_TEST_PORT ?? 55505));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    activity = new PostgresClockActivityRepository(db),
    store = new PostgresAgentRuntimeRepository(db),
    groups = new PostgresGroupRepository(db),
    tasks = new TaskRepository(db, { recoverWorldTask: recoverAgentTaskInTransaction });
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await queue.close();
      await worker.close();
      await db.close();
      await admin.end();
    }
  });
  const at = '2026-10-16T09:00:00.000Z';
  async function fixture(wake = false) {
    const owner = randomUUID(),
      id = randomUUID(),
      actor = randomUUID(),
      other = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    owned.push({ owner, id });
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Explicit local NPC delivery fixture',
      time: at,
      actors: [
        { id: actor, name: '甲', persona: 'Has independent plans.' },
        { id: other, name: '乙', persona: 'Has independent plans.' },
      ],
      facts: [
        {
          id: 'basis',
          kind: 'canonical',
          text: 'Explicit synthetic starting basis for an own plan.',
          visibility: { kind: 'world' },
          sourceEventId: `genesis:${id}`,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const actorId of [actor, other]) {
        const state = emptyActorAgentState(
          { worldId: id, actorId },
          agentDefinitionRef(world, actorId),
          0,
        );
        if (wake && actorId === actor) {
          state.goals.push({
            id: 'own_goal',
            summary: 'Keep my own plan',
            status: 'active',
            sourceIds: ['fact:basis'],
            resultIds: [],
          });
          state.plans.push({
            id: 'own_plan',
            goalId: 'own_goal',
            summary: 'Record my independent plan',
            status: 'active',
            sourceIds: ['fact:basis'],
            actionIds: ['own_action'],
            nextActionId: 'own_action',
            triggers: [],
            missingConditions: [],
          });
          state.actions.push({
            id: 'own_action',
            goalId: 'own_goal',
            capability: 'plan.record',
            status: 'ready',
            sourceIds: ['fact:basis'],
            targetIds: [],
            parameters: { planId: 'own_plan' },
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
          });
        }
        await initializeActorAgentStateInTransaction(sql, owner, state);
      }
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    await clocks.write(owner, id, {
      storyNow: at,
      paused: false,
      speed: 0,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const command = {
      id: randomUUID(),
      worldId: id,
      expectedVersion: 0,
      actorId: actor,
      text: 'What is your own next step?',
    };
    return { owner, id, actor, other, world, command };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function rows(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows;
  }
  async function business(f: Fixture) {
    const out: Record<string, unknown> = {
      world: (
        await admin.query('SELECT state,version FROM parallel_life.worlds WHERE id=$1', [f.id])
      ).rows,
    };
    for (const table of [
      'world_events',
      'world_messages',
      'actor_agent_states',
      'agent_action_results',
      'commands',
      'world_notes',
      'world_group_messages',
    ])
      out[table] = (
        await admin.query(
          `SELECT to_jsonb(x) row FROM parallel_life.${table} x WHERE world_id=$1 ORDER BY to_jsonb(x)::text`,
          [f.id],
        )
      ).rows;
    return out;
  }
  function identity(row: any) {
    return {
      id: row.id,
      world: row.world_id,
      actor: row.actor_id,
      command: row.command_id,
      input: row.input_receipt_id,
      hash: row.input_hash,
      epoch: row.engine_epoch,
      version: row.expected_world_version,
      revision: row.expected_actor_revision,
    };
  }
  async function inputRows(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_input_receipts WHERE world_id=$1 ORDER BY id',
        [f.id],
      )
    ).rows;
  }
  async function cancelled(f: Fixture) {
    const all = await rows(f);
    assert.equal(all.length, 1);
    assert.equal(all[0].status, 'cancelled_before_send');
    for (const key of ['sent_at', 'response_hash', 'response', 'event_id'])
      assert.equal(all[0][key], null);
    return all[0];
  }
  async function ledger(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_zero_send_recoveries WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows;
  }
  async function trigger(
    f: Fixture,
    options: {
      table: string;
      timing?: 'BEFORE' | 'AFTER';
      event?: 'INSERT' | 'UPDATE';
      when?: string;
      body: string;
    },
    run: () => Promise<void>,
  ) {
    const name = `npc76_${randomUUID().replaceAll('-', '')}`;
    await admin.query(
      `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${options.body} RETURN NEW; END $$`,
    );
    await admin.query(
      `CREATE TRIGGER ${name} ${options.timing ?? 'BEFORE'} ${options.event ?? 'INSERT'} ON parallel_life.${options.table} FOR EACH ROW WHEN (NEW.world_id='${f.id}'${options.when ? ' AND ' + options.when : ''}) EXECUTE FUNCTION parallel_life.${name}()`,
    );
    try {
      await run();
    } finally {
      await admin.query(`DROP TRIGGER ${name} ON parallel_life.${options.table}`);
      await admin.query(`DROP FUNCTION parallel_life.${name}()`);
    }
  }
  async function pauseAtClaim(f: Fixture, run: () => Promise<void>) {
    return trigger(
      f,
      {
        table: 'agent_attempts',
        body: `UPDATE parallel_life.world_clock SET paused=true WHERE world_id=NEW.world_id;`,
      },
      run,
    );
  }
  function privateService(complete: () => Promise<string>) {
    return npcAgentServices(db, () => ({
      async complete() {
        assert.equal(db.pool.totalCount, db.pool.idleCount, 'model must not hold SQL transaction');
        return complete();
      },
    }));
  }
  const snapshots = new PostgresDirectorSnapshotRepository(db);
  function wakeService(f: Fixture, calls: { npc: number; director: number }) {
    return npcAgentAdvanceServices(
      db,
      () => ({
        async complete(messages) {
          const p = JSON.parse(messages[1]!.content);
          assert.equal(db.pool.totalCount, db.pool.idleCount);
          if (p.promptVersion.startsWith('director-')) {
            calls.director++;
            return JSON.stringify({
              mode: 'quiet',
              selectedCandidateIds: [],
              deferred: p.candidates.map((c: { id: string }) => ({
                candidateId: c.id,
                reason: 'Explicit local quiet',
              })),
              nudges: [],
              opportunities: [],
              audit: { reason: 'No unrelated paid NPC wake', basisSourceIds: [] },
            });
          }
          calls.npc++;
          const action = p.state.actions.find((a: { status: string }) => a.status === 'ready'),
            plan = p.state.plans.find((v: { id: string }) => v.id === action.parameters.planId);
          return JSON.stringify({
            ...empty(),
            plans: [plan],
            actions: [action],
            statements: [{ text: 'Continuing my own plan.', dependsOnActionIds: [action.id] }],
          });
        },
      }),
      snapshots,
    );
  }
  async function groupFixture() {
    const f = await fixture();
    const group = await groups.create(f.owner, {
      worldId: f.id,
      commandId: randomUUID(),
      expectedVersion: 0,
      title: 'Local original task group',
      actorIds: [f.actor, f.other],
    });
    const accepted = await groups.send(f.owner, {
      worldId: f.id,
      commandId: randomUUID(),
      expectedVersion: group.version,
      groupId: group.groupId,
      text: '@甲 What is your plan?',
    });
    return { ...f, group, accepted };
  }
  type GroupFixture = Awaited<ReturnType<typeof groupFixture>>;
  async function runGroup(f: GroupFixture, calls: { value: number }) {
    return runOne(
      {
        claim: (kinds) => queue.claimForOwner(f.accepted.task.id, f.owner, kinds),
        renew: (l) => queue.renew(l),
        finish: (l, o) => queue.finish(l, o),
      },
      {
        world: async (l, signal) => {
          await nativeNpcTaskHandler(db, () => ({
            async complete() {
              calls.value++;
              assert.equal(db.pool.totalCount, db.pool.idleCount);
              return JSON.stringify(reply());
            },
          }))(l, signal);
        },
      },
    );
  }

  await t.test(
    'migration82 checksum, append-only recovery ledger, owner RLS and worker denial are real',
    async () => {
      const raw = await readFile(
        new URL('../../db/migrations/0082_agent_zero_send_recovery.sql', import.meta.url),
        'utf8',
      );
      assert.equal(
        (
          await admin.query(
            "SELECT checksum FROM public.pl_migrations WHERE name='0082_agent_zero_send_recovery.sql'",
          )
        ).rows[0].checksum,
        createHash('sha256').update(raw).digest('hex'),
      );
      const f = await fixture();
      assert.equal(
        (
          await db.transaction(f.owner, (sql) =>
            sql.query('SELECT * FROM parallel_life.agent_zero_send_recoveries WHERE world_id=$1', [
              f.id,
            ]),
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        worker.transaction(f.owner, (sql) =>
          sql.query('SELECT * FROM parallel_life.agent_zero_send_recoveries WHERE world_id=$1', [
            f.id,
          ]),
        ),
        code('42501'),
      );
    },
  );
  await t.test(
    'private player pause in actual claim cancels unsent and resumes exact command/input/attempt once',
    async () => {
      const f = await fixture();
      let calls = 0;
      const service = privateService(async () => {
          calls++;
          return JSON.stringify(reply());
        }),
        before = await business(f);
      await pauseAtClaim(f, async () => {
        await assert.rejects(
          service.sendMessageIfEnabled(f.owner, f.command),
          api('INVALID_STATE'),
        );
      });
      assert.equal(calls, 0);
      const old = await cancelled(f),
        inputs = await inputRows(f);
      assert.equal(inputs.length, 1);
      assert.deepEqual(await business(f), before);
      const original = (await store.lookup(f.owner, f.id, f.command.id))!;
      await clocks.setClock(f.owner, f.id, { paused: false });
      const result = await service.sendMessageIfEnabled(f.owner, f.command);
      assert.equal(result?.status, 'committed');
      assert.equal(calls, 1);
      const now = (await rows(f))[0];
      assert.deepEqual(identity(now), identity(old));
      assert.notEqual(now.token, old.token);
      assert.ok(new Date(now.lease_until).getTime() > new Date(old.lease_until).getTime());
      assert.equal(now.status, 'committed');
      assert.deepEqual(await inputRows(f), inputs);
      assert.equal((await ledger(f)).length, 1);
      const recovery = (await ledger(f))[0],
        stranger = randomUUID();
      await new IdentityRepository(db).ensureGuest(stranger);
      assert.equal(
        (
          await db.transaction(stranger, (sql) =>
            sql.query('SELECT * FROM parallel_life.agent_zero_send_recoveries WHERE id=$1', [
              recovery.id,
            ]),
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            'UPDATE parallel_life.agent_zero_send_recoveries SET next_token=next_token WHERE id=$1',
            [recovery.id],
          ),
        ),
        code('42501'),
      );
      await assert.rejects(
        admin.query(
          'UPDATE parallel_life.agent_zero_send_recoveries SET next_token=next_token WHERE id=$1',
          [recovery.id],
        ),
        (e) => code('23514')(e) && /IMMUTABLE_AGENT_RECORD/.test(String(e)),
      );
      assert.deepEqual((await ledger(f))[0], recovery);
      await assert.rejects(store.readResponse(f.owner, original), code('ATTEMPT_STALE'));
      await clocks.setClock(f.owner, f.id, { paused: true });
      assert.equal(
        (await service.sendMessageIfEnabled(f.owner, f.command))?.eventId,
        result?.eventId,
      );
      assert.equal(calls, 1);
      assert.equal((await rows(f)).length, 1);
      assert.equal((await ledger(f)).length, 1);
    },
  );
  await t.test(
    'concurrent same ID recovery rotates once; old token cannot send while the resumed model is running',
    async () => {
      const f = await fixture();
      let calls = 0,
        enter!: () => void,
        release!: () => void;
      const entered = new Promise<void>((r) => (enter = r)),
        held = new Promise<void>((r) => (release = r));
      const service = privateService(async () => {
        calls++;
        enter();
        await held;
        return JSON.stringify(reply());
      });
      await pauseAtClaim(f, async () => {
        await assert.rejects(
          service.sendMessageIfEnabled(f.owner, f.command),
          api('INVALID_STATE'),
        );
      });
      const old = (await store.lookup(f.owner, f.id, f.command.id))!;
      await clocks.setClock(f.owner, f.id, { paused: false });
      const first = service.sendMessageIfEnabled(f.owner, f.command);
      await entered;
      try {
        await assert.rejects(service.sendMessageIfEnabled(f.owner, f.command), api('BUSY'));
        await assert.rejects(store.mark(f.owner, old, 'request_sent'), code('ATTEMPT_STALE'));
        assert.equal(calls, 1);
        assert.equal((await ledger(f)).length, 1);
      } finally {
        release();
      }
      assert.equal((await first)?.status, 'committed');
      assert.equal(calls, 1);
      assert.equal((await rows(f)).length, 1);
    },
  );
  await t.test(
    'actual own-plan wake pause cancels before send, then same stable wake resumes and executes once',
    async () => {
      const f = await fixture(true),
        calls = { npc: 0, director: 0 },
        service = wakeService(f, calls),
        before = await business(f);
      await pauseAtClaim(f, async () => {
        assert.equal((await service.advanceIfEnabled(f.owner, f.id))?.played, 0);
      });
      assert.equal(calls.npc, 0);
      const old = await cancelled(f),
        inputs = await inputRows(f);
      assert.equal(inputs[0].document.origin, 'wake');
      assert.deepEqual(await business(f), before);
      await clocks.setClock(f.owner, f.id, { paused: false });
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(calls.npc, 1);
      const now = (await rows(f))[0];
      assert.deepEqual(identity(now), identity(old));
      assert.notEqual(now.token, old.token);
      assert.equal(now.status, 'committed');
      assert.deepEqual(await inputRows(f), inputs);
      assert.equal((await ledger(f)).length, 1);
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(calls.npc, 1);
    },
  );
  for (const result of ['unknown', 'invalid'] as const)
    await t.test(
      `paid ${result} cannot reopen and SQL cannot erase send or response evidence`,
      async () => {
        const f = await fixture();
        let calls = 0;
        const service = privateService(async () => {
          calls++;
          if (result === 'unknown') throw Error('EXPLICIT_LOCAL_TRANSPORT_UNKNOWN');
          return 'EXPLICIT_LOCAL_INVALID_JSON';
        });
        await assert.rejects(
          service.sendMessageIfEnabled(f.owner, f.command),
          api(result === 'unknown' ? 'UNKNOWN' : 'INVALID_AI_OUTPUT'),
        );
        const old = (await store.lookup(f.owner, f.id, f.command.id))!,
          row = (await rows(f))[0];
        assert.equal(old.status, result === 'unknown' ? 'unknown_after_send' : 'invalid_output');
        assert.ok(row.sent_at);
        assert.equal((await store.claim(f.owner, old)).replay, true);
        await assert.rejects(
          service.sendMessageIfEnabled(f.owner, f.command),
          api(result === 'unknown' ? 'UNKNOWN' : 'INVALID_AI_OUTPUT'),
        );
        assert.equal(calls, 1);
        await assert.rejects(
          db.transaction(f.owner, (sql) =>
            sql.query(
              'UPDATE parallel_life.agent_attempts SET sent_at=NULL WHERE world_id=$1 AND id=$2',
              [f.id, old.id],
            ),
          ),
          (e) => code('23514')(e) && /IMMUTABLE_AGENT_SEND/.test(String(e)),
        );
        await assert.rejects(
          db.transaction(f.owner, (sql) =>
            sql.query(
              "UPDATE parallel_life.agent_attempts SET status='reserved' WHERE world_id=$1 AND id=$2",
              [f.id, old.id],
            ),
          ),
          (e) => code('23514')(e) && /AGENT_ZERO_SEND_RECOVERY_REQUIRED/.test(String(e)),
        );
        if (result === 'invalid')
          await assert.rejects(
            db.transaction(f.owner, (sql) =>
              sql.query(
                'UPDATE parallel_life.agent_attempts SET response_hash=NULL,response=NULL WHERE world_id=$1 AND id=$2',
                [f.id, old.id],
              ),
            ),
            (e) => code('23514')(e) && /IMMUTABLE_AGENT_RESPONSE/.test(String(e)),
          );
        assert.deepEqual(await rows(f), [row]);
        assert.equal((await ledger(f)).length, 0);
      },
    );
  await t.test(
    'actually paid stale response cannot use zero-send recovery after another actor changes the world',
    async () => {
      const f = await fixture();
      let paidA = 0,
        paidB = 0;
      const other = privateService(async () => {
          paidB++;
          return JSON.stringify(reply());
        }),
        service = privateService(async () => {
          paidA++;
          await other.sendMessageIfEnabled(f.owner, {
            ...f.command,
            id: randomUUID(),
            actorId: f.other,
          });
          return JSON.stringify(reply());
        });
      await assert.rejects(
        service.sendMessageIfEnabled(f.owner, f.command),
        code('VERSION_CONFLICT'),
      );
      const a = (await store.lookup(f.owner, f.id, f.command.id))!,
        row = (await rows(f)).find((r) => r.id === a.id);
      assert.equal(row.status, 'stale_discarded');
      assert.ok(row.sent_at);
      assert.ok(row.response_hash);
      await assert.rejects(
        service.sendMessageIfEnabled(f.owner, f.command),
        api('INVALID_AI_OUTPUT'),
      );
      assert.equal(paidA, 1);
      assert.equal(paidB, 1);
      assert.equal((await store.claim(f.owner, a)).replay, true);
      assert.equal((await ledger(f)).length, 0);
      assert.deepEqual(
        (await rows(f)).find((r) => r.id === a.id),
        row,
      );
    },
  );
  await t.test(
    'activity expiring inside real request_sent SQL rolls send back and cancels with long execution lease',
    async () => {
      const f = await fixture();
      let calls = 0;
      const service = privateService(async () => {
        calls++;
        return JSON.stringify(reply());
      });
      const seq = `npc76_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE SEQUENCE parallel_life.${seq}`);
      await admin.query(`GRANT USAGE,SELECT ON SEQUENCE parallel_life.${seq} TO pl_app`);
      try {
        await trigger(
          f,
          {
            table: 'agent_attempts',
            body: "UPDATE parallel_life.world_clock SET managed=true,active_until=clock_timestamp()+interval '1 second' WHERE world_id=NEW.world_id;",
          },
          async () => {
            await trigger(
              f,
              {
                table: 'agent_attempts',
                timing: 'AFTER',
                event: 'UPDATE',
                when: "NEW.status='request_sent'",
                body: `PERFORM nextval('parallel_life.${seq}'); PERFORM pg_sleep(1.3);`,
              },
              async () => {
                await assert.rejects(
                  service.sendMessageIfEnabled(f.owner, f.command),
                  api('INVALID_STATE'),
                );
              },
            );
          },
        );
        assert.equal(
          (await admin.query(`SELECT last_value,is_called FROM parallel_life.${seq}`)).rows[0]
            .is_called,
          true,
        );
        assert.equal(calls, 0);
        const old = await cancelled(f);
        assert.ok(new Date(old.lease_until).getTime() > Date.now() + 120000);
        await activity.update(f.owner, f.id, {
          clientId: randomUUID(),
          sequence: 0,
          mode: 'browsing',
          resume: true,
        });
        await service.sendMessageIfEnabled(f.owner, f.command);
        assert.equal(calls, 1);
        assert.equal((await rows(f))[0].status, 'committed');
      } finally {
        await admin.query(`DROP SEQUENCE parallel_life.${seq}`);
      }
    },
  );
  await t.test(
    'final commit SQL crosses actual activity expiry, rolls all business writes back, and resumes exact protected raw free',
    async () => {
      const f = await fixture();
      let calls = 0;
      const service = privateService(async () => {
          calls++;
          await activity.update(f.owner, f.id, {
            clientId: randomUUID(),
            sequence: 0,
            mode: 'browsing',
          });
          await admin.query(
            "UPDATE parallel_life.world_clock SET active_until=clock_timestamp()+interval '2 seconds' WHERE world_id=$1 AND owner_id=$2",
            [f.id, f.owner],
          );
          return JSON.stringify(reply());
        }),
        before = await business(f),
        seq = `npc76_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE SEQUENCE parallel_life.${seq}`);
      await admin.query(`GRANT USAGE,SELECT ON SEQUENCE parallel_life.${seq} TO pl_app`);
      try {
        await trigger(
          f,
          {
            table: 'commands',
            timing: 'AFTER',
            event: 'UPDATE',
            when: "NEW.status='succeeded'",
            body: `IF nextval('parallel_life.${seq}')=1 THEN IF (SELECT active_until<=clock_timestamp() FROM parallel_life.world_clock WHERE world_id=NEW.world_id) THEN RAISE EXCEPTION 'NPC76_ENTRY_ALREADY_EXPIRED'; END IF; PERFORM pg_sleep(EXTRACT(EPOCH FROM((SELECT active_until FROM parallel_life.world_clock WHERE world_id=NEW.world_id)-clock_timestamp()))+0.1); END IF;`,
          },
          async () => {
            await assert.rejects(
              service.sendMessageIfEnabled(f.owner, f.command),
              api('INVALID_STATE'),
            );
          },
        );
        assert.equal(
          (await admin.query(`SELECT is_called FROM parallel_life.${seq}`)).rows[0].is_called,
          true,
        );
        const old = (await rows(f))[0];
        assert.equal(old.status, 'response_received');
        assert.ok(old.sent_at);
        assert.ok(old.response_hash);
        assert.ok(new Date(old.lease_until).getTime() > Date.now() + 120000);
        assert.deepEqual(await business(f), before);
        assert.equal(calls, 1);
        const original = (await store.lookup(f.owner, f.id, f.command.id))!,
          raw = await store.readResponse(f.owner, original);
        await activity.update(f.owner, f.id, {
          clientId: randomUUID(),
          sequence: 0,
          mode: 'browsing',
          resume: true,
        });
        assert.equal((await service.sendMessageIfEnabled(f.owner, f.command))?.status, 'committed');
        assert.equal(calls, 1);
        const now = (await rows(f))[0];
        assert.deepEqual(identity(now), identity(old));
        assert.equal(now.token, old.token);
        assert.equal(now.response_hash, old.response_hash);
        assert.deepEqual(
          await store.readResponse(f.owner, (await store.lookup(f.owner, f.id, f.command.id))!),
          raw,
        );
        assert.equal((await ledger(f)).length, 0);
      } finally {
        await admin.query(`DROP SEQUENCE parallel_life.${seq}`);
      }
    },
  );
  await t.test(
    'original group task paused after actor claim requeues same task and rotates same child attempt on next worker',
    async () => {
      const f = await groupFixture(),
        calls = { value: 0 };
      await pauseAtClaim(f, async () => {
        assert.equal(await runGroup(f, calls), true);
      });
      assert.equal(calls.value, 0);
      const old = await cancelled(f),
        original = (await store.lookup(
          f.owner,
          f.id,
          nativeAgentCommandId(f.accepted.task.id, f.actor),
        ))!;
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'failed');
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).errorCode, 'INVALID_STATE');
      await assert.rejects(
        tasks.retry(f.owner, f.accepted.task.id, randomUUID()),
        code('NPC_DELIVERY_DEFERRED'),
      );
      await clocks.setClock(f.owner, f.id, { paused: false });
      const retryId = randomUUID(),
        queued = await tasks.retry(f.owner, f.accepted.task.id, retryId);
      assert.equal(queued.id, f.accepted.task.id);
      assert.equal(queued.status, 'queued');
      assert.equal(
        (await store.lookup(f.owner, f.id, original.commandId))!.token,
        original.token,
        'retry queues; only actual claim may rotate',
      );
      await tasks.retry(f.owner, f.accepted.task.id, retryId);
      assert.equal(await runGroup(f, calls), true);
      assert.equal(calls.value, 1);
      const now = (await rows(f))[0];
      assert.deepEqual(identity(now), identity(old));
      assert.notEqual(now.token, old.token);
      assert.equal(now.status, 'committed');
      await assert.rejects(store.readResponse(f.owner, original), code('ATTEMPT_STALE'));
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'succeeded');
      assert.equal(
        (
          await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1', [
            f.owner,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal((await ledger(f)).length, 1);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_zero_send_task_requeues WHERE task_id=$1',
            [f.accepted.task.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'group task paused before any actor attempt retries original task with null-attempt audit and no replacement input',
    async () => {
      const f = await groupFixture(),
        calls = { value: 0 },
        inputs = await inputRows(f);
      await clocks.setClock(f.owner, f.id, { paused: true });
      assert.equal(await runGroup(f, calls), true);
      assert.equal(calls.value, 0);
      assert.equal((await rows(f)).length, 0);
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'failed');
      await clocks.setClock(f.owner, f.id, { paused: false });
      const retryId = randomUUID(),
        queued = await tasks.retry(f.owner, f.accepted.task.id, retryId);
      assert.equal(queued.id, f.accepted.task.id);
      assert.equal(queued.status, 'queued');
      await tasks.retry(f.owner, f.accepted.task.id, retryId);
      const audit = (
        await admin.query(
          'SELECT * FROM parallel_life.agent_zero_send_task_requeues WHERE task_id=$1',
          [f.accepted.task.id],
        )
      ).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].attempt_id, null);
      assert.equal(audit[0].prior_token, null);
      assert.equal(await runGroup(f, calls), true);
      assert.equal(calls.value, 1);
      assert.equal((await tasks.get(f.owner, f.accepted.task.id)).status, 'succeeded');
      assert.deepEqual(await inputRows(f), inputs);
      assert.equal((await rows(f)).length, 1);
      assert.equal(
        (await rows(f))[0].command_id,
        nativeAgentCommandId(f.accepted.task.id, f.actor),
      );
      assert.equal(
        (
          await admin.query('SELECT count(*)::int n FROM parallel_life.tasks WHERE owner_id=$1', [
            f.owner,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal((await ledger(f)).length, 0);
    },
  );
});
