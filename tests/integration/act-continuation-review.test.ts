import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
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
test('act continuation gets one existing review per authenticated personal basis', async (t) => {
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
  const v9 = (more: Record<string, unknown> = {}) => {
    const { focus: _focus, ...body } = v6(more);
    return { ...body, protocol: 'npc-wire-v9', focusChange: { kind: 'keep' } };
  };
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
          return JSON.stringify(v9({ agendaReview: null }));
        assert.equal(input.type, 'npc_agenda_review');
        if (phase === 'unknown' && actor === ACTOR_A) throw Error('SYNTHETIC_LOST_MODEL_RESULT');
        if (phase === 'quiet')
          return JSON.stringify({
            ...v9(),
            protocol: 'npc-wire-v9',
            agendaReview: {
              decision: 'quiet',
              reason: 'No new information to share.',
              basisSourceIds: [p.input.sourceId],
            },
          });
        return JSON.stringify(
          v9({
            protocol: 'npc-wire-v9',
            agendaReview: {
              decision: 'contact',
              reason: 'A concrete own arrangement is ready for discussion.',
              basisSourceIds: [p.input.sourceId],
            },
            statements: [
              {
                text: `${actor === ACTOR_A ? '陈列' : '预算'}方案有个需要商量的具体安排。`,
                dependsOnActionIds: [],
                requestsPlayerReply: true,
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
  const f = await fixture();
  await prime(f);
  const initial = await work(f);
  assert.ok(initial);
  const first = await prepare(f, initial);
  const basis = [first.snapshot.input.sourceId];
  await runNpcAgent(
    {
      attempts: store,
      kernel: new PostgresNpcAgentKernel(db, worlds),
      model: {
        async decide() {
          return {
            statements: [],
            goals: [
              {
                id: 'personal-goal',
                summary: 'Prepare my own arrangement',
                status: 'active',
                sourceIds: basis,
                resultIds: [],
              },
            ],
            plans: [
              {
                id: 'personal-plan',
                goalId: 'personal-goal',
                summary: 'Consider a concrete arrangement',
                status: 'blocked',
                sourceIds: basis,
                actionIds: [],
                nextActionId: null,
                triggers: [],
                missingConditions: ['Need to work out the details'],
              },
            ],
            actions: [],
            responsibilities: [],
            decisions: [],
            continuation: {
              decision: 'act',
              reason: 'I intend to work out my own arrangement.',
              sourceIds: basis,
              planIds: ['personal-plan'],
              questionIds: [],
              conditions: [],
            },
          };
        },
      },
    },
    f.owner,
    first.claim,
    first.snapshot,
  );
  const own = await work(f);
  assert.ok(own, 'explicit act is not permanently suppressed by its unchanged basis');
  const state = await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A });
  const digest = state!.continuation!.basisHash;
  const second = await prepare(f, own);
  await runNpcAgent(
    {
      attempts: store,
      kernel: new PostgresNpcAgentKernel(db, worlds),
      model: {
        async decide() {
          return {
            statements: [],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            continuation: {
              decision: 'act',
              reason: 'I still need to decide the concrete details.',
              sourceIds: [second.snapshot.input.sourceId],
              planIds: ['personal-plan'],
              questionIds: [],
              conditions: [],
            },
          };
        },
      },
    },
    f.owner,
    second.claim,
    second.snapshot,
  );
  assert.equal(
    (await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A }))!.continuation!.basisHash,
    digest,
  );
  assert.equal(
    await work(f),
    null,
    'new quiet anchor cannot rebuy the same personal semantic basis',
  );
});
