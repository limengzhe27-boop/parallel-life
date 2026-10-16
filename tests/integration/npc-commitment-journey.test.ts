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
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';

test('NPC commitment journey: player division of labor -> real DB persistence -> 111 authored reconsideration -> director proposal -> NPC engagement', async (t) => {
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
    [staff, 'Only local authored commitment journey fixtures'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_COMMITMENT_JOURNEY_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
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
      text: '分工测试合成起点历史',
      occurredAt: '2026-10-11T09:00:00.000Z',
      actorKeys: [base.actors[0].key],
      visibility: { kind: 'world' },
    },
  ];
  base.initialKnowledge = [{ actorKey: base.actors[0].key, factKeys: ['anchor'] }];
  base.timeline = {
    initialStageKey: 'day',
    stages: [
      {
        key: 'day',
        title: '分工测试阶段',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: time(9), expiresAt: '2026-10-13T09:00:00.000Z' },
      },
    ],
  };
  base.candidates = [
    {
      key: 'service_event',
      kind: 'candidate',
      title: '合成接待分工事件',
      editorialIntent: '只可考虑，不代表发生。',
      actorKeys: [base.actors[0].key],
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
  base.openingEventKey = 'service_event';

  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app);

  async function fixture() {
    const content = structuredClone(base);
    const parsed = PublishedWorldContentSchema.parse(content),
      work = await stableWorks.create(staff, {
        commandId: randomUUID(),
        title: 'Only local commitment journey publication',
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
  async function snap(f: Fixture) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: w.version,
      candidates: [],
      blockers: [],
    });
  }
  async function wake(f: Fixture) {
    const s = await snap(f);
    return app.transaction(f.owner, (sql) =>
      readDirectorNarrativeWakeInTransaction(sql, f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: s.worldVersion,
        storyAt: s.storyAt,
      }),
    );
  }
  const quiet = () => ({
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: 'EXPLICIT_LOCAL_QUIET', basisSourceIds: [] },
  });

  function harness(
    f: Fixture,
    options: {
      propose?: string;
      npcChoice?: 'quiet' | 'engage';
    } = {},
  ) {
    const calls: { kind: 'director' | 'npc'; payload: any }[] = [];
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content),
          kind = p.promptVersion.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload: p });
        if (kind === 'npc') {
          const intent = JSON.parse(p.input.text);
          assert.equal(intent.type, 'npc_episode_consideration');
          return JSON.stringify({
            statements:
              options.npcChoice === 'engage'
                ? [{ text: '我愿意考虑参加，尚未完成分工事件。', dependsOnActionIds: [] }]
                : [],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            episodeDecision: {
              requestId: intent.requestId,
              choice: options.npcChoice ?? 'quiet',
              reason: '本人的分工安排。',
              sourceIds: [p.input.sourceId, `definition:${p.state.definitionRef}`],
            },
          });
        }
        if (options.propose && calls.filter((c) => c.kind === 'director').length === 1) {
          const m = p.authoredMaterials.materials.find(
            (m: any) => m.ref.nodeKey === options.propose,
          );
          return JSON.stringify({
            ...quiet(),
            mode: 'bounded_opportunity',
            opportunities: [
              {
                id: randomUUID(),
                title: '分工接待机会',
                description: '商量好的接待执行机会',
                playerImpact: '玩家自主决定',
                participantActorIds: [f.world.actors[0]!.id],
                placeIds: [],
                activity: 'conversation',
                basisSourceIds: [m.sourceId],
                authoredEventKey: options.propose,
              },
            ],
          });
        }
        return JSON.stringify(quiet());
      },
    };
    const service = npcAgentAdvanceServices(app, () => model, snapshots);
    return {
      calls,
      director: () => calls.filter((c) => c.kind === 'director'),
      advance: () => service.advanceIfEnabled(f.owner, f.id),
    };
  }

  // --- Step 0: Setup and initial bootstrap ---
  const f = await fixture();
  const h0 = harness(f);
  await h0.advance();
  assert.equal(h0.director().length, 1);
  assert.equal(h0.director()[0]!.payload.evaluationCause.kind, 'bootstrap');
  // At baseline after bootstrap quiet, wake cause is null
  assert.equal((await wake(f)).cause, null);

  const actorId = f.world.actors[0]!.id;

  // --- Step 1 & 关键缺口验证: 模型只返回对白而无提案时，不凭空补计划，不重评作者事件 ---
  let npcModelCalls = 0;
  let customNpcResponse: () => string;
  const controlledModel: TextModel = {
    async complete(messages) {
      npcModelCalls++;
      return customNpcResponse();
    },
  };
  const npcService = npcAgentServices(app, () => controlledModel);

  // A. Casual chat / oral promise without structured proposal
  customNpcResponse = () =>
    JSON.stringify({
      statements: [{ text: '我会准备饮料并在门口接待你。', dependsOnActionIds: [] }],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    });

  const cmdRound1 = {
    id: randomUUID(),
    worldId: f.id,
    actorId,
    expectedVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
    text: '你先负责门口接待？',
  };
  const resRound1 = await npcService.sendMessageIfEnabled(f.owner, cmdRound1);
  assert.equal(resRound1?.status, 'committed');

  // Verify DB state after Round 1: NO goals, NO plans, NO responsibilities were created!
  const stateAfterRound1 = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.id, actorId],
    )
  ).rows[0].document;
  assert.equal(stateAfterRound1.goals.length, 0, 'No goals should be invented from oral statement');
  assert.equal(stateAfterRound1.plans.length, 0, 'No plans should be invented from oral statement');
  assert.equal(stateAfterRound1.responsibilities.length, 0, 'No responsibilities should be invented');

  // Verify wake after Round 1: Oral promise does NOT produce a semantic wake trigger!
  const wakeAfterRound1 = await wake(f);
  assert.equal(
    wakeAfterRound1.cause,
    null,
    'Oral dialogue without structured plan delta must NOT trigger authored event reconsideration',
  );

  // --- Step 2 & 3: 玩家提出分工，受控模型一次返回对白与带合法来源的目标、计划、责任提案，原内核与事务提交 ---
  customNpcResponse = () =>
    JSON.stringify({
      statements: [
        {
          text: '好，就这么分工：我负责准备饮料并在门口接待，完成后通知你。',
          dependsOnActionIds: [],
        },
      ],
      goals: [
        {
          id: 'goal_drink_service',
          summary: '负责准备饮料并在门口接待',
          status: 'active',
          sourceIds: [`definition:${stateAfterRound1.definitionRef}`],
          resultIds: [],
        },
      ],
      plans: [
        {
          id: 'plan_drink_service',
          goalId: 'goal_drink_service',
          summary: '准备饮料并在门口接待玩家',
          status: 'active',
          sourceIds: [`definition:${stateAfterRound1.definitionRef}`],
          actionIds: [],
          nextActionId: null,
          triggers: [],
          missingConditions: [],
        },
      ],
      actions: [],
      responsibilities: [
        {
          id: 'resp_notify_player',
          subject: { kind: 'matter', id: 'matter_drinks' },
          summary: '饮料准备完成后通知玩家',
          status: 'waiting',
          waitingOn: 'self',
          sourceIds: [`definition:${stateAfterRound1.definitionRef}`],
          nextCheck: [],
        },
      ],
      decisions: [],
    });

  const cmdRound2 = {
    id: randomUUID(),
    worldId: f.id,
    actorId,
    expectedVersion: (await worlds.get({ userId: f.owner }, f.id)).version,
    text: '那我们说定了：我负责采购，你负责准备饮料并在门口接待，完成后通知我。',
  };
  const callsBeforeRound2 = npcModelCalls;
  const resRound2 = await npcService.sendMessageIfEnabled(f.owner, cmdRound2);
  assert.equal(resRound2?.status, 'committed');
  assert.equal(npcModelCalls, callsBeforeRound2 + 1, 'Exactly one model call was made');

  // --- Step 4: 重新从数据库读取，确认人物状态、事件、回执及相关通知保存正确 ---
  // A. Check actor_agent_states in PG
  const stateRow = (
    await admin.query(
      'SELECT document, revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.id, actorId],
    )
  ).rows[0];
  const durableDoc = stateRow.document;
  assert.equal(durableDoc.goals.length, 1);
  assert.equal(durableDoc.goals[0].id, 'goal_drink_service');
  assert.equal(durableDoc.goals[0].status, 'active');
  assert.equal(durableDoc.plans.length, 1);
  assert.equal(durableDoc.plans[0].id, 'plan_drink_service');
  assert.equal(durableDoc.plans[0].status, 'active');
  assert.equal(durableDoc.responsibilities.length, 1);
  assert.equal(durableDoc.responsibilities[0].id, 'resp_notify_player');
  assert.equal(durableDoc.responsibilities[0].status, 'waiting');
  assert.ok(Number(stateRow.revision) > 0, 'Revision was incremented');

  // B. Check world_events in PG
  const eventRow = (
    await admin.query(
      'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND id=$2',
      [f.id, resRound2!.eventId],
    )
  ).rows[0];
  const eventPayload = eventRow.payload;
  assert.equal(eventPayload.type, 'turn.resolved');
  assert.equal(
    eventPayload.data.agentRuntime.stateAfter.plans[0].id,
    'plan_drink_service',
    'Event records durable plan in stateAfter',
  );
  assert.equal(
    eventPayload.data.agentRuntime.proposal.statements[0].text,
    '好，就这么分工：我负责准备饮料并在门口接待，完成后通知你。',
  );

  // C. Check agent_input_receipts in PG
  const receiptRow = (
    await admin.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
      [f.id, cmdRound2.id],
    )
  ).rows[0];
  assert.ok(receiptRow, 'Input receipt must be persisted');
  assert.equal(receiptRow.document.recipientActorId, actorId);
  assert.equal(receiptRow.document.text, cmdRound2.text);

  // D. Check agent_attempts in PG
  const attemptRow = (
    await admin.query(
      'SELECT status, event_id FROM parallel_life.agent_attempts WHERE world_id=$1 AND command_id=$2',
      [f.id, cmdRound2.id],
    )
  ).rows[0];
  assert.equal(attemptRow.status, 'committed');
  assert.equal(attemptRow.event_id, resRound2!.eventId);

  // --- Step 5: 原111读取真实提交的计划变化，生成一次新的作者事件重评依据 ---
  const wakeAfterCommitment = await wake(f);
  assert.ok(wakeAfterCommitment.cause, 'Committed plan change must generate an authored wake cause');
  assert.equal(wakeAfterCommitment.cause.kind, 'authored_eligibility');
  const qualificationKeys = wakeAfterCommitment.cause.qualifications.map((q: any) => q.nodeKey);
  assert.deepEqual(
    qualificationKeys,
    ['service_event'],
    'Authored event service_event must be reconsidered because participating actor committed a new plan',
  );

  // --- Step 6: 原导演运行入口提出事件机会，再交给对应人物独立决定参与；不修改 DB 标为已演或完成 ---
  const hAdvance = harness(f, { propose: 'service_event', npcChoice: 'engage' });
  const advanceResult = await hAdvance.advance();
  assert.equal(advanceResult?.played, 1, 'One authored event opportunity was played');
  assert.equal(hAdvance.director().length, 1, 'Director ran exactly once for this cause');
  assert.equal(
    hAdvance.calls.filter((c) => c.kind === 'npc').length,
    1,
    'NPC was consulted for episode consideration',
  );

  // Verify in DB that episode is active, NOT marked as completed
  const episodes = await directors.readEpisodes(f.owner, f.id);
  assert.equal(episodes.length, 1);
  assert.equal(
    episodes[0]!.status,
    'active',
    'Shared episode is active; participating is NOT incident completion',
  );

  // Verify that the wake cause was consumed and is not re-triggered
  const wakeAfterPlay = await wake(f);
  assert.equal(wakeAfterPlay.cause, null, 'Wake cause is cleared after director evaluation');

  // --- Step 7: 相同请求重放、重复推进，不重复保存责任、不重复执行或购买同一依据的模型调用 ---
  // A. Replay the exact same player command
  const callsBeforeReplay = npcModelCalls;
  const resReplay = await npcService.sendMessageIfEnabled(f.owner, cmdRound2);
  assert.equal(resReplay?.status, 'committed');
  assert.equal(resReplay?.eventId, resRound2!.eventId, 'Replay returns identical eventId');
  assert.equal(
    npcModelCalls,
    callsBeforeReplay,
    'Replay of committed command does NOT call the model again',
  );

  // Verify DB state did not duplicate goals or plans
  const stateAfterReplay = (
    await admin.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
      [f.id, actorId],
    )
  ).rows[0].document;
  assert.equal(stateAfterReplay.goals.length, 1, 'Goals not duplicated');
  assert.equal(stateAfterReplay.plans.length, 1, 'Plans not duplicated');
  assert.equal(stateAfterReplay.responsibilities.length, 1, 'Responsibilities not duplicated');

  // B. Advance director again:
  // A real NPC participation can itself warrant one global evaluation.
  await hAdvance.advance();
  const count = hAdvance.calls.length;

  // Further repeated advance: no wake cause, unchanged sources do not re-buy consideration
  const advanceAgain = await hAdvance.advance();
  assert.equal(advanceAgain?.played, 0, 'No opportunities played without wake cause');
  assert.equal(
    hAdvance.calls.length,
    count,
    'Unchanged sources and idle ticks never re-buy consideration',
  );
});
