import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import {
  readAgendaInitializeGrantsInTransaction,
  agendaInitializeCommandId,
  agendaInitializeInputText,
} from '../../src/modules/world/infrastructure/actor-agenda-initialization-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import {
  evaluateOwnAgendaReview,
  ownAgendaReviewFamilyId,
  type OwnAgendaReviewGrant,
  type OwnAgendaReviewInput,
} from '../../src/modules/world/application/own-agenda-review-policy.ts';
import {
  readOwnAgendaReviewEvidenceInTransaction,
  OwnAgendaReviewEvidenceError,
} from '../../src/modules/world/infrastructure/own-agenda-review-repository.ts';

const ACTOR_A = '11111111-1111-4111-8111-111111111111',
  ACTOR_B = '22222222-2222-4222-8222-222222222222';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const quiet = () => ({
  protocol: 'npc-wire-v3',
  consideration: null,
  mediaDecision: { kind: 'not_requested' },
  executions: [],
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});

test('own-agenda authenticated read evidence: original runner/kernel plus adversarial ledger fixtures, no real models', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55588);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55588);
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db);
  const fixtures: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of fixtures) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic evidence fixture',
      time: '2026-10-19T00:00:00.000Z',
      actors: [
        { id: ACTOR_A, name: 'A', persona: 'Independent quiet planner' },
        { id: ACTOR_B, name: 'B', persona: 'Reserved shopkeeper', relationship: 'Acquaintance' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.write(owner, worldId, {
      storyNow: world.time,
      speed: 0,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const identity = {
      worldId,
      engineEpoch: 2,
      actorId: ACTOR_A,
      definitionRef: agentDefinitionRef(world, ACTOR_A),
    };
    fixtures.push({ owner, worldId });
    return { owner, worldId, world, identity };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function read(f: F) {
    return db.transaction(f.owner, async (sql) => {
      // The adapter must work in an actual read-only transaction, with exactly one SELECT.
      await sql.query('SET TRANSACTION READ ONLY');
      let queries = 0;
      const result = await readOwnAgendaReviewEvidenceInTransaction(
        new Proxy(sql, {
          get(target, property) {
            if (property !== 'query') return Reflect.get(target, property);
            return (...args: unknown[]) => {
              queries++;
              assert.equal(typeof args[0], 'string');
              assert.match(args[0] as string, /^SELECT /);
              assert.doesNotMatch(
                args[0] as string,
                /\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|set_config)\b/i,
              );
              return Reflect.apply(target.query, target, args);
            };
          },
        }),
        f.owner,
        f.identity,
      );
      assert.equal(queries, 1);
      return result;
    });
  }
  async function commitOriginalQuiet(f: F) {
    const grant = (
      await db.transaction(f.owner, (sql) =>
        readAgendaInitializeGrantsInTransaction(sql, f.owner, {
          worldId: f.worldId,
          engineEpoch: 2,
          worldVersion: 0,
        }),
      )
    ).find((g) => g.actorId === ACTOR_A)!;
    assert.ok(grant);
    const text = agendaInitializeInputText(grant),
      commandId = agendaInitializeCommandId(f.worldId, grant.candidateId);
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash: hash(text),
      channel: 'private',
      threadId: ACTOR_A,
      recipientActorId: ACTOR_A,
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: f.world.time,
      origin: 'wake',
      text,
    });
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A }))!;
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      f.world,
      ACTOR_A,
      receipt,
      f.world.time,
      state,
    );
    const attemptId = randomUUID();
    let calls = 0;
    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            calls++;
            return quiet();
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      f.owner,
      {
        id: attemptId,
        worldId: f.worldId,
        actorId: ACTOR_A,
        commandId,
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
    );
    assert.equal(calls, 1, 'one explicitly synthetic computation; no provider');
    return attemptId;
  }
  async function nativePrivateCommit(
    f: F,
    options: { player?: boolean; say?: boolean; goal?: boolean } = {},
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const commandId = randomUUID(),
      text = options.player ? '新的真实玩家输入' : 'synthetic own agenda check';
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash: hash(text),
      channel: 'private',
      threadId: ACTOR_A,
      recipientActorId: ACTOR_A,
      expectedWorldVersion: world.version,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
      origin: options.player ? 'player' : 'wake',
      text,
    });
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A }))!;
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      world,
      ACTOR_A,
      receipt,
      world.time,
      state,
    );
    const attemptId = randomUUID();
    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return {
              statements: options.say
                ? [{ text: '我会按自己的安排准备。', dependsOnActionIds: [] }]
                : [],
              goals: options.goal
                ? [
                    {
                      id: 'own-goal',
                      summary: '本人准备安排',
                      status: 'active',
                      sourceIds: [receipt.id],
                      resultIds: [],
                    },
                  ]
                : [],
              plans: options.goal
                ? [
                    {
                      id: 'own-plan',
                      goalId: 'own-goal',
                      summary: '等待真实所需能力',
                      sourceIds: [receipt.id],
                      status: 'blocked',
                      actionIds: [],
                      nextActionId: null,
                      triggers: [],
                      missingConditions: ['尚无执行能力'],
                    },
                  ]
                : [],
              actions: [],
              responsibilities: [],
              decisions: [],
            };
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      f.owner,
      {
        id: attemptId,
        worldId: f.worldId,
        actorId: ACTOR_A,
        commandId,
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
    );
    assert.equal(
      (
        await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE id=$1', [
          attemptId,
        ])
      ).rows[0].status,
      'committed',
    );
    return attemptId;
  }
  async function nativeGroupCommit(f: F) {
    const groups = new PostgresGroupRepository(db),
      tasks = new TaskRepository(db);
    const created = await groups.create(f.owner, {
      worldId: f.worldId,
      commandId: randomUUID(),
      expectedVersion: (await worlds.get({ userId: f.owner }, f.worldId)).version,
      title: 'Synthetic native group',
      actorIds: [ACTOR_A, ACTOR_B],
    });
    const parentCommand = randomUUID(),
      text = '群里有一条新的真实输入。';
    const accepted = await groups.send(f.owner, {
      worldId: f.worldId,
      groupId: created.groupId,
      commandId: parentCommand,
      expectedVersion: created.version,
      text,
    });
    await tasks.cancel(f.owner, accepted.task!.id);
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const receipt = (
      await admin.query(
        'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
        [f.worldId, f.owner, parentCommand],
      )
    ).rows[0].document;
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A }))!;
    const snapshot = await readNativeAgentSnapshot(
      db,
      f.owner,
      world,
      ACTOR_A,
      receipt,
      world.time,
      state,
    );
    const id = randomUUID();
    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return {
              statements: [{ text: '我看到了，按自己的安排来。', dependsOnActionIds: [] }],
              goals: [],
              plans: [],
              actions: [],
              responsibilities: [],
              decisions: [],
            };
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      f.owner,
      {
        id,
        worldId: f.worldId,
        actorId: ACTOR_A,
        commandId: randomUUID(),
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: world.version,
        expectedActorRevision: state.revision,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
    );
    assert.equal(
      (await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE id=$1', [id]))
        .rows[0].status,
      'committed',
    );
    return id;
  }
  function grantFor(
    e: Awaited<ReturnType<typeof read>>,
    policyVersion: string,
  ): OwnAgendaReviewGrant {
    assert.ok(e.anchor && e.familyId);
    return {
      type: 'npc_agenda_review',
      family: 'own_agenda',
      grantId: e.familyId,
      anchorAttemptId: e.anchor.attemptId,
      policyVersion,
      basisSourceIds: ['definition:' + e.anchor.definitionRef],
    };
  }
  // Deliberately local admin-created ledger fixtures test reader authentication; they do not
  // claim that review accept/send registration exists. The positive anchor always uses the real runner/kernel.
  async function ledger(
    f: F,
    envelope: unknown,
    opts: {
      status?: string;
      sent?: boolean;
      raw?: boolean;
      actor?: string;
      recipient?: string;
      origin?: string;
      epoch?: number;
      eventId?: string;
    } = {},
  ) {
    const id = randomUUID(),
      receiptId = randomUUID(),
      commandId = randomUUID(),
      text = typeof envelope === 'string' ? envelope : JSON.stringify(envelope),
      inputHash = hash(text);
    const document = {
      id: receiptId,
      worldId: f.worldId,
      commandId,
      inputHash,
      channel: 'private',
      threadId: opts.recipient ?? ACTOR_A,
      recipientActorId: opts.recipient ?? ACTOR_A,
      expectedWorldVersion: (await worlds.get({ userId: f.owner }, f.worldId)).version,
      receivedAt: new Date().toISOString(),
      storyAt: f.world.time,
      origin: opts.origin ?? 'wake',
      text,
    };
    await admin.query(
      'INSERT INTO parallel_life.agent_input_receipts(id,world_id,owner_id,command_id,input_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
      [receiptId, f.worldId, f.owner, commandId, inputHash, document],
    );
    try {
      await admin.query(
        `INSERT INTO parallel_life.agent_attempts(id,world_id,owner_id,actor_id,command_id,input_receipt_id,input_hash,engine_epoch,expected_world_version,expected_actor_revision,token,lease_until,status,sent_at,response,response_hash,event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,now()+interval '4 minutes',$11,$12,$13,$14,$15)`,
        [
          id,
          f.worldId,
          f.owner,
          opts.actor ?? ACTOR_A,
          commandId,
          receiptId,
          inputHash,
          opts.epoch ?? 2,
          document.expectedWorldVersion,
          randomUUID(),
          opts.status ?? 'cancelled_before_send',
          opts.sent ? new Date().toISOString() : null,
          opts.raw ? { synthetic: true } : null,
          opts.raw ? hash('synthetic') : null,
          opts.eventId ?? null,
        ],
      );
    } catch (e) {
      await admin.query('DELETE FROM parallel_life.agent_input_receipts WHERE id=$1', [receiptId]);
      throw e;
    }
    return { id, receiptId };
  }
  async function remove(row: Awaited<ReturnType<typeof ledger>>) {
    await admin.query('DELETE FROM parallel_life.agent_attempts WHERE id=$1', [row.id]);
    await admin.query('DELETE FROM parallel_life.agent_input_receipts WHERE id=$1', [
      row.receiptId,
    ]);
  }
  const invalid = (reason: OwnAgendaReviewEvidenceError['reason']) => (e: unknown) =>
    e instanceof OwnAgendaReviewEvidenceError && e.reason === reason;
  const f = await fixture();
  await t.test(
    'no committed anchor yields no grant; cross-owner, epoch, actor, definition fail closed',
    async () => {
      const e = await read(f);
      assert.equal(e.anchor, null);
      assert.equal(e.familyId, null);
      assert.deepEqual(e.attempts, []);
      const foreign = randomUUID();
      await new IdentityRepository(db).ensureGuest(foreign);
      await assert.rejects(
        db.transaction(foreign, (sql) =>
          readOwnAgendaReviewEvidenceInTransaction(sql, foreign, f.identity),
        ),
        /NOT_FOUND/,
      );
      for (const patch of [{ engineEpoch: 3 }, { actorId: 'missing' }, { definitionRef: 'forged' }])
        await assert.rejects(
          db.transaction(f.owner, (sql) =>
            readOwnAgendaReviewEvidenceInTransaction(sql, f.owner, { ...f.identity, ...patch }),
          ),
          invalid('scope'),
        );
    },
  );
  const attemptId = await commitOriginalQuiet(f);
  const initial = await read(f);
  await t.test(
    'actual runner quiet -> real event, succeeded command, projected state -> minimal anchor',
    async () => {
      assert.equal(initial.anchor?.attemptId, attemptId);
      const row = (
        await admin.query(
          'SELECT a.event_id,e.occurred_at,e.payload FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.id=a.event_id WHERE a.id=$1',
          [attemptId],
        )
      ).rows[0];
      assert.equal(row.payload.type, 'agent.state_committed');
      assert.equal(initial.anchor?.eventId, row.event_id);
      assert.equal(initial.anchor?.committedRealAt, row.occurred_at.toISOString());
      assert.equal(initial.anchor?.committedStoryAt, row.payload.storyAt);
      assert.equal(initial.familyId, ownAgendaReviewFamilyId(f.identity, initial.anchor!, hash));
      assert.deepEqual(initial.actorBlockers, []);
      assert.deepEqual(
        Object.keys(initial.anchor!).sort(),
        [
          'worldId',
          'engineEpoch',
          'actorId',
          'definitionRef',
          'attemptId',
          'eventId',
          'committedStoryAt',
          'committedRealAt',
        ].sort(),
      );
    },
  );
  await t.test(
    'all same-family policies and terminal transport attempts remain paid evidence',
    async () => {
      const rows = [];
      for (const opts of [
        { status: 'invalid_output', sent: true, raw: true },
        { status: 'stale_discarded', sent: true, raw: true },
        { status: 'cancelled_before_send', sent: false, raw: false },
      ])
        rows.push(await ledger(f, grantFor(initial, 'policy-' + rows.length), opts));
      const e = await read(f);
      assert.equal(e.attempts.length, 3);
      assert.deepEqual(
        new Set(e.attempts.map((a) => a.policyVersion)),
        new Set(['policy-0', 'policy-1', 'policy-2']),
      );
      assert.equal(e.attempts.filter((a) => a.hasRaw && a.sent).length, 2);
      assert.deepEqual(e.actorBlockers, []);
      const budget = { remaining: 10, nextWindowRealAt: null };
      const input: OwnAgendaReviewInput = {
        identity: f.identity,
        anchor: e.anchor,
        purpose: 'own_agenda',
        storyAt: '2026-10-20T00:00:00.000Z',
        realAt: new Date(Date.now() + 86400000).toISOString(),
        paused: false,
        hasPriorityWork: false,
        attempts: e.attempts,
        quietStreak: 0,
        budgets: { owner: budget, world: budget, actor: budget },
        policy: {
          version: 'brand-new-policy',
          storyGapMs: 1,
          realGapMs: 1,
          quietBackoffMultiplier: 1,
          maxRealGapMs: 1,
        },
      };
      assert.equal(evaluateOwnAgendaReview(input, hash).status, 'paid_fence');
      for (const row of rows) await remove(row);
    },
  );
  await t.test(
    'same-family reserved/request/raw/unknown and other-family active work remain distinct',
    async () => {
      for (const status of [
        'reserved',
        'request_sent',
        'response_received',
        'unknown_after_send',
      ]) {
        const row = await ledger(f, grantFor(initial, 'v1'), {
          status,
          sent: status !== 'reserved',
          raw: status === 'response_received',
        });
        const e = await read(f);
        assert.equal(e.attempts[0]!.status, status);
        assert.equal(e.actorBlockers[0]!.familyId, initial.familyId);
        await remove(row);
      }
      for (const opts of [
        { status: 'unknown_after_send', sent: true },
        { status: 'response_received', sent: true, raw: true },
        { status: 'reserved', epoch: 1 },
      ]) {
        const row = await ledger(f, 'ordinary non-review wake', opts);
        const e = await read(f);
        assert.deepEqual(e.attempts, []);
        assert.equal(e.actorBlockers[0]!.attemptId, row.id);
        assert.equal(e.actorBlockers[0]!.familyId, null);
        assert.equal(e.actorBlockers[0]!.engineEpoch, opts.epoch ?? 2);
        await remove(row);
      }
    },
  );
  await t.test(
    'strict envelope parsing rejects extra fields, fake anchors, forged family and definition, old-epoch laundering',
    async () => {
      const g = grantFor(initial, 'v1');
      for (const envelope of [
        { ...g, extra: true },
        { ...g, anchorAttemptId: 'nonexistent' },
        { ...g, grantId: 'forged' },
        { ...g, basisSourceIds: ['definition:' + '0'.repeat(64)] },
        { ...g, basisSourceIds: 'not-array' },
      ]) {
        const row = await ledger(f, envelope);
        await assert.rejects(read(f), invalid('envelope'));
        await remove(row);
      }
      const old = await ledger(f, g, { epoch: 1 });
      await assert.rejects(read(f), invalid('envelope'));
      await remove(old);
      const player = await ledger(f, g, { origin: 'player' });
      assert.deepEqual((await read(f)).attempts, []);
      await remove(player);
    },
  );
  await t.test('cross-actor receipt cannot authenticate actor A', async () => {
    const row = await ledger(f, grantFor(initial, 'v1'), { recipient: ACTOR_B });
    await assert.rejects(read(f), invalid('receipt'));
    await remove(row);
  });
  await t.test(
    'committed ledger cannot borrow another command event; missing real event rejected by FK',
    async () => {
      const row = await ledger(f, 'fake quiet', {
        status: 'committed',
        sent: true,
        raw: true,
        eventId: initial.anchor!.eventId,
      });
      await assert.rejects(read(f), invalid('committed_source'));
      await remove(row);
      await assert.rejects(
        ledger(f, 'no event', {
          status: 'committed',
          sent: true,
          raw: true,
          eventId: randomUUID(),
        }),
        (e: any) => e.code === '23503',
      );
      assert.deepEqual(await read(f), initial);
    },
  );
  await t.test(
    'actual player reply advances private anchor; state change without speech is not quiet; consecutive no-op commits back off',
    async () => {
      const x = await fixture();
      await commitOriginalQuiet(x);
      let e = await read(x);
      assert.equal(e.quietStreak, 1);
      assert.equal(e.lastPresentedRealAt, null);
      const playerAttempt = await nativePrivateCommit(x, { player: true, say: true });
      e = await read(x);
      assert.equal(e.anchor!.attemptId, playerAttempt);
      assert.equal(e.quietStreak, 0);
      assert.equal(e.lastPresentedRealAt, e.anchor!.committedRealAt);
      const presentation = e.lastPresentedRealAt;
      await nativePrivateCommit(x, { goal: true });
      e = await read(x);
      assert.equal(
        e.quietStreak,
        0,
        'a quiet-looking state event with a real goal/plan change is not quiet',
      );
      assert.equal(e.lastPresentedRealAt, presentation);
      await nativePrivateCommit(x);
      assert.equal((await read(x)).quietStreak, 1);
      await nativePrivateCommit(x);
      e = await read(x);
      assert.equal(e.quietStreak, 2);
      assert.equal(e.lastPresentedRealAt, presentation);
      const before = e.anchor!.attemptId;
      const invalidRow = await ledger(x, 'not a real new commit', {
        status: 'invalid_output',
        sent: true,
        raw: true,
      });
      assert.equal((await read(x)).anchor!.attemptId, before);
      await remove(invalidRow);
      const unknown = await ledger(x, 'unknown ordinary work', {
        status: 'unknown_after_send',
        sent: true,
      });
      const withUnknown = await read(x);
      assert.equal(withUnknown.anchor!.attemptId, before);
      assert.equal(withUnknown.actorBlockers[0]!.attemptId, unknown.id);
      await remove(unknown);
    },
  );
  await t.test(
    'legitimate original native group commit does not poison private review evidence or become a private anchor',
    async () => {
      const x = await fixture();
      await commitOriginalQuiet(x);
      const before = await read(x);
      const groupAttempt = await nativeGroupCommit(x);
      const after = await read(x);
      assert.equal(after.anchor!.attemptId, before.anchor!.attemptId);
      assert.equal(after.quietStreak, 0);
      const row = (
        await admin.query(
          'SELECT e.occurred_at FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.id=a.event_id WHERE a.id=$1',
          [groupAttempt],
        )
      ).rows[0];
      assert.equal(after.lastPresentedRealAt, row.occurred_at.toISOString());
    },
  );
  await t.test(
    'a projected or claimed message without original committed native UoW is not an anchor or presentation',
    async () => {
      const x = await fixture(),
        id = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          x.worldId,
          x.owner,
          ACTOR_A,
          {
            id,
            actorId: ACTOR_A,
            role: 'assistant',
            text: '我已经安排好了。',
            sourceEventId: randomUUID(),
            sourceVersion: 0,
            at: x.world.time,
          },
        ],
      );
      const e = await read(x);
      assert.equal(e.anchor, null);
      assert.equal(e.lastPresentedRealAt, null);
      assert.equal(e.quietStreak, 0);
    },
  );
  await t.test(
    'native speaking event without its actual authenticated message projection fails closed',
    async () => {
      const x = await fixture();
      await commitOriginalQuiet(x);
      await nativePrivateCommit(x, { player: true, say: true });
      const before = await read(x);
      const rows = (
        await admin.query(
          "DELETE FROM parallel_life.world_messages WHERE world_id=$1 AND document->>'sourceEventId'=$2 AND document->>'role'='assistant' RETURNING id,actor_id,document",
          [x.worldId, before.anchor!.eventId],
        )
      ).rows;
      assert.equal(rows.length, 1);
      await assert.rejects(read(x), invalid('committed_source'));
      for (const row of rows)
        await admin.query(
          'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
          [row.id, x.worldId, x.owner, row.actor_id, row.document],
        );
      assert.deepEqual(await read(x), before);
    },
  );
});
