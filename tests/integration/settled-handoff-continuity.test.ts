import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { readSettledUnpresentedHandoffs } from '../../src/modules/world/infrastructure/settled-episode-handoff-read.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
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
  directorSnapshotInputHash,
  PostgresDirectorRuntimeRepository,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

test('settled unpresented handoffs: authentic quiet receipts release only finite unassessed windows', async (t) => {
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
  for (const actor of base.actors) actor.initialPlaceKey = base.places[0].key;
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
      key: 'other_unassessed',
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
      key: 'quiet_handoff',
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
  base.openingEventKey = 'quiet_handoff';

  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app);

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

  for (const secondChoice of ['quiet', 'defer'] as const) {
    await t.test('two-actor original kernel handoff with second ' + secondChoice, async () => {
      const f = await fixture();
      let npcCalls = 0,
        directorCalls = 0;
      const selectedKeys: string[] = [];
      const model: TextModel = {
        async complete(messages) {
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          if (p.protocol?.startsWith('director-wire-')) {
            directorCalls++;
            const events = p.wireCatalog.events;
            const pick = events.find((e: any) => !selectedKeys.includes(e.authoredEventKey));
            if (pick) selectedKeys.push(pick.authoredEventKey);
            return JSON.stringify({
              protocol: 'director-wire-v14',
              openingContext: p.openingInformationCatalog
                ? {
                    informationOwners: Object.fromEntries(
                      p.openingInformationCatalog.information.map((i: any) => [
                        i.ref,
                        { actorRef: null, reason: '合成起点，无额外个人报告' },
                      ]),
                    ),
                  }
                : null,
              authoredChoices: Object.fromEntries(
                events.map((e: any) => [
                  e.ref,
                  e === pick
                    ? {
                        kind: 'consider',
                        opportunity: {
                          title: '本人独立考虑自愿安排',
                          description: '两个虚构人物各自决定自己的安排，尚未向玩家提出或呈现',
                          playerImpact: '玩家不承担任何责任',
                          places: [],
                          activity: 'conversation',
                          actorTasks: Object.fromEntries(
                            p.wireCatalog.actors.map((a: any, i: number) => [
                              a.ref,
                              i < 2
                                ? {
                                    topic: '考虑本人活动安排',
                                    personalObjective: '决定自己是否参与',
                                    proposedInteraction: '可交谈、安静或暂缓',
                                  }
                                : null,
                            ]),
                          ),
                        },
                      }
                    : { kind: 'defer', reason: '仅评估当前有限窗口' },
                ]),
              ),
              candidates: p.wireCatalog.candidates.map((c: any) => ({
                ref: c.ref,
                decision: 'defer',
                reason: '先处理作者事件窗口',
              })),
              opportunities: [],
              audit: { reason: '明确合成测试，无上游请求', sourceRefs: [] },
            });
          }
          if (p.input.origin === 'coordination') {
            const choice = ++npcCalls === 2 ? secondChoice : 'quiet';
            return JSON.stringify({
              protocol: 'npc-wire-v15',
              statements: [],
              executions: [],
              changes: {
                consideration: {
                  choice,
                  reason: '只作本人独立考虑，不向玩家呈现',
                  basisSourceIds: [p.wireCatalog.inputSourceRef],
                  ...(choice === 'defer'
                    ? { followUp: { waitingOn: 'self', missing: ['本人尚未确定自己的安排'] } }
                    : {}),
                },
              },
            });
          }
          throw Error('UNEXPECTED_MODEL_INPUT_IN_FIXTURE');
        },
      };
      const service = npcAgentAdvanceServices(app, () => model, snapshots, { maxActors: 1 });
      const frame = async () => {
        const w = await worlds.get({ userId: f.owner }, f.id);
        return { worldId: f.id, engineEpoch: 2, worldVersion: w.version, storyAt: w.time };
      };
      const read = async () =>
        app.transaction(f.owner, async (sql) =>
          readSettledUnpresentedHandoffs(sql, f.owner, await frame()),
        );
      // A real missing second receipt cannot be substituted with the first participant's quiet.
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(npcCalls, 1);
      assert.deepEqual(await read(), []);
      const ep = (await directors.readEpisodes(f.owner, f.id))[0]!;
      assert.equal(ep.status, 'proposed');
      if (secondChoice === 'quiet') {
        const partialFrame = await frame();
        // A failed unrelated global assessment cannot permanently block an unseen
        // authored window, or grant a retry of the failed paid command.
        const globalSnapshot = await snapshots.read(f.owner, {
          ...partialFrame,
          candidates: [],
          blockers: [],
        });
        assert.deepEqual(globalSnapshot.deliberationWindow?.nodeKeys, []);
        let invalidCalls = 0;
        const invalidCommand = {
          id: randomUUID(),
          worldId: f.id,
          commandId: randomUUID(),
          engineEpoch: 2,
          expectedWorldVersion: partialFrame.worldVersion,
          inputHash: directorSnapshotInputHash(globalSnapshot),
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        };
        const invalidDeps = {
          attempts: directors,
          model: {
            async decide() {
              invalidCalls++;
              return '{invalid';
            },
          },
          parse: parseDirectorDecision,
        };
        await assert.rejects(
          runDirectorAgent(invalidDeps, f.owner, invalidCommand, globalSnapshot),
          {
            code: 'INVALID_DIRECTOR_PROPOSAL',
          },
        );
        assert.equal(
          (await directors.lookup(f.owner, f.id, invalidCommand.commandId))?.status,
          'invalid_output',
        );
        await assert.rejects(
          runDirectorAgent(invalidDeps, f.owner, invalidCommand, globalSnapshot),
          {
            code: 'INVALID_STATE',
          },
        );
        assert.equal(invalidCalls, 1);
      }
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(npcCalls, 2);
      const receipts = (
        await admin.query(
          'SELECT choice,presented_message_ids FROM parallel_life.agent_episode_receipts WHERE world_id=$1 AND episode_id=$2 ORDER BY world_version',
          [f.id, ep.id],
        )
      ).rows;
      assert.deepEqual(
        receipts.map((r) => r.choice),
        ['quiet', secondChoice],
      );
      assert(receipts.every((r) => r.presented_message_ids.length === 0));
      assert.equal((await directors.readEpisodes(f.owner, f.id))[0]!.status, 'proposed');
      const settled = await read();
      const currentView = await snapshots.read(f.owner, {
        ...(await frame()),
        candidates: [],
        blockers: [],
      });
      assert.equal(
        currentView.episodes.some((episode) => episode.id === ep.id),
        secondChoice === 'defer',
      );
      // Filtering current work must not rewrite the historical episode or participation receipts.
      assert.equal((await directors.readEpisodes(f.owner, f.id))[0]!.status, 'proposed');
      if (secondChoice === 'defer') {
        assert.deepEqual(settled, []);
        return;
      }
      assert.equal(settled.length, 1);
      assert.equal(settled[0]!.episodeId, ep.id);
      assert.equal(settled[0]!.receipts.length, 2);
      assert.deepEqual(await read(), settled);
      const outsider = randomUUID();
      await new IdentityRepository(app).ensureGuest(outsider);
      assert.deepEqual(
        await app.transaction(outsider, async (sql) =>
          readSettledUnpresentedHandoffs(sql, outsider, await frame()),
        ),
        [],
      );
      const before = await frame();
      const wake = await app.transaction(f.owner, (sql) =>
        readDirectorNarrativeWakeInTransaction(sql, f.owner, before),
      );
      assert.equal(wake.cause?.kind, 'authored_eligibility');
      if (wake.cause?.kind !== 'authored_eligibility') throw Error('MISSING_NEW_WINDOW');
      assert.deepEqual(
        wake.cause.qualifications.map((q) => q.nodeKey),
        ['other_unassessed'],
      );
      const stable = await app.transaction(f.owner, (sql) =>
        readDirectorNarrativeWakeInTransaction(sql, f.owner, before),
      );
      assert.deepEqual(stable, wake);
      assert.equal(directorCalls, 1);
      assert.equal(npcCalls, 2);
      // Consume the other catalogue window through the same real kernel, not the old request.
      await service.advanceIfEnabled(f.owner, f.id);
      await service.advanceIfEnabled(f.owner, f.id);
      assert.equal(directorCalls, 2);
      assert.equal(npcCalls, 4);
      const after = await frame();
      const exhausted = await app.transaction(f.owner, (sql) =>
        readDirectorNarrativeWakeInTransaction(sql, f.owner, after),
      );
      assert.equal(exhausted.cause, null);
      assert.deepEqual(
        await app.transaction(f.owner, (sql) =>
          readDirectorNarrativeWakeInTransaction(sql, f.owner, after),
        ),
        exhausted,
      );
      assert.equal(directorCalls, 2);
      assert.equal(npcCalls, 4);
      assert.deepEqual(selectedKeys, ['quiet_handoff', 'other_unassessed']);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        4,
      );
    });
  }
});
