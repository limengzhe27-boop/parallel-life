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
  finishAgentCommitInTransaction,
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
    const next = { ...f.world, version: 1 };
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,$4,'{}','running')",
      [a.commandId, f.worldId, f.owner, a.inputHash],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
      [
        eventId,
        f.worldId,
        f.owner,
        a.commandId,
        { type: eventType, storyAt: at, data: { actorId: eventActor } },
        at,
      ],
    );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4 WHERE world_id=$1 AND id=$2",
      [f.worldId, a.commandId, eventId, next],
    );
    await sql.query('UPDATE parallel_life.worlds SET version=1,state=$2 WHERE id=$1', [
      f.worldId,
      next,
    ]);
    await sql.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), f.worldId, f.owner, eventId, { kind: 'agent_result' }],
    );
  }
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
});
