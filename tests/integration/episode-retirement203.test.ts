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

test('44-203 original publication and consideration: retirement only after every participant declines', async (t) => {
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

  for (const lastChoice of ['decline', 'quiet'] as const) {
    const f = await fixture();
    let considered = 0,
      proposed = false;
    const seenChoices: string[] = [];
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
                            i < 2
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
        if (p.input.origin === 'coordination') {
          const choice = considered++ === 0 ? 'decline' : lastChoice;
          seenChoices.push(choice);
          return JSON.stringify({
            protocol: 'npc-wire-v15',
            statements: [],
            executions: [],
            changes: {
              consideration: {
                choice,
                reason: '本人独立判断',
                basisSourceIds: [p.wireCatalog.inputSourceRef],
              },
            },
          });
        }
        return JSON.stringify({
          protocol: 'npc-wire-v15',
          statements: [],
          executions: [],
          changes: null,
        });
      },
    };
    const service = npcAgentAdvanceServices(app, () => model, snapshots, { maxActors: 1 });
    await service.advanceIfEnabled(f.owner, f.id);
    const before = (await directors.readEpisodes(f.owner, f.id))[0];
    assert.ok(before);
    assert.equal(before.status, 'proposed');
    assert.equal(considered, 1);
    const firstReceipt = (
      await admin.query(
        'SELECT attempt_id,source_event_id FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND episode_id=$2',
        [f.id, before.id],
      )
    ).rows[0];
    const forged = {
      ...before,
      status: 'withdrawn',
      revision: before.revision + 1,
      endReason: 'all_participants_declined',
      sourceEventIds: [firstReceipt.source_event_id],
    };
    await admin.query('BEGIN');
    try {
      await admin.query("SELECT set_config('app.agent_commit_attempt_id',$1,true)", [
        firstReceipt.attempt_id,
      ]);
      await assert.rejects(
        admin.query('UPDATE parallel_life.shared_episodes SET document=$2 WHERE world_id=$1', [
          f.id,
          forged,
        ]),
        (e: any) =>
          e.code === '23514' && e.message.includes('EPISODE_WITHDRAWAL_REQUIRES_ALL_DECLINED'),
      );
    } finally {
      await admin.query('ROLLBACK');
    }
    const outsider = randomUUID();
    await new IdentityRepository(app).ensureGuest(outsider);
    const hidden = await app.transaction(outsider, (sql) =>
      sql.query('SELECT id FROM parallel_life.shared_episodes WHERE world_id=$1', [f.id]),
    );
    assert.equal(hidden.rowCount, 0);
    await service.advanceIfEnabled(f.owner, f.id);
    const after = (await directors.readEpisodes(f.owner, f.id))[0]!;
    assert.equal(considered, 2);
    assert.deepEqual(seenChoices, ['decline', lastChoice]);
    assert.equal(after.status, lastChoice === 'decline' ? 'withdrawn' : 'proposed');
    assert.deepEqual(after.resultIds, []);
    if (lastChoice === 'decline') {
      assert.equal(after.endReason, 'all_participants_declined');
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.sourceEventIds.length, 1);
    }
    const rows = (
      await admin.query(
        'SELECT choice,source_event_id FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND episode_id=$2 ORDER BY world_version',
        [f.id, after.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    if (lastChoice === 'decline') assert.equal(after.sourceEventIds[0], rows[1].source_event_id);
    await service.advanceIfEnabled(f.owner, f.id);
    await service.advanceIfEnabled(f.owner, f.id);
    assert.equal(considered, 2);
    assert.deepEqual(await directors.readEpisodes(f.owner, f.id), [after]);
    const w = await worlds.get({ userId: f.owner }, f.id);
    const snap = await snapshots.read(f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      worldVersion: w.version,
      candidates: [],
      blockers: [],
    });
    assert.ok(snap.occupiedAuthoredEventKeys?.includes('all_decline_event'));
    assert.ok(!snap.occupiedAuthoredEventKeys?.includes('defer_service_event'));
    const eligibility = await app.transaction(f.owner, (sql) =>
      readAuthoredEligibilityInTransaction(sql, f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: w.version,
        storyAt: w.time,
      }),
    );
    assert.equal(
      eligibility.eligibility.find((e) => e.ref.nodeKey === 'defer_service_event')?.status,
      'eligible',
    );
    const counts = (
      await admin.query(
        'SELECT count(*)::int n FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
        [f.id],
      )
    ).rows[0];
    assert.equal(counts.n, 2);
  }
});
