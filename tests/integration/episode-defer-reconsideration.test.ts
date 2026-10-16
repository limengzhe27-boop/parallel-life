import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { readAuthoredEligibilityInTransaction } from '../../src/modules/world/infrastructure/authored-event-eligibility-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';

test('episode deferral reconsideration: multi-actor defer/decline -> quiet stability -> relevant condition change -> wake reconsideration -> episode activation -> clean withdrawal', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class LocalPublisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new LocalPublisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });

  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Only local episode defer reconsideration journey fixtures'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_DEFER_RECONSIDERATION_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'b'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const r = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(r.status, 'compiled');
      if (r.status !== 'compiled') throw Error('EXPLICIT_FIXTURE_COMPILER_FAILED');
      return {
        world: r.world,
        opening: r.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: {
            kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
            ...input.origin,
          },
          identity: r.opening.identity,
          situation: r.opening.situation,
          setting: r.opening.setting,
          experienceNote: r.opening.experienceNote,
        },
      };
    },
  };
  const published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const time = (h: number, m = 0, s = 0) =>
    `2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
  base.world.startAt = time(9);
  base.history = [
    {
      key: 'anchor',
      kind: 'established_fact',
      text: '暂缓复查测试合成起点历史',
      occurredAt: '2026-10-11T09:00:00.000Z',
      actorKeys: [base.actors[0].key, base.actors[1].key],
      visibility: { kind: 'world' },
    },
  ];
  base.initialKnowledge = [
    { actorKey: base.actors[0].key, factKeys: ['anchor'] },
    { actorKey: base.actors[1].key, factKeys: ['anchor'] },
  ];
  base.timeline = {
    initialStageKey: 'day',
    stages: [
      {
        key: 'day',
        title: '日间阶段',
        order: 0,
        afterStageKeys: [],
      },
    ],
  };
  base.candidates = [
    {
      key: 'defer_service_event',
      kind: 'candidate',
      title: '接待分工待定事件',
      editorialIntent: '可以先暂缓等待玩家明确分工。',
      actorKeys: [base.actors[0].key, base.actors[1].key],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
      timeline: {
        stageKey: 'day',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
    {
      key: 'all_decline_event',
      kind: 'candidate',
      title: '全体拒绝测试事件',
      editorialIntent: '所有人拒绝后撤回。',
      actorKeys: [base.actors[0].key, base.actors[1].key],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
      timeline: {
        stageKey: 'day',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
  ];
  base.openingEventKey = 'defer_service_event';

  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app),
    actors = new PostgresAgentRuntimeRepository(app);

  async function fixture() {
    const content = structuredClone(base);
    const parsed = PublishedWorldContentSchema.parse(content),
      work = await stableWorks.create(staff, {
        commandId: randomUUID(),
        title: 'Only local defer reconsideration publication',
        content: parsed,
      });
    const check = await stableWorks.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    await stableWorks.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });
    const owner = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const started = await published.startPublished(owner, work.id, {
        commandId: randomUUID(),
        publicationVersion: 1,
      }),
      id = started.worldId;
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState({ worldId: id, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const f = await fixture();
  const actor0 = f.world.actors[0]!.id;
  const actor1 = f.world.actors[1]!.id;

  const quiet = (candidates: any[] = []) => ({
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: (candidates ?? []).map((c: any) => ({
      candidateId: c.id,
      reason: 'QUIET_NO_OPPORTUNITY',
    })),
    nudges: [],
    opportunities: [],
    audit: { reason: 'EXPLICIT_LOCAL_QUIET', basisSourceIds: [] },
  });

  // --- Step 1: Bootstrap director and propose defer_service_event with 2 actors ---
  let directorProposeCount = 0;
  let episodeId = '';
  let opportunityProposed = false;

  const advanceHarness = (npcHandlers: {
    onEpisodeConsideration?: (actorId: string, intent: any, p: any) => string;
    onWake?: (actorId: string, p: any) => string;
    onPlayerMessage?: (actorId: string, p: any) => string;
  }) => {
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        const isDirector = p.promptVersion?.startsWith('director-');
        if (isDirector) {
          if (!opportunityProposed) {
            opportunityProposed = true;
            episodeId = randomUUID();
            const m = p.authoredMaterials.materials.find(
              (mat: any) => mat.ref.nodeKey === 'defer_service_event',
            );
            return JSON.stringify({
              ...quiet(p.candidates),
              mode: 'bounded_opportunity',
              opportunities: [
                {
                  id: episodeId,
                  title: '接待分工待定机会',
                  description: '商量好的接待执行机会（两人参与）',
                  playerImpact: '玩家与NPC分工',
                  participantActorIds: [actor0, actor1],
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: [m.sourceId],
                  authoredEventKey: 'defer_service_event',
                },
              ],
            });
          }
          if (p.candidates?.length) {
            return JSON.stringify({
              mode: 'coordinate',
              selectedCandidateIds: [p.candidates[0].id],
              deferred: p.candidates.slice(1).map((c: any) => ({ candidateId: c.id, reason: 'DEFERRED' })),
              nudges: [],
              opportunities: [],
              audit: { reason: 'ACTOR_WAKE_APPROVED', basisSourceIds: [] },
            });
          }
          return JSON.stringify(quiet(p.candidates));
        }

        // NPC model handling
        const intent = p.input?.text ? (p.input.text.startsWith('{') ? JSON.parse(p.input.text) : null) : null;
        if (p.input.origin === 'coordination' && intent?.type === 'npc_episode_consideration') {
          return npcHandlers.onEpisodeConsideration!(p.state.actorId, intent, p);
        }
        if (p.input.origin === 'wake') {
          return npcHandlers.onWake!(p.state.actorId, p);
        }
        if (p.input.origin === 'player') {
          return npcHandlers.onPlayerMessage!(p.state.actorId, p);
        }
        return JSON.stringify({ statements: [], goals: [], plans: [], actions: [], responsibilities: [], decisions: [] });
      },
    };
    const service = npcAgentAdvanceServices(app, () => model, snapshots);
    return {
      advance: () => service.advanceIfEnabled(f.owner, f.id),
      service,
    };
  };

  // --- Step 2: Advance once to let Director propose the opportunity ---
  let h = advanceHarness({
    onEpisodeConsideration: (aId, intent, p) => {
      // Actor 0 defers: waiting for player decision
      if (aId === actor0) {
        const sourceIds = [p.input.sourceId, `definition:${p.state.definitionRef}`];
        return JSON.stringify({
          statements: [],
          goals: [
            {
              id: 'goal-defer-service',
              summary: '接待服务分工',
              status: 'active',
              sourceIds,
              resultIds: [],
            },
          ],
          plans: [
            {
              id: 'plan-defer-service',
              goalId: 'goal-defer-service',
              summary: '确认分工后准备饮料并在门口接待',
              status: 'waiting',
              sourceIds,
              actionIds: [],
              nextActionId: null,
              triggers: [
                {
                  kind: 'player_decision',
                  responsibilityId: 'resp-defer-service',
                  decision: 'accepted',
                },
              ],
              missingConditions: ['等待玩家确认分工'],
            },
          ],
          actions: [],
          responsibilities: [
            {
              id: 'resp-defer-service',
              subject: { kind: 'request', id: intent.requestId },
              summary: '等待玩家确认接待分工',
              status: 'waiting',
              waitingOn: 'player',
              sourceIds,
              nextCheck: [
                {
                  kind: 'player_decision',
                  responsibilityId: 'resp-defer-service',
                  decision: 'accepted',
                },
              ],
            },
          ],
          decisions: [],
          episodeDecision: {
            requestId: intent.requestId,
            choice: 'defer',
            reason: '需要先和玩家确认具体分工',
            sourceIds,
          },
        });
      }
      // Actor 1 explicitly declines
      if (aId === actor1) {
        const sourceIds = [p.input.sourceId, `definition:${p.state.definitionRef}`];
        return JSON.stringify({
          statements: [],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
          episodeDecision: {
            requestId: intent.requestId,
            choice: 'decline',
            reason: '我今天有其他事情，不参与本次接待',
            sourceIds,
          },
        });
      }
      throw Error('UNEXPECTED_ACTOR');
    },
    onWake: () => {
      throw Error('UNEXPECTED_WAKE_BEFORE_CONDITION');
    },
    onPlayerMessage: () => {
      throw Error('UNEXPECTED_PLAYER_MESSAGE');
    },
  });

  // Advance 1: Dispatches to Actor 0 (defer)
  const res1 = await h.advance();
  assert.equal(res1?.changed, true);

  // Advance 2: Dispatches to Actor 1 (decline)
  const res2 = await h.advance();
  assert.equal(res2?.changed, true);
  assert.ok(typeof res2?.worldVersion === 'number');
  const worldV2 = res2!.worldVersion!;

  // Verify DB state:
  const episodes = await directors.readEpisodes(f.owner, f.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.id, episodeId);
  // Shared episode MUST be 'proposed', because Actor 0 deferred, waiting for player
  assert.equal(episodes[0]!.status, 'proposed');
  assert.equal(episodes[0]!.sourceEventIds.length, 0);

  // Check occupied authored event keys
  const eligibility = await app.transaction(f.owner, (sql) =>
    readAuthoredEligibilityInTransaction(sql, f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: worldV2,
      storyAt: time(9),
    }),
  );
  // defer_service_event is occupied while proposed
  assert.ok(eligibility.occupiedEventKeys.includes('defer_service_event'));

  // --- Step 3: Unrelated chatter -> No wake, no model call, quiet stability ---
  let npcPlayerCalls = 0;
  const casualChatService = npcAgentServices(app, () => ({
    async complete(messages) {
      npcPlayerCalls++;
      const p = JSON.parse(messages[1]!.content);
      assert.equal(p.state.actorId, actor0);
      // casual chatter response without player decision
      return JSON.stringify({
        statements: [{ text: '是啊，今天天气挺不错的。', dependsOnActionIds: [] }],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      });
    },
  }));

  const chatCmd = {
    id: randomUUID(),
    worldId: f.id,
    expectedVersion: worldV2,
    actorId: actor0,
    text: '今天天气真好。',
  };
  await casualChatService.sendMessageIfEnabled(f.owner, chatCmd);
  assert.equal(npcPlayerCalls, 1);

  // Now advance: Condition (player_decision) is still NOT satisfied!
  // Neither actor should be woken, Actor 1 (declined) must NOT be disturbed.
  const quietAdvance = await h.advance();
  assert.equal(quietAdvance?.played, 0);
  assert.equal(quietAdvance?.actors.length, 0);

  // Re-read episode: still 'proposed'
  const epAfterCasual = (await directors.readEpisodes(f.owner, f.id))[0]!;
  assert.equal(epAfterCasual.status, 'proposed');

  // --- Step 4: Player explicitly makes decision -> condition ready (Stage 1: 获得重评机会) ---
  let decisionChatCalls = 0;
  const decisionChatService = npcAgentServices(app, () => ({
    async complete(messages) {
      decisionChatCalls++;
      const p = JSON.parse(messages[1]!.content);
      const inputSourceId = p.input.sourceId;
      if (p.input.text.includes('调整工作安排')) {
        return JSON.stringify({
          statements: [{ text: '好的，调整为全员参与打扫卫生。', dependsOnActionIds: [] }],
          goals: [],
          plans: [
            {
              id: 'plan-cleaning-duty',
              goalId: 'goal-defer-service',
              summary: '全员参与打扫卫生',
              status: 'active',
              sourceIds: [inputSourceId],
              actionIds: [],
              nextActionId: null,
              triggers: [],
              missingConditions: [],
            },
          ],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      }
      return JSON.stringify({
        statements: [{ text: '好的，我记下了。', dependsOnActionIds: [] }],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [
          {
            id: randomUUID(),
            responsibilityId: 'resp-defer-service',
            kind: 'accepted',
            sourceId: inputSourceId,
            quote: '我负责采购，你负责准备饮料并在门口接待。',
          },
        ],
      });
    },
  }));

  const currentW = await worlds.get({ userId: f.owner }, f.id);
  const decisionCmd = {
    id: randomUUID(),
    worldId: f.id,
    expectedVersion: currentW.version,
    actorId: actor0,
    text: '我负责采购，你负责准备饮料并在门口接待。',
  };
  await decisionChatService.sendMessageIfEnabled(f.owner, decisionCmd);
  assert.equal(decisionChatCalls, 1);

  // --- Step 5: Advance runs -> Actor 0 wakes up, reconsiders, and engages (Stage 2: 人物参与) ---
  let wakeCalls = 0;
  let wokenActor = '';
  const wakeHarness = advanceHarness({
    onWake: (aId, p) => {
      wakeCalls++;
      wokenActor = aId;
      assert.equal(aId, actor0, 'Actor 1 who declined must NEVER be woken');
      const input = JSON.parse(p.input.text);
      assert.equal(input.type, 'npc_own_condition_ready');
      assert.equal(input.source, 'responsibility');
      const existingPlan = p.state.plans.find((x: any) => x.id === 'plan-defer-service');
      const existingResp = p.state.responsibilities.find((x: any) => x.id === 'resp-defer-service');
      const planSources = [...new Set([...(existingPlan?.sourceIds ?? []), p.input.sourceId])];
      const respSources = [...new Set([...(existingResp?.sourceIds ?? []), p.input.sourceId])];
      // NPC engages with dialogue and activates plan
      return JSON.stringify({
        statements: [
          {
            text: '既然分工定好了，我这就去准备饮料并在门口接待！',
            dependsOnActionIds: [],
          },
        ],
        goals: [],
        plans: [
          {
            id: 'plan-defer-service',
            goalId: 'goal-defer-service',
            summary: '准备饮料并在门口接待',
            status: 'active',
            sourceIds: planSources,
            actionIds: [],
            nextActionId: null,
            triggers: [],
            missingConditions: [],
          },
        ],
        actions: [],
        responsibilities: [
          {
            id: 'resp-defer-service',
            subject: existingResp.subject,
            summary: '准备饮料并在门口接待',
            status: 'open',
            waitingOn: 'self',
            sourceIds: respSources,
            nextCheck: [],
          },
        ],
        decisions: [],
      });
    },
  });

  const wakeRes = await wakeHarness.advance();
  assert.equal(wakeCalls, 1);
  assert.equal(wokenActor, actor0);
  assert.equal(wakeRes?.played, 1);
  assert.deepEqual(wakeRes?.actors, [actor0]);

  // Verify: NPC state evolved (plan is active, responsibility is open), while shared episode remains proposed (不伪造事件已进入active或resolved)
  const epAfterWake = (await directors.readEpisodes(f.owner, f.id))[0]!;
  assert.equal(epAfterWake.status, 'proposed');
  assert.equal(epAfterWake.sourceEventIds.length, 0);
  assert.equal(epAfterWake.revision, 0);

  const actor0State = await actors.read(f.owner, { worldId: f.id, actorId: actor0 });
  const activePlan = actor0State!.plans.find((p) => p.id === 'plan-defer-service');
  assert.equal(activePlan?.status, 'active');
  const openResp = actor0State!.responsibilities.find((r) => r.id === 'resp-defer-service');
  assert.equal(openResp?.status, 'open');

  // --- Step 6: Dedup / no looping ---
  // Advance again immediately: candidate was committed, must NOT re-buy or re-wake
  const dedupRes = await wakeHarness.advance();
  assert.equal(wakeCalls, 1, 'wake must not repeat without new condition changes');
  assert.equal(dedupRes?.played, 0);

  // --- Step 7: Clean withdrawal test (all participants decline) ---
  let declineProposed = false;
  let declineEpId = '';

  const declineHarness = (npcHandlers: {
    onEpisodeConsideration?: (actorId: string, intent: any, p: any) => string;
  }) => {
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        const isDirector = p.promptVersion?.startsWith('director-');
        if (isDirector) {
          if (!declineProposed) {
            declineProposed = true;
            declineEpId = randomUUID();
            const m = p.authoredMaterials.materials.find(
              (mat: any) => mat.ref.nodeKey === 'all_decline_event',
            );
            return JSON.stringify({
              ...quiet(p.candidates),
              mode: 'bounded_opportunity',
              opportunities: [
                {
                  id: declineEpId,
                  title: '全体拒绝测试机会',
                  description: '测试全体拒绝后自动标记withdrawn',
                  playerImpact: '测试全员退出',
                  participantActorIds: [actor0, actor1],
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: [m.sourceId],
                  authoredEventKey: 'all_decline_event',
                },
              ],
            });
          }
          return JSON.stringify(quiet(p.candidates));
        }

        const intent = p.input?.text ? (p.input.text.startsWith('{') ? JSON.parse(p.input.text) : null) : null;
        if (p.input.origin === 'coordination' && intent?.type === 'npc_episode_consideration') {
          return npcHandlers.onEpisodeConsideration!(p.state.actorId, intent, p);
        }
        return JSON.stringify({ statements: [], goals: [], plans: [], actions: [], responsibilities: [], decisions: [] });
      },
    };
    const service = npcAgentAdvanceServices(app, () => model, snapshots);
    return {
      advance: () => service.advanceIfEnabled(f.owner, f.id),
      service,
    };
  };

  const dh = declineHarness({
    onEpisodeConsideration: (aId, intent, p) => {
      const sourceIds = [p.input.sourceId, `definition:${p.state.definitionRef}`];
      return JSON.stringify({
        statements: [],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
        episodeDecision: {
          requestId: intent.requestId,
          choice: 'decline',
          reason: '我坚决不参加此项活动',
          sourceIds,
        },
      });
    },
  });

  // Player instructs duty adjustment -> produces plan_changed reason -> Director gets evaluation occasion
  const curWorld = await worlds.get({ userId: f.owner }, f.id);
  const askCmd = {
    id: randomUUID(),
    worldId: f.id,
    expectedVersion: curWorld.version,
    actorId: actor0,
    text: '我决定调整工作安排：全员参与打扫卫生。',
  };
  await decisionChatService.sendMessageIfEnabled(f.owner, askCmd);

  // Advance 1: Director proposes opportunity and dispatches to actor 0 (decline)
  const decRes1 = await dh.advance();
  assert.equal(decRes1?.changed, true);
  assert.ok(declineProposed);
  assert.ok(declineEpId);

  // Still proposed after first decline (1 of 2 declined)
  const epDeclineMid = (await directors.readEpisodes(f.owner, f.id)).find((e) => e.id === declineEpId)!;
  assert.equal(epDeclineMid.status, 'proposed');

  // Advance 2: Dispatches to actor 1 (decline)
  const decRes2 = await dh.advance();
  assert.equal(decRes2?.changed, true);

  // Verify in PostgreSQL: both decline receipts persisted honestly
  const receipts = await app.transaction(f.owner, async (sql) =>
    (
      await sql.query(
        'SELECT actor_id, choice, reason FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND owner_id=$2 AND episode_id=$3 ORDER BY actor_id',
        [f.id, f.owner, declineEpId],
      )
    ).rows,
  );
  assert.equal(receipts.length, 2);
  const declinedActors = receipts.map((r) => r.actor_id).sort();
  assert.deepEqual(declinedActors, [actor0, actor1].sort());
  assert.equal(receipts.every((r) => r.choice === 'decline'), true);

  // Verify: all episode requests consumed, no pending requests remain
  const pendingRequests = await app.transaction(f.owner, async (sql) =>
    Number(
      (
        await sql.query(
          "SELECT count(*)::int n FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND owner_id=$2 AND episode_id=$3 AND status='pending'",
          [f.id, f.owner, declineEpId],
        )
      ).rows[0].n,
    ),
  );
  assert.equal(pendingRequests, 0);

  // Both actors declined: shared episode honestly remains proposed, not falsely progressed to active
  const epDeclineAfter = (await directors.readEpisodes(f.owner, f.id)).find((e) => e.id === declineEpId)!;
  assert.equal(epDeclineAfter.status, 'proposed');
  assert.equal(epDeclineAfter.sourceEventIds.length, 0);

  // Advance again: no more conditions or requests, must stay completely quiet and not repeat harassment
  const quietAfterDecline = await dh.advance();
  assert.equal(quietAfterDecline?.played, 0);
});
