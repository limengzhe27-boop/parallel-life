import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentAttempt,
  ActorAgentState,
  AgentInputReceipt,
} from '../../src/modules/world/domain/agent-runtime.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  beginAgentCommitInTransaction,
  beginAgentCommitFrameInTransaction,
  finishAgentCommitInTransaction,
  supersedeAutomaticActorAttemptsInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
const at = '2026-10-15T07:00:00.000Z';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('persistent agent runtime uses short claims, scoped state and atomic world fences', async (t) => {
  const config = await localConfig();
  assert.equal(config.port, Number(process.env.AGENT_RUNTIME_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await worker.close();
    await admin.end();
  });
  const store = new PostgresAgentRuntimeRepository(app);
  async function fixture(active = true) {
    const owner = randomUUID(),
      foreign = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    await new IdentityRepository(app).ensureGuest(foreign);
    const world = {
      id: worldId,
      ownerId: owner,
      title: 'Runtime fixture',
      version: 0,
      time: at,
      actors: [
        { id: a, name: 'A', persona: 'A' },
        { id: b, name: 'B', persona: 'B' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, owner, world.title, world],
    );
    const state = emptyActorAgentState({ worldId, actorId: a }, 'authored:fixture', 0);
    await app.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(sql, owner, state);
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId: b }, 'authored:B', 0),
      );
      if (active)
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        });
    });
    const receipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: hash('actual input'),
      channel: 'private',
      threadId: a,
      recipientActorId: a,
      expectedWorldVersion: 0,
      receivedAt: at,
      storyAt: at,
      origin: 'player',
      text: '我暂不参加，请按自己的计划继续。',
    };
    return { owner, foreign, worldId, a, b, world, state, receipt };
  }
  async function claim(
    f: Awaited<ReturnType<typeof fixture>>,
    overrides: Partial<Parameters<typeof store.claim>[1]> = {},
  ) {
    const r = await store.accept(f.owner, f.receipt);
    return store.claim(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.a,
      commandId: randomUUID(),
      inputReceiptId: r.receipt.id,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      inputHash: f.receipt.inputHash,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 60000).toISOString(),
      ...overrides,
    });
  }
  async function raw(ownerId: string, a: AgentAttempt) {
    const value = await store.readResponse(ownerId, a);
    assert.equal(value.found, true);
    return value.found ? value.response : undefined;
  }
  async function response(f: Awaited<ReturnType<typeof fixture>>) {
    let a = (await claim(f)).attempt;
    a = await store.mark(f.owner, a, 'request_sent');
    return store.saveResponse(f.owner, a, { text: '我打算先列一份清单。' });
  }
  async function writeWorld(
    sql: any,
    f: Awaited<ReturnType<typeof fixture>>,
    a: AgentAttempt,
    eventId: string,
    eventType = 'turn.resolved',
    eventActor = f.a,
  ) {
    const version = a.expectedWorldVersion + 1;
    const next = { ...f.world, version };
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$5,$4,'{}','running')",
      [a.commandId, f.worldId, f.owner, a.inputHash, a.expectedWorldVersion],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$7,$4,$5,$6)',
      [
        eventId,
        f.worldId,
        f.owner,
        a.commandId,
        { type: eventType, storyAt: at, data: { actorId: eventActor } },
        at,
        version,
      ],
    );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
      [f.worldId, a.commandId, eventId, next],
    );
    await sql.query('UPDATE parallel_life.worlds SET version=$3,state=$2 WHERE id=$1', [
      f.worldId,
      next,
      version,
    ]);
    await sql.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), f.worldId, f.owner, eventId, { kind: 'agent_result' }],
    );
  }
  await t.test(
    'unrelated world changes admit private input without rewriting its identity',
    async () => {
      const f = await fixture();
      await seedChannelEvent(f, 1, 'agent.state_committed', { actorId: f.b });
      const accepted = await store.accept(f.owner, f.receipt);
      assert.equal(accepted.receipt.expectedWorldVersion, 0);
      assert.equal(accepted.receipt.inputHash, f.receipt.inputHash);
      const a = (await claim(f, { expectedWorldVersion: 1 })).attempt;
      assert.equal(a.expectedWorldVersion, 1);
      assert.deepEqual((await store.accept(f.owner, f.receipt)).receipt, accepted.receipt);
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, text: 'different' }),
        /COMMAND_CONFLICT/,
      );
      for (const changed of [
        { expectedWorldVersion: 2 },
        { channel: 'group' as const },
        { origin: 'wake' as const },
        { threadId: f.b },
      ]) {
        await assert.rejects(
          () =>
            store.accept(f.owner, {
              ...f.receipt,
              id: randomUUID(),
              commandId: randomUUID(),
              ...changed,
            }),
          /VERSION_CONFLICT/,
        );
      }
    },
  );
  await t.test(
    'recipient changes after acceptance stop a stale input before a model claim',
    async () => {
      const f = await fixture();
      await store.accept(f.owner, f.receipt);
      await seedChannelEvent(f, 1, 'agent.state_committed', { actorId: f.b });
      await admin.query(
        "UPDATE parallel_life.actor_agent_states SET projected_world_version=1,document=jsonb_set(document,'{projectedWorldVersion}','1') WHERE world_id=$1 AND actor_id=$2",
        [f.worldId, f.a],
      );
      await assert.rejects(() => claim(f, { expectedWorldVersion: 1 }), /VERSION_CONFLICT/);
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, id: randomUUID(), commandId: randomUUID() }),
        /VERSION_CONFLICT/,
      );
      assert.equal((await store.accept(f.owner, f.receipt)).replay, true);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'streamed recipient speech blocks stale replies before actor state is finalized',
    async () => {
      const f = await fixture();
      const eventId = await seedChannelEvent(f, 1, 'turn.resolved', { actorId: f.a });
      await app.transaction(f.owner, async (sql) => {
        await sql.query(
          'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
          [
            randomUUID(),
            f.worldId,
            f.owner,
            f.a,
            { sourceEventId: eventId, text: 'A new question' },
          ],
        );
      });
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, id: randomUUID(), commandId: randomUUID() }),
        /VERSION_CONFLICT/,
      );
      const other = await store.accept(f.owner, {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        recipientActorId: f.b,
        threadId: f.b,
      });
      assert.equal(other.receipt.expectedWorldVersion, 0);
    },
  );
  await t.test('reads do not initialize and actor/world/owner scopes remain distinct', async () => {
    const f = await fixture();
    assert.equal(
      (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.definitionRef,
      'authored:fixture',
    );
    assert.equal(
      (await store.read(f.owner, { worldId: f.worldId, actorId: f.b }))?.definitionRef,
      'authored:B',
    );
    assert.equal(await store.read(f.owner, { worldId: f.worldId, actorId: 'not_an_actor' }), null);
    await assert.rejects(
      () => store.read(f.foreign, { worldId: f.worldId, actorId: f.a }),
      /NOT_FOUND/,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.actor_agent_states WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].n,
      2,
    );
  });
  await t.test(
    'input acceptance is durable, immutable, replayable and body-bound before model',
    async () => {
      const f = await fixture(),
        r = await store.accept(f.owner, f.receipt);
      assert.equal(r.replay, false);
      const replay = await store.accept(f.owner, {
        ...f.receipt,
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
      });
      assert.equal(replay.receipt.id, r.receipt.id);
      assert.equal(replay.replay, true);
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, text: 'Changed but same hash' }),
        /COMMAND_CONFLICT/,
      );
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, inputHash: hash('changed') }),
        /COMMAND_CONFLICT/,
      );
      await assert.rejects(() => store.accept(f.foreign, f.receipt), /NOT_FOUND/);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_input_receipts WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'concurrent duplicate claims have one reservation and exact replay, no transaction retained',
    async () => {
      const f = await fixture();
      await store.accept(f.owner, f.receipt);
      const input = {
        id: randomUUID(),
        worldId: f.worldId,
        actorId: f.a,
        commandId: randomUUID(),
        inputReceiptId: f.receipt.id,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        inputHash: f.receipt.inputHash,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 60000).toISOString(),
      };
      const out = await Promise.all([
        store.claim(f.owner, input),
        store.claim(f.owner, { ...input, id: randomUUID(), token: randomUUID() }),
      ]);
      assert.equal(out.filter((x) => !x.replay).length, 1);
      assert.equal(out[0].attempt.id, out[1].attempt.id);
      assert.equal(app.pool.totalCount, app.pool.idleCount);
      await assert.rejects(
        () => store.claim(f.owner, { ...input, inputHash: hash('different') }),
        /COMMAND_CONFLICT/,
      );
      await assert.rejects(() => claim(f), /ATTEMPT_PENDING/);
    },
  );
  await t.test(
    'unknown sent calls cannot be stolen or implicitly retried and do not authorize execution',
    async () => {
      const f = await fixture();
      let a = (await claim(f)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      a = await store.mark(f.owner, a, 'unknown_after_send');
      const again = await store.claim(f.owner, { ...a, id: randomUUID(), token: randomUUID() });
      assert.equal(again.replay, true);
      assert.equal(again.attempt.status, 'unknown_after_send');
      await assert.rejects(() => store.mark(f.owner, a, 'reserved'), /INVALID_ATTEMPT_TRANSITION/);
      await assert.rejects(() => claim(f), /ATTEMPT_PENDING/);
      await assert.rejects(
        () => app.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, a)),
        /ATTEMPT_STALE/,
      );
      a = await store.saveResponse(f.owner, a, { late: 'received' });
      assert.equal(a.status, 'response_received');
      assert.deepEqual(await raw(f.owner, a), { late: 'received' });
    },
  );
  await t.test(
    'wrong tokens and foreign responses fail; raw response is immutable and private',
    async () => {
      const f = await fixture(),
        a = await response(f);
      await assert.rejects(() => store.readResponse(f.foreign, a), /NOT_FOUND/);
      await assert.rejects(
        () => store.saveResponse(f.owner, { ...a, token: randomUUID() }, 'changed'),
        /ATTEMPT_STALE/,
      );
      await assert.rejects(() => store.saveResponse(f.owner, a, 'changed'), /RESPONSE_CONFLICT/);
      assert.deepEqual(await raw(f.owner, a), { text: '我打算先列一份清单。' });
      await assert.rejects(() => store.mark(f.owner, a, 'committed'), /ATOMIC_COMMIT_REQUIRED/);
    },
  );
  await t.test(
    'response after engine invalidation is retained as stale and cannot execute',
    async () => {
      const f = await fixture();
      let a = (await claim(f)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      await admin.query(
        'UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=3 WHERE world_id=$1',
        [f.worldId],
      );
      a = await store.saveResponse(f.owner, a, { alreadyPaid: true });
      assert.equal(a.status, 'stale_discarded');
      assert.deepEqual(await raw(f.owner, a), { alreadyPaid: true });
      await assert.rejects(
        () => app.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, a)),
        /ENGINE_EPOCH_CONFLICT/,
      );
    },
  );
  await t.test(
    'expired leases retain received raw results without renewing an execution token',
    async () => {
      const f = await fixture();
      let a = (await claim(f, { leaseUntil: new Date(Date.now() + 400).toISOString() })).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      await admin.query('SELECT pg_sleep(0.45)');
      a = await store.saveResponse(f.owner, a, 'late actual response');
      assert.equal(a.status, 'stale_discarded');
      assert.equal(await raw(f.owner, a), 'late actual response');
      await assert.rejects(
        () => app.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, a)),
        /ATTEMPT_STALE/,
      );
    },
  );
  await t.test(
    'commit frame keeps the locked baseline and finish checks lease expiry after admission',
    async () => {
      const f = await fixture();
      let a = (await claim(f, { leaseUntil: new Date(Date.now() + 800).toISOString() })).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      a = await store.saveResponse(f.owner, a, { text: 'ready' });
      const eventId = randomUUID();
      await assert.rejects(
        () =>
          app.transaction(f.owner, async (sql) => {
            const frame = await beginAgentCommitFrameInTransaction(sql, f.owner, a);
            assert.equal(frame.receipt.id, a.inputReceiptId);
            assert.equal(frame.world.version, 0);
            assert.equal(frame.state.revision, 0);
            const working = structuredClone(frame.world);
            working.time = '2030-01-01T00:00:00.000Z';
            assert.equal(frame.world.time, at);
            await writeWorld(sql, f, a, eventId);
            await sql.query('SELECT pg_sleep($1)', [
              Math.max(0, (Date.parse(a.leaseUntil) - Date.now()) / 1000) + 0.05,
            ]);
            await finishAgentCommitInTransaction(sql, f.owner, {
              attempt: a,
              eventId,
              state: { ...f.state, revision: 1, projectedWorldVersion: 1 },
              results: [],
            });
          }),
        /ATTEMPT_STALE/,
      );
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        0,
      );
    },
  );
  await t.test(
    'a live player private turn fences automatic wake commits but not its own commit',
    async () => {
      const f = await fixture();
      const wake: AgentInputReceipt = {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        threadId: f.b,
        recipientActorId: f.b,
        origin: 'wake',
        text: '{"type":"npc_own_condition_ready","candidateId":"wake-1"}',
      };
      const acceptedWake = await store.accept(f.owner, wake);
      let wakeAttempt = (
        await store.claim(f.owner, {
          id: randomUUID(),
          worldId: f.worldId,
          actorId: f.b,
          commandId: wake.commandId,
          inputReceiptId: acceptedWake.receipt.id,
          engineEpoch: 2,
          expectedWorldVersion: 0,
          expectedActorRevision: 0,
          inputHash: wake.inputHash,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        })
      ).attempt;
      wakeAttempt = await store.mark(f.owner, wakeAttempt, 'request_sent');
      wakeAttempt = await store.saveResponse(f.owner, wakeAttempt, { statements: [] });
      let playerAttempt = (await claim(f)).attempt;
      playerAttempt = await store.mark(f.owner, playerAttempt, 'request_sent');
      playerAttempt = await store.saveResponse(f.owner, playerAttempt, { statements: [] });
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            beginAgentCommitFrameInTransaction(sql, f.owner, wakeAttempt),
          ),
        /SUPERSEDED_BY_USER_INTERRUPT/,
      );
      const frame = await app.transaction(f.owner, (sql) =>
        beginAgentCommitFrameInTransaction(sql, f.owner, playerAttempt),
      );
      assert.equal(frame.world.version, 0);
      assert.equal(frame.state.revision, 0);
    },
  );
  await t.test(
    'an explicit player send retires a slow automatic attempt for the same actor',
    async () => {
      const f = await fixture();
      const wake: AgentInputReceipt = {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        origin: 'wake',
        text: '{"type":"npc_own_condition_ready","candidateId":"wake-blocking"}',
      };
      const acceptedWake = await store.accept(f.owner, wake);
      const wakeAttempt = (
        await store.claim(f.owner, {
          id: randomUUID(),
          worldId: f.worldId,
          actorId: f.a,
          commandId: wake.commandId,
          inputReceiptId: acceptedWake.receipt.id,
          engineEpoch: 2,
          expectedWorldVersion: 0,
          expectedActorRevision: 0,
          inputHash: wake.inputHash,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        })
      ).attempt;
      await store.mark(f.owner, wakeAttempt, 'request_sent');
      const retired = await app.transaction(f.owner, (sql) =>
        supersedeAutomaticActorAttemptsInTransaction(sql, f.owner, f.worldId, f.a),
      );
      assert.equal(retired, 1);
      assert.equal(
        (await store.lookup(f.owner, f.worldId, wake.commandId))?.status,
        'stale_discarded',
      );
      const player = (await claim(f)).attempt;
      assert.equal(player.actorId, f.a);
      assert.equal(player.status, 'reserved');
    },
  );
  await t.test(
    'known malformed or oversize responses are stored as invalid, not unknown',
    async () => {
      const f = await fixture();
      let a = (await claim(f)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      a = await store.saveResponse(f.owner, a, 'x'.repeat(1000001));
      assert.equal(a.status, 'invalid_output');
      assert.equal(((await raw(f.owner, a)) as any).storageError, 'INVALID_OR_OVERSIZE_RESPONSE');
      assert.equal(
        (await store.claim(f.owner, { ...a, token: randomUUID() })).attempt.status,
        'invalid_output',
      );
    },
  );
  await t.test(
    'epoch1 old writers work; epoch2 fences any final world write without scoped setting',
    async () => {
      const f = await fixture(false);
      await app.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
          f.worldId,
          'legacy allowed',
        ]),
      );
      await app.transaction(f.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        }),
      );
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              f.worldId,
              'old writer',
            ]),
          ),
        /ENGINE_EPOCH_CONFLICT/,
      );
      await assert.rejects(
        () =>
          app.transaction(f.owner, async (sql) => {
            await sql.query(
              "SELECT set_config('app.agent_engine_epoch','2',true),set_config('app.agent_world_id','wrong',true)",
            );
            await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
              f.worldId,
              'wrong scope',
            ]);
          }),
        /ENGINE_EPOCH_CONFLICT/,
      );
    },
  );
  await t.test(
    'migration blocks unknown attempts and mismatching expected versions without resetting state',
    async () => {
      const f = await fixture();
      let a = (await claim(f)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      await store.mark(f.owner, a, 'unknown_after_send');
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            switchAgentEngineEpochInTransaction(sql, f.owner, {
              worldId: f.worldId,
              expectedEpoch: 2,
              nextEpoch: 3,
              expectedWorldVersion: 0,
            }),
          ),
        /ATTEMPT_PENDING/,
      );
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            switchAgentEngineEpochInTransaction(sql, f.owner, {
              worldId: f.worldId,
              expectedEpoch: 2,
              nextEpoch: 3,
              expectedWorldVersion: 1,
            }),
          ),
        /VERSION_CONFLICT/,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1',
            [f.worldId],
          )
        ).rows[0].engine_epoch,
        2,
      );
    },
  );
  await t.test(
    'worker cannot access state, inbox or raw attempts without a scoped lease adapter',
    async () => {
      const f = await fixture();
      await response(f);
      for (const table of [
        'actor_agent_states',
        'agent_input_receipts',
        'agent_attempts',
        'agent_action_results',
        'agent_runtime_worlds',
      ])
        await assert.rejects(
          () =>
            worker.transaction(f.owner, (sql) =>
              sql.query(`SELECT * FROM parallel_life.${table} WHERE world_id=$1`, [f.worldId]),
            ),
          /permission denied/,
        );
    },
  );
  await t.test(
    'atomic helper commits state, result, world event, receipt and outbox together',
    async () => {
      const f = await fixture(),
        a = await response(f),
        eventId = randomUUID();
      const next: ActorAgentState = {
        ...f.state,
        revision: 1,
        projectedWorldVersion: 1,
        actions: [
          {
            id: 'action',
            goalId: 'goal',
            capability: 'inspect',
            targetIds: [],
            parameters: {},
            preconditions: [],
            dependsOnActionIds: [],
            handlesResponsibilityIds: [],
            sourceIds: [],
            status: 'succeeded',
            resultId: 'result',
          },
        ],
      };
      await app.transaction(f.owner, async (sql) => {
        await beginAgentCommitInTransaction(sql, f.owner, a);
        await writeWorld(sql, f, a, eventId);
        await finishAgentCommitInTransaction(sql, f.owner, {
          attempt: a,
          eventId,
          state: next,
          results: [
            {
              id: 'result',
              worldId: f.worldId,
              actorId: f.a,
              actionId: 'action',
              eventId,
              worldVersion: 1,
              at,
              outcome: 'succeeded',
              handledResponsibilityIds: [],
              evidenceSourceIds: [],
            },
          ],
        });
      });
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.revision, 1);
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.b }))?.revision, 0);
      assert.equal(
        (await store.claim(f.owner, { ...a, token: randomUUID() })).attempt.status,
        'committed',
      );
      for (const table of ['world_events', 'commands', 'outbox_jobs', 'agent_action_results'])
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
              [f.worldId],
            )
          ).rows[0].n,
          1,
        );
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            finishAgentCommitInTransaction(sql, f.owner, {
              attempt: a,
              eventId,
              state: next,
              results: [],
            }),
          ),
        /ATOMIC_COMMIT_REQUIRED/,
      );
    },
  );
  await t.test(
    'failure after all writes rolls back world, actor CAS, receipt, result and outbox',
    async () => {
      const f = await fixture(),
        a = await response(f),
        eventId = randomUUID();
      await assert.rejects(
        () =>
          app.transaction(f.owner, async (sql) => {
            await beginAgentCommitInTransaction(sql, f.owner, a);
            await writeWorld(sql, f, a, eventId);
            await finishAgentCommitInTransaction(sql, f.owner, {
              attempt: a,
              eventId,
              state: {
                ...f.state,
                revision: 1,
                projectedWorldVersion: 1,
                actions: [
                  {
                    id: 'action',
                    goalId: 'goal',
                    capability: 'inspect',
                    targetIds: [],
                    parameters: {},
                    preconditions: [],
                    dependsOnActionIds: [],
                    handlesResponsibilityIds: [],
                    sourceIds: [],
                    status: 'succeeded',
                    resultId: 'result',
                  },
                ],
              },
              results: [
                {
                  id: 'result',
                  worldId: f.worldId,
                  actorId: f.a,
                  actionId: 'action',
                  eventId,
                  worldVersion: 1,
                  at,
                  outcome: 'succeeded',
                  handledResponsibilityIds: [],
                  evidenceSourceIds: [],
                },
              ],
            });
            throw Error('INJECTED_FAILURE');
          }),
        /INJECTED_FAILURE/,
      );
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.revision, 0);
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        0,
      );
      assert.equal((await store.claim(f.owner, { ...a })).attempt.status, 'response_received');
      for (const table of ['world_events', 'commands', 'outbox_jobs', 'agent_action_results'])
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
              [f.worldId],
            )
          ).rows[0].n,
          0,
        );
    },
  );
  await t.test('actor CAS and receipt scope reject stale or mismatched claims', async () => {
    const f = await fixture();
    await admin.query(
      "UPDATE parallel_life.actor_agent_states SET revision=1,document=jsonb_set(document,'{revision}','1'::jsonb) WHERE world_id=$1 AND actor_id=$2",
      [f.worldId, f.a],
    );
    await assert.rejects(() => claim(f), /AGENT_REVISION_CONFLICT/);
    await assert.rejects(() => claim(f, { actorId: f.b }), /INVALID_INPUT/);
    await assert.rejects(
      () => claim(f, { actorId: f.a, expectedActorRevision: 1, inputReceiptId: randomUUID() }),
      /INVALID_INPUT/,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].n,
      0,
    );
  });
  await t.test(
    'old reader begun before cutover cannot write after the engine epoch switch',
    async () => {
      const f = await fixture(false);
      let allowWrite!: () => void, hasRead!: () => void;
      const ready = new Promise<void>((r) => {
          hasRead = r;
        }),
        gate = new Promise<void>((r) => {
          allowWrite = r;
        });
      const oldWriter = app.transaction(f.owner, async (sql) => {
        await sql.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]);
        hasRead();
        await gate;
        await sql.query('UPDATE parallel_life.worlds SET title=$2 WHERE id=$1', [
          f.worldId,
          'stale legacy write',
        ]);
      });
      await ready;
      await app.transaction(f.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 0,
        }),
      );
      allowWrite();
      await assert.rejects(() => oldWriter, /ENGINE_EPOCH_CONFLICT/);
      assert.equal(
        (await admin.query('SELECT title FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].title,
        'Runtime fixture',
      );
    },
  );
  await t.test(
    'a foreign app owner cannot directly read protected state or raw response rows',
    async () => {
      const f = await fixture();
      await response(f);
      for (const table of [
        'actor_agent_states',
        'agent_input_receipts',
        'agent_attempts',
        'agent_action_results',
        'agent_runtime_worlds',
      ])
        assert.equal(
          (
            await app.transaction(f.foreign, (sql) =>
              sql.query(`SELECT * FROM parallel_life.${table} WHERE world_id=$1`, [f.worldId]),
            )
          ).rowCount,
          0,
        );
    },
  );
  await t.test('engine cutover refuses an incomplete actual-actor projection', async () => {
    const f = await fixture(false);
    await admin.query(
      'DELETE FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.worldId, f.b],
    );
    await assert.rejects(
      () =>
        app.transaction(f.owner, (sql) =>
          switchAgentEngineEpochInTransaction(sql, f.owner, {
            worldId: f.worldId,
            expectedEpoch: 1,
            nextEpoch: 2,
            expectedWorldVersion: 0,
          }),
        ),
      /AGENT_PROJECTION_INCOMPLETE/,
    );
    assert.equal(
      (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
        .rows[0].version,
      0,
    );
  });
  await t.test(
    'persisted JSON null is a found response and cannot masquerade as missing transport output',
    async () => {
      const f = await fixture();
      let a = (await claim(f)).attempt;
      assert.deepEqual(await store.readResponse(f.owner, a), { found: false });
      a = await store.mark(f.owner, a, 'request_sent');
      a = await store.saveResponse(f.owner, a, null);
      assert.equal(a.status, 'response_received');
      assert.deepEqual(await store.readResponse(f.owner, a), { found: true, response: null });
      a = await store.mark(f.owner, a, 'invalid_output');
      assert.equal((await store.claim(f.owner, { ...a })).attempt.status, 'invalid_output');
    },
  );
  await t.test('a real state-only agent event commits without fabricating a message', async () => {
    const f = await fixture(),
      a = await response(f),
      eventId = randomUUID();
    await app.transaction(f.owner, async (sql) => {
      await beginAgentCommitInTransaction(sql, f.owner, a);
      await writeWorld(sql, f, a, eventId, 'agent.state_committed');
      await finishAgentCommitInTransaction(sql, f.owner, {
        attempt: a,
        eventId,
        state: { ...f.state, revision: 1, projectedWorldVersion: 1 },
        results: [],
      });
    });
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
          [f.worldId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT payload->>'type' AS type FROM parallel_life.world_events WHERE world_id=$1",
          [f.worldId],
        )
      ).rows[0].type,
      'agent.state_committed',
    );
    assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.revision, 1);
  });
  await t.test('an event for another actor cannot settle this attempt or its state', async () => {
    const f = await fixture(),
      a = await response(f),
      eventId = randomUUID();
    await assert.rejects(
      () =>
        app.transaction(f.owner, async (sql) => {
          await beginAgentCommitInTransaction(sql, f.owner, a);
          await writeWorld(sql, f, a, eventId, 'turn.resolved', f.b);
          await finishAgentCommitInTransaction(sql, f.owner, {
            attempt: a,
            eventId,
            state: { ...f.state, revision: 1, projectedWorldVersion: 1 },
            results: [],
          });
        }),
      /INVALID_COMMIT_SOURCE/,
    );
    assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.revision, 0);
    assert.equal(
      (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
        .rows[0].version,
      0,
    );
  });
  await t.test(
    'database identity checks reject explicit JSON null instead of accepting SQL UNKNOWN',
    async () => {
      const f = await fixture();
      await assert.rejects(
        () =>
          app.transaction(f.owner, (sql) =>
            sql.query(
              "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{actorId}','null'::jsonb) WHERE world_id=$1 AND actor_id=$2",
              [f.worldId, f.a],
            ),
          ),
        /check constraint/,
      );
      assert.equal((await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))?.actorId, f.a);
    },
  );
  async function seedChannelEvent(
    f: Awaited<ReturnType<typeof fixture>>,
    version: number,
    type: string,
    data: unknown,
  ) {
    const commandId = randomUUID(),
      eventId = randomUUID(),
      next = { ...f.world, version };
    await app.transaction(f.owner, async (sql) => {
      await sql.query(
        "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch','2',true)",
        [f.worldId],
      );
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,'{}','running')",
        [commandId, f.worldId, f.owner, version - 1, hash(commandId)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [eventId, f.worldId, f.owner, version, commandId, { type, storyAt: at, data }, at],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
        [f.worldId, commandId, eventId, next],
      );
      await sql.query('UPDATE parallel_life.worlds SET version=$2,state=$3 WHERE id=$1', [
        f.worldId,
        version,
        next,
      ]);
    });
    return eventId;
  }
  async function groupFixture(includeB = true) {
    const f = await fixture(false),
      groupId = randomUUID(),
      eventId = await seedChannelEvent(f, 1, 'group.created', {
        groupId,
        title: 'Actual group',
        actorIds: includeB ? [f.a, f.b] : [f.a],
      });
    await app.transaction(f.owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.world_groups(id,world_id,owner_id,title,source_event_id,source_version) VALUES($1,$2,$3,$4,$5,1)',
        [groupId, f.worldId, f.owner, 'Actual group', eventId],
      );
      for (const member of includeB ? ['player', f.a, f.b] : ['player', f.a])
        await sql.query(
          'INSERT INTO parallel_life.world_group_memberships(world_id,owner_id,group_id,member_key,participant,joined_version,source_event_id) VALUES($1,$2,$3,$4,$5,1,$6)',
          [
            f.worldId,
            f.owner,
            groupId,
            member,
            member === 'player' ? { kind: 'player' } : { kind: 'actor', actorId: member },
            eventId,
          ],
        );
      await switchAgentEngineEpochInTransaction(sql, f.owner, {
        worldId: f.worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
    });
    const receipt = {
      ...f.receipt,
      channel: 'group' as const,
      threadId: groupId,
      recipientActorId: null,
      expectedWorldVersion: 1,
    };
    await store.accept(f.owner, receipt);
    return { ...f, groupId, receipt };
  }
  function channelClaim(f: Awaited<ReturnType<typeof fixture>>, actorId: string, version: number) {
    return store.claim(f.owner, {
      id: randomUUID(),
      commandId: randomUUID(),
      worldId: f.worldId,
      actorId,
      inputReceiptId: f.receipt.id,
      inputHash: f.receipt.inputHash,
      expectedWorldVersion: version,
      expectedActorRevision: 0,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 60000).toISOString(),
    });
  }
  await t.test(
    'one actual group input can drive separate actor attempts at successive world versions',
    async () => {
      const f = await groupFixture();
      let a = (await channelClaim(f, f.a, 1)).attempt;
      a = await store.mark(f.owner, a, 'request_sent');
      a = await store.saveResponse(f.owner, a, { actual: 'A response' });
      const eventId = randomUUID();
      await app.transaction(f.owner, async (sql) => {
        await beginAgentCommitInTransaction(sql, f.owner, a);
        await writeWorld(sql, f, a, eventId, 'agent.state_committed');
        await finishAgentCommitInTransaction(sql, f.owner, {
          attempt: a,
          eventId,
          state: { ...f.state, revision: 1, projectedWorldVersion: 2 },
          results: [],
        });
      });
      const b = (await channelClaim(f, f.b, 2)).attempt;
      assert.equal(b.inputReceiptId, a.inputReceiptId);
      assert.notEqual(b.commandId, a.commandId);
      assert.equal((await store.lookup(f.owner, f.worldId, a.commandId))?.status, 'committed');
      assert.equal((await store.lookup(f.owner, f.worldId, b.commandId))?.status, 'reserved');
      assert.equal(await store.lookup(f.owner, f.worldId, randomUUID()), null);
      await assert.rejects(() => store.lookup(f.foreign, f.worldId, a.commandId), /NOT_FOUND/);
      const saved = (
        await admin.query('SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1', [
          f.receipt.id,
        ])
      ).rows[0].document;
      assert.equal(saved.expectedWorldVersion, 1);
      assert.equal(saved.storyAt, at);
      assert.equal(saved.text, f.receipt.text);
    },
  );
  await t.test(
    'a member who saw the input may remember it after leaving and legitimately rejoining',
    async () => {
      const f = await groupFixture();
      // Remove and rejoin B using real membership sources; the interval at acceptance no longer extends through execution.
      const participant = { kind: 'actor', actorId: f.b };
      const left = await seedChannelEvent(f, 2, 'group.membership_changed', {
        groupId: f.groupId,
        action: 'leave',
        participant,
      });
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.world_group_memberships SET left_version=2,left_event_id=$3 WHERE group_id=$1 AND member_key=$2',
          [f.groupId, f.b, left],
        ),
      );
      const joined = await seedChannelEvent(f, 3, 'group.membership_changed', {
        groupId: f.groupId,
        action: 'join',
        participant,
      });
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.world_group_memberships(world_id,owner_id,group_id,member_key,participant,joined_version,source_event_id) VALUES($1,$2,$3,$4,$5,3,$6)',
          [f.worldId, f.owner, f.groupId, f.b, participant, joined],
        ),
      );
      assert.equal((await channelClaim(f, f.b, 3)).attempt.status, 'reserved');
      assert.equal((await channelClaim(f, f.a, 3)).attempt.status, 'reserved');
    },
  );
  await t.test(
    'fake group scope, a private null recipient, and altered receipt origins fail closed',
    async () => {
      const f = await fixture();
      await store.accept(f.owner, f.receipt);
      await assert.rejects(
        () => store.accept(f.owner, { ...f.receipt, origin: 'coordination' }),
        /COMMAND_CONFLICT/,
      );
      const fake = {
        ...f.receipt,
        id: randomUUID(),
        commandId: randomUUID(),
        channel: 'group' as const,
        threadId: randomUUID(),
        recipientActorId: null,
      };
      await store.accept(f.owner, fake);
      await assert.rejects(
        () => channelClaim({ ...f, receipt: fake }, f.a, 0),
        /INPUT_SCOPE_FORBIDDEN/,
      );
      const notPrivate = {
        ...fake,
        id: randomUUID(),
        commandId: randomUUID(),
        channel: 'private' as const,
        threadId: f.a,
      };
      await store.accept(f.owner, notPrivate);
      await assert.rejects(
        () => channelClaim({ ...f, receipt: notPrivate }, f.b, 0),
        /INPUT_SCOPE_FORBIDDEN/,
      );
      await assert.rejects(() => channelClaim(f, f.b, 0), /INVALID_INPUT/);
      const replay = await store.accept(f.owner, {
        ...f.receipt,
        receivedAt: '2026-10-16T07:00:00.000Z',
        storyAt: '2026-10-17T07:00:00.000Z',
      });
      assert.equal(replay.receipt.storyAt, at);
      assert.equal(replay.receipt.receivedAt, at);
      await assert.rejects(
        () =>
          store.accept(f.owner, {
            ...f.receipt,
            id: randomUUID(),
            commandId: randomUUID(),
            storyAt: '2026-02-31T07:00:00.000Z',
          }),
        /INVALID_INPUT/,
      );
    },
  );
  await t.test(
    'forgotten input or membership provenance cannot be resurrected by a new claim',
    async () => {
      const f = await groupFixture();
      await admin.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Forgotten input','forgotten_runtime_input','agent_inference',$5,'forgotten')",
        [randomUUID(), f.owner, f.a, f.worldId, JSON.stringify([f.receipt.id])],
      );
      await assert.rejects(() => channelClaim(f, f.a, 1), /INPUT_SCOPE_FORBIDDEN/);
      assert.equal((await channelClaim(f, f.b, 1)).attempt.status, 'reserved');
    },
  );
  await t.test(
    'scene claims require actual accepted-time presence and the current active player scene',
    async () => {
      const f = await fixture(false),
        sceneId = randomUUID();
      const entered = await seedChannelEvent(f, 1, 'scene.entered', { sceneId });
      const player = {
        participant: { kind: 'player' },
        joinedVersion: 1,
        sourceVersion: 1,
        sourceEventId: entered,
      };
      const openingCommand = randomUUID(),
        openingEvent = randomUUID();
      const aPresence = {
        participant: { kind: 'actor', actorId: f.a },
        joinedVersion: 2,
        sourceVersion: 2,
        sourceEventId: openingEvent,
      };
      const document = {
        id: sceneId,
        worldId: f.worldId,
        ownerId: f.owner,
        sourceEventId: entered,
        sourceVersion: 1,
        title: 'Actual scene',
        status: 'active',
        presence: [player, aPresence],
      };
      await app.transaction(f.owner, async (sql) => {
        const next = { ...f.world, version: 2 };
        await sql.query(
          "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,1,$4,'{}','running')",
          [openingCommand, f.worldId, f.owner, hash(openingCommand)],
        );
        await sql.query(
          'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,2,$4,$5,$6)',
          [
            openingEvent,
            f.worldId,
            f.owner,
            openingCommand,
            {
              type: 'scene.opened',
              storyAt: at,
              data: { sceneId, worldResults: { scene: document } },
            },
            at,
          ],
        );
        await sql.query(
          "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
          [f.worldId, openingCommand, openingEvent, next],
        );
        await sql.query('UPDATE parallel_life.worlds SET version=2,state=$2 WHERE id=$1', [
          f.worldId,
          next,
        ]);
        await sql.query(
          'INSERT INTO parallel_life.scene_sessions(id,world_id,owner_id,source_event_id,document) VALUES($1,$2,$3,$4,$5)',
          [sceneId, f.worldId, f.owner, entered, document],
        );
        await sql.query(
          'INSERT INTO parallel_life.player_experiences(world_id,owner_id,current_scene_id,document) VALUES($1,$2,$3,$4)',
          [f.worldId, f.owner, sceneId, {}],
        );
        await switchAgentEngineEpochInTransaction(sql, f.owner, {
          worldId: f.worldId,
          expectedEpoch: 1,
          nextEpoch: 2,
          expectedWorldVersion: 2,
        });
      });
      const receipt = {
        ...f.receipt,
        channel: 'scene' as const,
        threadId: sceneId,
        recipientActorId: null,
        expectedWorldVersion: 2,
      };
      await store.accept(f.owner, receipt);
      const current = { ...f, receipt };
      await assert.rejects(() => channelClaim(current, f.b, 2), /INPUT_SCOPE_FORBIDDEN/);
      await app.transaction(f.owner, (sql) =>
        sql.query(
          "UPDATE parallel_life.scene_sessions SET document=jsonb_set(document,'{presence}',document->'presence' || $2::jsonb) WHERE id=$1",
          [
            sceneId,
            JSON.stringify([{ ...aPresence, participant: { kind: 'actor', actorId: f.b } }]),
          ],
        ),
      );
      await assert.rejects(() => channelClaim(current, f.b, 2), /INPUT_SCOPE_FORBIDDEN/);
      await app.transaction(f.owner, (sql) =>
        sql.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
          sceneId,
          document,
        ]),
      );
      const a = (await channelClaim(current, f.a, 2)).attempt;
      assert.equal(a.status, 'reserved');
      await store.mark(f.owner, a, 'cancelled_before_send');
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.player_experiences SET current_scene_id=NULL WHERE world_id=$1',
          [f.worldId],
        ),
      );
      await assert.rejects(() => channelClaim(current, f.a, 2), /INPUT_SCOPE_FORBIDDEN/);
    },
  );
  await t.test(
    'a genuinely later group join cannot consume an earlier accepted input',
    async () => {
      const f = await groupFixture(false),
        participant = { kind: 'actor', actorId: f.b };
      const joined = await seedChannelEvent(f, 2, 'group.membership_changed', {
        groupId: f.groupId,
        action: 'join',
        participant,
      });
      await app.transaction(f.owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.world_group_memberships(world_id,owner_id,group_id,member_key,participant,joined_version,source_event_id) VALUES($1,$2,$3,$4,$5,2,$6)',
          [f.worldId, f.owner, f.groupId, f.b, participant, joined],
        ),
      );
      await assert.rejects(() => channelClaim(f, f.b, 2), /INPUT_SCOPE_FORBIDDEN/);
      assert.equal((await channelClaim(f, f.a, 2)).attempt.status, 'reserved');
    },
  );
  await t.test('authority revoked after claim blocks the actual paid send', async () => {
    const f = await groupFixture(),
      a = (await channelClaim(f, f.a, 1)).attempt;
    await admin.query(
      "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Revoked source','revoked_runtime_input','agent_inference',$5,'forgotten')",
      [randomUUID(), f.owner, f.a, f.worldId, JSON.stringify([f.receipt.id])],
    );
    await assert.rejects(() => store.mark(f.owner, a, 'request_sent'), /INPUT_SCOPE_FORBIDDEN/);
    assert.equal((await store.lookup(f.owner, f.worldId, a.commandId))?.status, 'reserved');
  });
  await t.test(
    'authority revoked after a received response prevents execution but preserves paid evidence',
    async () => {
      const f = await fixture(),
        a = await response(f);
      await admin.query(
        "INSERT INTO parallel_life.memory_records(id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status) VALUES($1,$2,'character',$3,$4,$3,'belief','Revoked source','revoked_received_input','agent_inference',$5,'forgotten')",
        [randomUUID(), f.owner, f.a, f.worldId, JSON.stringify([f.receipt.id])],
      );
      await assert.rejects(
        () => app.transaction(f.owner, (sql) => beginAgentCommitInTransaction(sql, f.owner, a)),
        /INPUT_SCOPE_FORBIDDEN/,
      );
      assert.deepEqual(await store.readResponse(f.owner, a), {
        found: true,
        response: { text: '我打算先列一份清单。' },
      });
      assert.equal(
        (await admin.query('SELECT version FROM parallel_life.worlds WHERE id=$1', [f.worldId]))
          .rows[0].version,
        0,
      );
    },
  );
});
