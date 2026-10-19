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
  assert.equal(cfg.port, 55634);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55634);
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
        { id: 'a', name: 'A', persona: 'Independent quiet planner' },
        { id: 'b', name: 'B', persona: 'Reserved shopkeeper', relationship: 'Acquaintance' },
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
      actorId: 'a',
      definitionRef: agentDefinitionRef(world, 'a'),
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
    ).find((g) => g.actorId === 'a')!;
    assert.ok(grant);
    const text = agendaInitializeInputText(grant),
      commandId = agendaInitializeCommandId(f.worldId, grant.candidateId);
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash: hash(text),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: f.world.time,
      origin: 'wake',
      text,
    });
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: 'a' }))!;
    const { snapshot } = await readPrivateAgentSnapshot(
      db,
      f.owner,
      f.world,
      'a',
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
        actorId: 'a',
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
      threadId: opts.recipient ?? 'a',
      recipientActorId: opts.recipient ?? 'a',
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
          opts.actor ?? 'a',
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
    const row = await ledger(f, grantFor(initial, 'v1'), { recipient: 'b' });
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
});
