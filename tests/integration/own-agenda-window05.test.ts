import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
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
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import {
  readOwnAgendaReviewWorkInTransaction,
  ownAgendaReviewInputText,
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
} from '../../src/modules/world/infrastructure/own-agenda-review-authority.ts';
import { readOwnAgendaReviewEvidenceInTransaction } from '../../src/modules/world/infrastructure/own-agenda-review-repository.ts';
import { ownAgendaReviewWindow } from '../../src/modules/world/application/own-agenda-review-policy.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { recordStreamSegmentError } from '../../src/modules/world/infrastructure/npc-stream-segment-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

test('complete quiet reviews advance only into a due authenticated successor window; unknown and partial retain their fence', async (t) => {
  const cfg = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db);
  const config = structuredClone(DEFAULT_OWN_AGENDA_RUNTIME_CONFIG);
  // Fast test clock only: same nonzero exponential policy and authority, production constants untouched.
  Object.assign(config.policy, { storyGapMs: 1, realGapMs: 250, maxRealGapMs: 2000 });
  const store = new PostgresAgentRuntimeRepository(db, config);
  const fixtures: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of fixtures) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture(waiting = false) {
    const owner = randomUUID(),
      worldId = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Isolated bounded agenda review fixture',
      time: '2026-10-19T00:00:00.000Z',
      actors: [
        {
          id: actorId,
          name: '独立测试人物',
          persona: '有本人生活安排，可安静等待，不重复请求玩家',
        },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId, actorId }, agentDefinitionRef(world, actorId), 0),
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
    const f = { owner, worldId, actorId, world, waiting, calls: 0 };
    fixtures.push(f);
    const grant = (
      await db.transaction(owner, (sql) =>
        readAgendaInitializeGrantsInTransaction(sql, owner, {
          worldId,
          engineEpoch: 2,
          worldVersion: 0,
        }),
      )
    )[0]!;
    assert.ok(grant);
    await perform(
      f,
      agendaInitializeInputText(grant),
      agendaInitializeCommandId(worldId, grant.candidateId),
      false,
    );
    return f;
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function perform(
    f: F,
    text: string,
    commandId: string,
    review: boolean,
    mode: 'quiet' | 'unknown' | 'invalid' | 'current' = 'quiet',
  ) {
    const world = await worlds.get({ userId: f.owner }, f.worldId),
      clock = await clocks.read(f.owner, f.worldId);
    const storyAt = projectStoryTime(clock, new Date().toISOString());
    const inputHash = review
      ? hash(JSON.stringify([f.worldId, f.actorId, JSON.parse(text).grantId, text]))
      : hash(JSON.stringify([f.worldId, f.actorId, JSON.parse(text).candidateId, text]));
    const { receipt } = await store.accept(f.owner, {
      id: randomUUID(),
      worldId: f.worldId,
      commandId,
      inputHash,
      channel: 'private',
      threadId: f.actorId,
      recipientActorId: f.actorId,
      expectedWorldVersion: world.version,
      receivedAt: new Date().toISOString(),
      storyAt,
      origin: 'wake',
      text,
    });
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId }))!;
    const snapshot = (
      await readPrivateAgentSnapshot(db, f.owner, world, f.actorId, receipt, storyAt, state)
    ).snapshot;
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.actorId,
      commandId,
      inputReceiptId: receipt.id,
      inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    const deps = {
      attempts: store,
      kernel: new PostgresNpcAgentKernel(db, worlds),
      model: new NpcAgentModel({
        async complete(messages) {
          f.calls++;
          if (mode === 'unknown') throw Error('SYNTHETIC_LOST_RESPONSE');
          if (mode === 'invalid') return '{invalid';
          if (mode === 'current')
            return JSON.stringify({
              protocol: 'npc-wire-v18',
              statements: [],
              executions: [],
              changes: null,
            });
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content),
            ref = p.wireCatalog.inputSourceRef;
          return JSON.stringify({
            protocol: 'npc-wire-v15',
            statements:
              f.waiting && !review
                ? [
                    {
                      text: '关于旧安排，等你方便再告诉我。',
                      dependsOnActionIds: [],
                      requestsPlayerReply: true,
                      questionForResponsibilityId: null,
                    },
                  ]
                : [],
            executions: [],
            changes: {
              ...(review
                ? {
                    agendaReview: {
                      decision: 'quiet',
                      reason: '本人暂时安静，不重复询问玩家',
                      basisSourceIds: [ref],
                    },
                  }
                : {}),
              continuation: {
                decision: f.waiting ? 'await_response' : 'no_current_intent',
                reason: '保留本人状态，不强迫玩家答复',
                sourceIds: [ref],
                planIds: [],
                questionIds:
                  review && f.waiting
                    ? (p.state.questions ?? [])
                        .filter((q: { status: string }) => q.status === 'open')
                        .map((q: { id: string }) => q.id)
                    : [],
                conditions: [],
              },
            },
          });
        },
      }),
    };
    return { result: await runNpcAgent(deps, f.owner, claim, snapshot), claim, snapshot, deps };
  }
  async function evidence(f: F) {
    return db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewEvidenceInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
        engineEpoch: 2,
        definitionRef: agentDefinitionRef(f.world, f.actorId),
      }),
    );
  }
  async function work(f: F, override = config) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return db.transaction(f.owner, (sql) =>
      readOwnAgendaReviewWorkInTransaction(sql, f.owner, {
        worldId: f.worldId,
        actorId: f.actorId,
        worldVersion: world.version,
        config: override,
        hasPriorityWork: false,
      }),
    );
  }
  async function due(f: F) {
    const e = await evidence(f);
    const window = ownAgendaReviewWindow(e.anchor!, config.policy, e.quietStreak);
    await sleep(Math.max(0, Date.parse(window.nextReviewRealAt) - Date.now() + 15));
  }
  for (const waiting of [false, true])
    await t.test(
      waiting
        ? 'await_response gets a bounded quiet review without another invitation'
        : 'no_current_intent is not a permanent personal scheduling ban',
      async () => {
        const f = await fixture(waiting);
        assert.equal(f.calls, 1);
        assert.equal(await work(f), null);
        await due(f);
        const first = await work(f);
        assert.ok(first);
        const done = await perform(f, ownAgendaReviewInputText(first.grant), first.commandId, true);
        assert.equal(f.calls, 2);
        assert.equal(
          await work(f),
          null,
          'same completed review does not immediately mint a new purchase',
        );
        await runNpcAgent(done.deps, f.owner, done.claim, done.snapshot);
        assert.equal(f.calls, 2, 'repeated same command reuses receipt');
        await due(f);
        const second = await work(f);
        assert.ok(second);
        assert.notEqual(second.grant.grantId, first.grant.grantId);
        assert.equal(second.grant.anchorAttemptId, done.claim.id);
        const one = structuredClone(config);
        one.budgets.actor.limit = 1;
        assert.equal(await work(f, one), null, 'budget still blocks an otherwise due successor');
        await perform(f, ownAgendaReviewInputText(second.grant), second.commandId, true);
        assert.equal(f.calls, 3);
        assert.equal(await work(f), null);
        const world = await worlds.get({ userId: f.owner }, f.worldId);
        assert.equal(world.messages.filter((m) => m.role === 'assistant').length, waiting ? 1 : 0);
        assert.equal(world.appointments.length, 0);
        const state = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId });
        assert.equal(state!.responsibilities.length, 0);
        assert.equal(state!.questions?.length ?? 0, waiting ? 1 : 0);
      },
    );
  await t.test(
    'current single-decision review commits without a duplicate report and retains one successor',
    async () => {
      const f = await fixture();
      await due(f);
      const first = await work(f);
      assert.ok(first);
      const saved = await perform(
        f,
        ownAgendaReviewInputText(first.grant),
        first.commandId,
        true,
        'current',
      );
      const after = await evidence(f);
      assert.equal(after.anchor!.attemptId, saved.claim.id);
      assert.equal(await work(f), null);
      await runNpcAgent(saved.deps, f.owner, saved.claim, saved.snapshot);
      assert.equal(f.calls, 2, 'one initialization + one review, no second paid review');
      await due(f);
      const next = await work(f);
      assert.ok(next);
      assert.equal(next.grant.anchorAttemptId, saved.claim.id);
      const state = await store.read(f.owner, { worldId: f.worldId, actorId: f.actorId });
      assert.equal(state!.plans.length, 0);
      assert.equal('agendaReview' in state!, false);
    },
  );
  for (const mode of ['unknown', 'invalid'] as const)
    await t.test(
      mode + ' original paid family is not repurchased after the time window',
      async () => {
        const f = await fixture();
        await due(f);
        const grant = await work(f);
        assert.ok(grant);
        await assert.rejects(
          perform(f, ownAgendaReviewInputText(grant.grant), grant.commandId, true, mode),
        );
        await sleep(550);
        assert.equal(await work(f), null);
        assert.equal(f.calls, 2);
        const e = await evidence(f);
        assert.equal(e.familyId, grant.grant.grantId);
      },
    );
  await t.test(
    'an interrupted committed stream cannot become a full successor anchor',
    async () => {
      const f = await fixture();
      await due(f);
      const first = await work(f);
      assert.ok(first);
      const saved = await perform(f, ownAgendaReviewInputText(first.grant), first.commandId, true);
      const before = await evidence(f);
      assert.equal(before.anchor!.attemptId, saved.claim.id);
      // Use the original failure-ledger adapter; never rewrite immutable response/event history.
      const completed = (await store.lookup(f.owner, f.worldId, first.commandId))!;
      await recordStreamSegmentError(db, f.owner, {
        attempt: completed,
        segmentIndex: 0,
        text: '合成中断片段',
      });
      const e = await evidence(f);
      assert.notEqual(e.anchor!.attemptId, saved.claim.id);
      assert.equal(e.familyId, first.grant.grantId);
      await due(f);
      assert.equal(await work(f), null);
      assert.equal(f.calls, 2);
    },
  );
});
