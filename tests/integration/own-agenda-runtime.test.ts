import type { TextModel } from '../../src/modules/ai/application/ports.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  readOwnAgendaReviewWorkInTransaction,
  ownAgendaReviewInputText,
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
  type OwnAgendaRuntimeConfig,
  type OwnAgendaReviewWork,
} from '../../src/modules/world/infrastructure/own-agenda-review-authority.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
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
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const ACTOR_A = '11111111-1111-4111-8111-111111111111',
  ACTOR_B = '22222222-2222-4222-8222-222222222222';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('own-agenda original scheduling, v6 plans, paid fences and zero-send transport recovery', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55587);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55587);
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const fast: OwnAgendaRuntimeConfig = structuredClone(DEFAULT_OWN_AGENDA_RUNTIME_CONFIG);
  Object.assign(fast.policy, {
    storyGapMs: 1,
    realGapMs: 1,
    maxRealGapMs: 1,
    quietBackoffMultiplier: 1,
  });
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db, fast);
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
      speed: 12,
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
  const v6 = (more: Record<string, unknown> = {}) => ({
    protocol: 'npc-wire-v6',
    consideration: null,
    statements: [],
    executions: [],
    goals: [],
    planIntents: [],
    responsibilities: [],
    inputInterpretation: null,
    focus: null,
    questionWithdrawals: null,
    locationReports: null,
    ...more,
  });
  function harness(f: F, config: OwnAgendaRuntimeConfig = fast) {
    let phase: 'initial' | 'plans' | 'quiet' | 'unknown' = 'initial';
    const calls: { kind: string; input: any; actor: string }[] = [];
    const model: TextModel = {
      async complete(messages) {
        assert.equal(
          db.pool.totalCount,
          db.pool.idleCount,
          'no database transaction surrounds a model',
        );
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion.startsWith('director-')) {
          calls.push({ kind: 'director', input: p, actor: '' });
          return JSON.stringify({
            protocol: 'director-wire-v4',
            mode: 'quiet',
            candidates: p.wireCatalog.candidates.map((c: any) => ({
              ref: c.ref,
              decision: 'defer',
              reason: 'No new global arrangement needed.',
            })),
            events: p.wireCatalog.events.map((e: any) => ({
              eventRef: e.ref,
              decision: 'defer',
              reason: 'No new arrangement.',
            })),
            opportunities: [],
            audit: { reason: 'Synthetic global quiet, not an event result.', sourceRefs: [] },
          });
        }
        const input = JSON.parse(p.input.text),
          actor = p.state.actorId;
        calls.push({ kind: 'npc', input, actor });
        if (input.type === 'npc_agenda_initialize')
          return JSON.stringify({ ...v6(), protocol: 'npc-wire-v8', agendaReview: null });
        assert.equal(input.type, 'npc_agenda_review');
        if (phase === 'unknown' && actor === ACTOR_A) throw Error('SYNTHETIC_LOST_MODEL_RESULT');
        if (phase === 'quiet')
          return JSON.stringify({
            ...v6(),
            protocol: 'npc-wire-v8',
            agendaReview: {
              decision: 'quiet',
              reason: 'No new information to share.',
              basisSourceIds: [p.input.sourceId],
            },
          });
        return JSON.stringify(
          v6({
            protocol: 'npc-wire-v8',
            agendaReview: {
              decision: 'contact',
              reason: 'A concrete own arrangement is ready for discussion.',
              basisSourceIds: [p.input.sourceId],
            },
            statements: [
              {
                text: `${actor === ACTOR_A ? '陈列' : '预算'}方案有个需要商量的具体安排。`,
                dependsOnActionIds: [],
                requestsPlayerReply: false,
                questionForResponsibilityId: null,
              },
            ],
            planIntents: [
              {
                kind: 'create',
                ref: 'next',
                goal: {
                  kind: 'new',
                  summary: actor === ACTOR_A ? '考虑陈列方案' : '核对预算方案',
                  sourceIds: [p.sources.find((s: { kind: string }) => s.kind === 'authored').id],
                },
                summary: '等真实信息后继续本人安排',
                sourceIds: [p.sources.find((s: { kind: string }) => s.kind === 'authored').id],
                nextStep: { kind: 'blocked', missing: ['尚需具体的方案信息'] },
              },
            ],
          }),
        );
      },
    };
    const services = npcAgentAdvanceServices(
      db,
      () => model,
      new PostgresDirectorSnapshotRepository(db),
      { maxActors: 2, maxSteps: 6, maxModelCalls: 6 },
      config,
    );
    return {
      calls,
      model,
      advance: () => services.advanceIfEnabled(f.owner, f.worldId),
      setPhase: (p: typeof phase) => {
        phase = p;
      },
    };
  }
  async function work(f: F, actorId = ACTOR_A, config = fast) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const snapshot = (
      await readPrivateAgentSnapshot(
        db,
        f.owner,
        world,
        actorId,
        null,
        world.time,
        await store.read(f.owner, { worldId: f.worldId, actorId }),
      )
    ).snapshot;
    return db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewWorkInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId,
        worldVersion: world.version,
        config,
        snapshot,
      }),
    );
  }
  async function prepare(f: F, w: OwnAgendaReviewWork) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      clock = await clocks.read(f.owner, f.worldId);
    const storyAt = new Date(
      Math.max(
        Date.parse(world.time),
        Date.parse(projectStoryTime(clock, new Date().toISOString())),
      ),
    ).toISOString();
    const text = ownAgendaReviewInputText(w.grant),
      actorId = w.candidate.actorId;
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId: w.commandId,
      inputHash: hash(JSON.stringify([f.worldId, actorId, w.candidate.id, text])),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: world.version,
      receivedAt: new Date().toISOString(),
      storyAt,
      origin: 'wake',
      text,
    });
    const snapshot = (
      await readPrivateAgentSnapshot(
        db,
        f.owner,
        world,
        actorId,
        receipt,
        storyAt,
        await store.read(f.owner, { worldId: f.worldId, actorId }),
      )
    ).snapshot;
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId,
      commandId: w.commandId,
      inputReceiptId: receipt.id,
      inputHash: receipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: snapshot.state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    return { receipt, snapshot, claim };
  }
  async function attempts(f: F) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.worldId],
      )
    ).rows;
  }
  async function prime(f: F) {
    const h = harness(f);
    await h.advance();
    assert.equal(
      h.calls.filter((c) => c.kind === 'npc' && c.input.type === 'npc_agenda_initialize').length,
      2,
    );
    return h;
  }
  await t.test(
    'F quiet has a real successor: original advance reviews two independent NPCs and compiles their explicit v6 plans',
    async () => {
      const f = await fixture(),
        h = await prime(f);
      const slow = structuredClone(fast);
      slow.policy.realGapMs = 60_000;
      slow.policy.maxRealGapMs = 60_000;
      assert.equal(await work(f, ACTOR_A, slow), null, 'not time to consider, no paid call');
      const first = await work(f);
      assert.ok(first);
      assert.equal(first.candidate.source, 'agenda_review');
      h.setPhase('plans');
      const r = await h.advance();
      assert.equal(r?.played, 2);
      const reviews = h.calls.filter(
        (c) => c.kind === 'npc' && c.input.type === 'npc_agenda_review',
      );
      assert.deepEqual(new Set(reviews.map((c) => c.actor)), new Set([ACTOR_A, ACTOR_B]));
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 2);
      for (const id of [ACTOR_A, ACTOR_B]) {
        const s = await store.read(f.owner, { worldId: f.worldId, actorId: id });
        assert.equal(s!.goals.length, 1);
        assert.equal(s!.plans.length, 1);
        assert.equal(s!.plans[0]!.goalId, s!.goals[0]!.id);
        assert.match(s!.goals[0]!.id, /^plan-intent-goal:/);
        assert.equal(s!.goals[0]!.status, 'active');
        assert.equal(s!.plans[0]!.status, 'blocked');
      }
      assert.equal(
        await work(f, ACTOR_A, slow),
        null,
        'latest actual delivered message also controls contact spacing',
      );
      assert.equal(
        (await attempts(f)).filter((a) => a.sent_at && a.status === 'committed').length,
        4,
        'two initialization attempts and two reviews (Director has its own ledger)',
      );
    },
  );
  await t.test(
    'one unknown review fences that person, not another independent participant',
    async () => {
      const f = await fixture(),
        h = await prime(f);
      h.setPhase('unknown');
      const r = await h.advance();
      assert.equal(r?.played, 1);
      const rows = await attempts(f);
      assert.equal(
        rows.filter((a) => a.actor_id === ACTOR_A && a.status === 'unknown_after_send').length,
        1,
      );
      assert.ok(
        rows.some(
          (a) => a.actor_id === ACTOR_B && a.status === 'committed' && a.expected_world_version > 0,
        ),
      );
      assert.equal(await work(f, ACTOR_A), null, 'no renamed grant or retry around unknown');
    },
  );
  await t.test(
    'budget race cancels the exact unsent attempt atomically; a later CAS uses authenticated same-family transport lineage',
    async () => {
      const f = await fixture();
      await prime(f);
      const original = await work(f);
      assert.ok(original);
      const prepared = await prepare(f, original);
      let actualCalls = 0;
      // Local adversarial fixture: another request consumes the owner bucket after acceptance/claim.
      const guarded = new Proxy(store, {
        get(target, key) {
          if (key !== 'markRequestSentWithSources') {
            const v = Reflect.get(target, key);
            return typeof v === 'function' ? v.bind(target) : v;
          }
          return async (...args: Parameters<typeof store.markRequestSentWithSources>) => {
            await admin.query(
              `INSERT INTO parallel_life.rate_limits(owner_id,bucket,window_start,count) VALUES($1,'npc-own-agenda:owner:v1',to_timestamp(floor(extract(epoch FROM clock_timestamp())/3600)*3600),48) ON CONFLICT(owner_id,bucket) DO UPDATE SET count=48,window_start=EXCLUDED.window_start`,
              [f.owner],
            );
            return target.markRequestSentWithSources(...args);
          };
        },
      });
      await assert.rejects(
        () =>
          runNpcAgent(
            {
              attempts: guarded,
              model: new NpcAgentModel({
                async complete() {
                  actualCalls++;
                  return JSON.stringify(v6());
                },
              }),
              kernel: new PostgresNpcAgentKernel(db, worlds),
            },
            f.owner,
            prepared.claim,
            prepared.snapshot,
          ),
        (e: any) => e.code === 'OWN_AGENDA_BUDGET_WAIT',
      );
      assert.equal(actualCalls, 0);
      const cancelled = (await attempts(f)).find((a) => a.command_id === original.commandId)!;
      assert.equal(cancelled.status, 'cancelled_before_send');
      assert.equal(cancelled.sent_at, null);
      assert.equal(cancelled.response_hash, null);
      const counters = (
        await admin.query('SELECT bucket,count FROM parallel_life.rate_limits WHERE owner_id=$1', [
          f.owner,
        ])
      ).rows;
      assert.equal(counters.length, 1, 'no partial world/actor reservation escaped');
      await admin.query('DELETE FROM parallel_life.rate_limits WHERE owner_id=$1', [f.owner]);
      // Genuine original B command advances the world; A's old unpaid family is not renamed.
      const before = await worlds.get({ userId: f.owner }, f.worldId),
        commandId = randomUUID();
      const { receipt } = await store.accept(f.owner, {
        id: randomUUID(),
        worldId: f.worldId,
        commandId,
        inputHash: hash('real B change'),
        channel: 'private',
        threadId: ACTOR_B,
        recipientActorId: ACTOR_B,
        expectedWorldVersion: before.version,
        receivedAt: new Date().toISOString(),
        storyAt: before.time,
        origin: 'player',
        text: '我现在换一个话题。',
      });
      const bs = (
        await readPrivateAgentSnapshot(
          db,
          f.owner,
          before,
          ACTOR_B,
          receipt,
          before.time,
          await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_B }),
        )
      ).snapshot;
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return {
                statements: [{ text: '好的，我们换一个话题。', dependsOnActionIds: [] }],
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
          id: randomUUID(),
          worldId: f.worldId,
          actorId: ACTOR_B,
          commandId,
          inputReceiptId: receipt.id,
          inputHash: receipt.inputHash,
          engineEpoch: 2,
          expectedWorldVersion: before.version,
          expectedActorRevision: bs.state.revision,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 240000).toISOString(),
        },
        bs,
      );
      const recovered = await work(f);
      assert.ok(recovered);
      assert.equal(recovered.recovery, true);
      assert.equal(recovered.grant.grantId, original.grant.grantId);
      assert.notEqual(recovered.commandId, original.commandId);
      const next = await prepare(f, recovered);
      await runNpcAgent(
        {
          attempts: store,
          model: new NpcAgentModel({
            async complete() {
              actualCalls++;
              return JSON.stringify(
                v6({
                  statements: [
                    {
                      text: '我重新考虑了自己的安排。',
                      dependsOnActionIds: [],
                      requestsPlayerReply: false,
                      questionForResponsibilityId: null,
                    },
                  ],
                }),
              );
            },
          }),
          kernel: new PostgresNpcAgentKernel(db, worlds),
        },
        f.owner,
        next.claim,
        next.snapshot,
      );
      assert.equal(actualCalls, 1);
      const end = await attempts(f);
      assert.equal(
        end.find((a) => a.id === cancelled.id)!.expected_world_version,
        cancelled.expected_world_version,
      );
      assert.equal(end.find((a) => a.id === cancelled.id)!.status, 'cancelled_before_send');
      assert.equal(end.find((a) => a.command_id === recovered.commandId)!.status, 'committed');
      assert.equal(end.filter((a) => a.command_id === original.commandId && a.sent_at).length, 0);
    },
  );
  await t.test(
    'protected review response resumes with no second model call or budget charge',
    async () => {
      const f = await fixture();
      await prime(f);
      const ready = await work(f);
      assert.ok(ready);
      const p = await prepare(f, ready);
      let calls = 0;
      const realKernel = new PostgresNpcAgentKernel(db, worlds);
      const model = new NpcAgentModel({
        async complete() {
          calls++;
          return JSON.stringify(
            v6({
              statements: [
                {
                  text: '我有一个新的具体安排可以商量。',
                  dependsOnActionIds: [],
                  requestsPlayerReply: false,
                  questionForResponsibilityId: null,
                },
              ],
            }),
          );
        },
      });
      const deferredKernel = new Proxy(realKernel, {
        get(target, key) {
          if (key === 'commit')
            return async () => {
              throw Object.assign(Error('NPC_DELIVERY_DEFERRED'), {
                code: 'NPC_DELIVERY_DEFERRED',
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        () =>
          runNpcAgent(
            { attempts: store, model, kernel: deferredKernel },
            f.owner,
            p.claim,
            p.snapshot,
          ),
        (e: any) => e.code === 'NPC_DELIVERY_DEFERRED',
      );
      const saved = (await attempts(f)).find((a) => a.command_id === ready.commandId)!;
      assert.equal(saved.status, 'response_received');
      const before = (
        await admin.query(
          'SELECT bucket,count FROM parallel_life.rate_limits WHERE owner_id=$1 ORDER BY bucket',
          [f.owner],
        )
      ).rows;
      assert.deepEqual(
        before.map((r) => r.count),
        [1, 1, 1],
      );
      const current = await store.lookup(f.owner, f.worldId, ready.commandId);
      assert.ok(current);
      await runNpcAgent({ attempts: store, model, kernel: realKernel }, f.owner, current, null);
      const after = (
        await admin.query(
          'SELECT bucket,count FROM parallel_life.rate_limits WHERE owner_id=$1 ORDER BY bucket',
          [f.owner],
        )
      ).rows;
      assert.deepEqual(after, before);
      assert.equal(calls, 1);
      assert.equal(
        (await attempts(f)).find((a) => a.id === saved.id)!.response_hash,
        saved.response_hash,
      );
      assert.equal((await attempts(f)).find((a) => a.id === saved.id)!.status, 'committed');
    },
  );
  await t.test(
    'v8 short-source protected review response resumes with no second model call or budget charge',
    async () => {
      const f = await fixture();
      await prime(f);
      const ready = await work(f);
      assert.ok(ready);
      const p = await prepare(f, ready);
      let calls = 0;
      const realKernel = new PostgresNpcAgentKernel(db, worlds);
      const model = new NpcAgentModel({
        async complete(messages: ModelMessage[]) {
          calls++;
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          return JSON.stringify(
            v6({
              protocol: 'npc-wire-v8',
              agendaReview: {
                decision: 'contact',
                reason: 'Own concrete plan ready for discussion.',
                basisSourceIds: [p.input.sourceId],
              },
              planIntents: [
                {
                  kind: 'create',
                  ref: 'resume-plan',
                  goal: {
                    kind: 'new',
                    summary: '核对本人的陈列安排',
                    sourceIds: [p.sources.find((s: any) => s.kind === 'authored').id],
                  },
                  summary: '保留安排待核对',
                  sourceIds: [p.sources.find((s: any) => s.kind === 'authored').id],
                  nextStep: { kind: 'blocked', missing: ['等待方案信息'] },
                },
              ],
              statements: [
                {
                  text: '我有一个新的具体安排可以商量。',
                  dependsOnActionIds: [],
                  requestsPlayerReply: false,
                  questionForResponsibilityId: null,
                },
              ],
            }),
          );
        },
      });
      const deferredKernel = new Proxy(realKernel, {
        get(target, key) {
          if (key === 'commit')
            return async () => {
              throw Object.assign(Error('NPC_DELIVERY_DEFERRED'), {
                code: 'NPC_DELIVERY_DEFERRED',
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await assert.rejects(
        () =>
          runNpcAgent(
            { attempts: store, model, kernel: deferredKernel },
            f.owner,
            p.claim,
            p.snapshot,
          ),
        (e: any) => e.code === 'NPC_DELIVERY_DEFERRED',
      );
      const saved = (await attempts(f)).find((a) => a.command_id === ready.commandId)!;
      assert.equal(saved.status, 'response_received');
      const before = (
        await admin.query(
          'SELECT bucket,count FROM parallel_life.rate_limits WHERE owner_id=$1 ORDER BY bucket',
          [f.owner],
        )
      ).rows;
      assert.deepEqual(
        before.map((r) => r.count),
        [1, 1, 1],
      );
      const current = await store.lookup(f.owner, f.worldId, ready.commandId);
      assert.ok(current);
      await runNpcAgent({ attempts: store, model, kernel: realKernel }, f.owner, current, null);
      const after = (
        await admin.query(
          'SELECT bucket,count FROM parallel_life.rate_limits WHERE owner_id=$1 ORDER BY bucket',
          [f.owner],
        )
      ).rows;
      assert.deepEqual(after, before);
      assert.equal(calls, 1);
      assert.equal(
        (await attempts(f)).find((a) => a.id === saved.id)!.response_hash,
        saved.response_hash,
      );
      assert.equal((await attempts(f)).find((a) => a.id === saved.id)!.status, 'committed');
    },
  );
  await t.test(
    'a zero-send attempt resumes the original CAS and a forged family/transport never acquires authority',
    async () => {
      const f = await fixture();
      await prime(f);
      const ready = await work(f);
      assert.ok(ready);
      const p = await prepare(f, ready);
      const claim = await store.claim(f.owner, p.claim);
      await store.mark(f.owner, claim.attempt, 'cancelled_before_send');
      const resumed = await store.claim(f.owner, p.claim);
      assert.equal(resumed.replay, false);
      assert.equal(resumed.attempt.id, claim.attempt.id);
      assert.notEqual(resumed.attempt.token, claim.attempt.token);
      await store.mark(f.owner, resumed.attempt, 'cancelled_before_send');
      const forged = { ...p.receipt, id: randomUUID(), commandId: randomUUID() };
      await assert.rejects(() => store.accept(f.owner, forged), /OWN_AGENDA_REVIEW_FORBIDDEN/);
      const badGrant = { ...ready.grant, anchorAttemptId: randomUUID() },
        text = ownAgendaReviewInputText(badGrant);
      await assert.rejects(
        () =>
          store.accept(f.owner, {
            ...forged,
            inputHash: hash(JSON.stringify([f.worldId, ACTOR_A, badGrant.grantId, text])),
            text,
          }),
        /OWN_AGENDA_REVIEW_FORBIDDEN/,
      );
      assert.equal((await attempts(f)).filter((a) => a.command_id === ready.commandId).length, 1);
      assert.equal(
        (await admin.query('SELECT 1 FROM parallel_life.rate_limits WHERE owner_id=$1', [f.owner]))
          .rowCount,
        0,
      );
    },
  );
});
