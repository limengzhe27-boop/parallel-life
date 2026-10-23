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
import { PostgresDirectorRuntimeRepository } from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { readAuthoredEligibilityInTransaction } from '../../src/modules/world/infrastructure/authored-event-eligibility-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';

test('44-204 original consideration and chat: active episode ends only after all participants explicitly withdraw', async (t) => {
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
  base.openingEventKey = 'all_decline_event';

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

  for (const participantCount of [1, 2]) {
    const f = await fixture();
    let proposed = false,
      considered = 0,
      calls = 0;
    let mode: 'quiet' | 'plan_only' | 'withdraw' | 'replacement' = 'quiet';
    const model: TextModel = {
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion.startsWith('director-')) {
          const pick = !proposed;
          proposed = true;
          return JSON.stringify({
            protocol: 'director-wire-v14',
            openingContext: p.openingInformationCatalog
              ? {
                  informationOwners: Object.fromEntries(
                    p.openingInformationCatalog.information.map((i: any) => [
                      i.ref,
                      { actorRef: null, reason: '合成起点无个人报告' },
                    ]),
                  ),
                }
              : null,
            authoredChoices: Object.fromEntries(
              p.wireCatalog.events.map((e: any) => [
                e.ref,
                pick && e.authoredEventKey === 'all_decline_event'
                  ? {
                      kind: 'consider',
                      opportunity: {
                        title: '自愿活动',
                        description: '两个人独立决定是否参与',
                        playerImpact: '玩家自行决定',
                        places: [],
                        activity: 'conversation',
                        actorTasks: Object.fromEntries(
                          p.wireCatalog.actors.map((a: any, i: number) => [
                            a.ref,
                            i < participantCount
                              ? {
                                  topic: '是否参与自愿活动',
                                  personalObjective: '决定自己的安排',
                                  proposedInteraction: '自行接受或拒绝',
                                }
                              : null,
                          ]),
                        ),
                      },
                    }
                  : { kind: 'defer', reason: '不重复已处理机会' },
              ]),
            ),
            candidates: p.wireCatalog.candidates.map((c: any) => ({
              ref: c.ref,
              decision: 'defer',
              reason: '优先处理人物机会',
            })),
            opportunities: [],
            audit: { reason: '合成参与决定', sourceRefs: [] },
          });
        }

        calls++;
        const sourceIds = p.wireCatalog.sources.map((s: any) => s.ref);
        if (p.input.origin === 'coordination') {
          considered++;
          return JSON.stringify({
            protocol: 'npc-wire-v15',
            statements: [{ text: '我愿意参与，先准备自己的安排。', dependsOnActionIds: [] }],
            executions: [],
            changes: {
              consideration: {
                choice: 'engage',
                reason: '本人自愿参与',
                basisSourceIds: [p.wireCatalog.inputSourceRef],
              },
              planIntents: [
                {
                  kind: 'create',
                  ref: 'participate',
                  goal: { kind: 'new', summary: '参与当前活动', sourceIds },
                  summary: '等待具体安排',
                  sourceIds,
                  nextStep: { kind: 'wait', conditions: [], missing: ['等待具体安排'] },
                },
              ],
            },
          });
        }
        if (p.input.origin !== 'player')
          return JSON.stringify({
            protocol: 'npc-wire-v15',
            statements: [],
            executions: [],
            changes: null,
          });
        const goal = p.state.goals.find((g: any) => g.status === 'active');
        const plan = p.state.plans.find(
          (x: any) => x.goalId === goal?.id && !['withdrawn', 'finished'].includes(x.status),
        );
        assert.ok(goal, 'the original participation goal is visible');
        const changes: any = {};
        if (mode !== 'quiet' && plan)
          changes.planIntents = [
            {
              kind: 'close',
              planId: plan.id,
              status: 'withdrawn',
              reason: '调整本人安排',
              sourceIds: [p.wireCatalog.inputSourceRef],
            },
          ];
        if (mode === 'replacement')
          changes.planIntents.push({
            kind: 'create',
            ref: 'alternative',
            goal: { kind: 'existing', id: goal.id },
            summary: '改用另一种方式参与',
            sourceIds,
            nextStep: { kind: 'wait', conditions: [], missing: ['等待另一种安排'] },
          });
        if (mode === 'withdraw')
          changes.goals = [
            {
              id: goal.id,
              summary: goal.summary,
              status: 'withdrawn',
              endReason: '本人明确退出活动',
              sourceIds,
            },
          ];
        return JSON.stringify({
          protocol: 'npc-wire-v15',
          statements: [
            {
              text: mode === 'withdraw' ? '我决定退出这次活动。' : '我再想想自己的安排。',
              dependsOnActionIds: [],
            },
          ],
          executions: [],
          changes: Object.keys(changes).length ? changes : null,
        });
      },
    };
    const advance = npcAgentAdvanceServices(app, () => model, snapshots, { maxActors: 1 });
    for (let i = 0; i < participantCount; i++) await advance.advanceIfEnabled(f.owner, f.id);
    const initial = (await directors.readEpisodes(f.owner, f.id))[0]!;
    assert.equal(initial.status, 'active');
    assert.equal(considered, participantCount);
    const receipts = (
      await admin.query(
        'SELECT * FROM parallel_life.agent_episode_receipts WHERE world_id=$1 ORDER BY actor_id',
        [f.id],
      )
    ).rows;
    assert.equal(receipts.length, participantCount);
    const actorIds = receipts.map((r) => r.actor_id);
    const chat = npcAgentServices(app, () => model);
    async function send(actorId: string, next: typeof mode) {
      mode = next;
      const world = await worlds.get({ userId: f.owner }, f.id);
      const r = await chat.sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.id,
        expectedVersion: world.version,
        actorId,
        text: '请按你自己的意愿调整这次活动的安排。',
      });
      assert.ok(r && r.status === 'committed', JSON.stringify(r));
      return (await directors.readEpisodes(f.owner, f.id))[0]!;
    }
    assert.equal((await send(actorIds[0], 'quiet')).status, 'active');
    assert.equal((await send(actorIds[0], 'replacement')).status, 'active');
    assert.equal((await send(actorIds[0], 'plan_only')).status, 'active');
    for (let i = 0; i < actorIds.length; i++) {
      const result = await send(actorIds[i], 'withdraw');
      assert.equal(result.status, i === actorIds.length - 1 ? 'withdrawn' : 'active');
      assert.deepEqual(result.resultIds, []);
    }
    const final = (await directors.readEpisodes(f.owner, f.id))[0]!;
    assert.equal(final.endReason, 'all_participants_withdrew');
    assert.deepEqual(
      (
        await admin.query(
          'SELECT * FROM parallel_life.agent_episode_receipts WHERE world_id=$1 ORDER BY actor_id',
          [f.id],
        )
      ).rows,
      receipts,
      'original engage decisions must remain immutable',
    );
    const before = considered;
    await advance.advanceIfEnabled(f.owner, f.id);
    assert.equal(considered, before, 'no new participation purchase for retired source');
    assert.deepEqual(await directors.readEpisodes(f.owner, f.id), [final]);
  }
});
