import { createHash } from 'node:crypto';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
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

test('director v15 original kernel persists keyed multi-actor handoffs with isolated personal tasks', async (t) => {
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
  base.candidates = [];
  delete base.openingEventKey;

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

  const f = await fixture();
  let directorCalls = 0,
    npcCalls = 0;
  const topicByActor = new Map<string, string>();
  const captured: { actorId: string; own: boolean; otherAbsent: boolean }[] = [];
  const model: TextModel = {
    async complete(messages, _signal, _cap, output) {
      const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
      if (p.promptVersion.startsWith('director-')) {
        directorCalls++;
        assert.equal(output?.format, 'json_schema');
        if (output?.format !== 'json_schema') throw Error('EXPECTED_SCHEMA');
        assert.equal(output.name, 'director_response_v15');
        const props: any = output.schema.properties;
        assert.equal(props.opportunities.maxItems, 2);
        assert.equal(props.opportunities.items.properties.actors, undefined);
        assert.equal(props.opportunities.items.properties.stagingIntents, undefined);
        assert.deepEqual(p.wireCatalog.events, []);
        for (const [i, a] of p.wireCatalog.actors.entries())
          if (i < 2)
            topicByActor.set(a.actorId, i === 0 ? 'FIXTURE_A_ONLY_TOPIC' : 'FIXTURE_B_ONLY_TOPIC');
        const actorTasks = Object.fromEntries(
          p.wireCatalog.actors.map((a: any, i: number) => [
            a.ref,
            i < 2
              ? {
                  topic: i === 0 ? 'FIXTURE_A_ONLY_TOPIC' : 'FIXTURE_B_ONLY_TOPIC',
                  personalObjective: '本人自主安排自己的工作',
                  proposedInteraction: '向玩家提供具体想法，允许拒绝或不回应',
                }
              : null,
          ]),
        );
        return JSON.stringify({
          protocol: 'director-wire-v15',
          openingContext: p.openingInformationCatalog
            ? {
                informationOwners: Object.fromEntries(
                  p.openingInformationCatalog.information.map((i: any) => [
                    i.ref,
                    { actorRef: null, reason: '合成起点只作公共历史' },
                  ]),
                ),
              }
            : null,
          authoredChoices: {},
          candidates: p.wireCatalog.candidates.map((c: any) => ({
            ref: c.ref,
            decision: 'defer',
            reason: '当前只考虑一个多人机会',
          })),
          opportunities: [
            {
              id: 'joint-fixture',
              title: '各自独立想法',
              description: '两人各考虑本人安排，不赋予玩家责任',
              playerImpact: '玩家可以拒绝或不回应',
              actorTasks,
              places: [],
              activity: 'conversation',
              origin: { kind: 'emergent', sourceRefs: [p.wireCatalog.sources[0].ref] },
              actorTopics: null,
            },
          ],
          audit: { reason: '明确内存模型fixture，不请求供应商', sourceRefs: [] },
        });
      }
      assert.equal(p.input.origin, 'coordination');
      npcCalls++;
      const actorId = p.channel.threadId;
      const expected = topicByActor.get(actorId);
      assert(expected);
      const internal = JSON.stringify(p.presentationContext.internalContext);
      const own = internal.includes(expected),
        otherAbsent = [...topicByActor.values()]
          .filter((topic) => topic !== expected)
          .every((topic) => !internal.includes(topic));
      assert(own);
      assert(otherAbsent);
      assert(internal.includes('actor_interaction_opportunity'));
      assert(p.currentOpportunity?.sourceId);
      captured.push({ actorId, own, otherAbsent });
      return JSON.stringify({
        protocol: 'npc-wire-v15',
        executions: [],
        statements: [{ text: '本人明确的合成测试发言', dependsOnActionIds: [] }],
        changes: {
          consideration: {
            choice: 'engage',
            reason: '本人愿意交流',
            basisSourceIds: [p.wireCatalog.inputSourceRef],
          },
        },
      });
    },
  };
  const service = npcAgentAdvanceServices(app, () => model, snapshots, { maxActors: 1 });
  await service.advanceIfEnabled(f.owner, f.id);
  assert.equal(directorCalls, 1);
  assert.equal(npcCalls, 1);
  await service.advanceIfEnabled(f.owner, f.id);
  assert.equal(directorCalls, 1);
  assert.equal(npcCalls, 2);
  assert.equal(new Set(captured.map((c) => c.actorId)).size, 2);
  const ds = (
    await admin.query(
      "SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND status='committed'",
      [f.id],
    )
  ).rows;
  assert.equal(ds.length, 1);
  const d = ds[0];
  assert.equal(JSON.parse(d.response).protocol, 'director-wire-v15');
  assert.equal(
    d.response_hash,
    createHash('sha256').update(JSON.stringify(d.response)).digest('hex'),
  );
  const requests = (
    await admin.query(
      'SELECT * FROM parallel_life.agent_episode_requests WHERE world_id=$1 ORDER BY actor_id',
      [f.id],
    )
  ).rows;
  assert.equal(requests.length, 2);
  assert(requests.every((q) => q.status === 'consumed'));
  const receipts = (
    await admin.query('SELECT * FROM parallel_life.agent_episode_receipts WHERE world_id=$1', [
      f.id,
    ])
  ).rows;
  assert.equal(receipts.length, 2);
  assert(receipts.every((r) => r.choice === 'engage' && r.presented_message_ids.length === 1));
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_messages WHERE world_id=$1',
        [f.id],
      )
    ).rows[0].n,
    2,
  );
  const replay = await runDirectorAgent(
    {
      attempts: directors,
      model: {
        async decide() {
          throw Error('REPLAY_MUST_NOT_BUY');
        },
      },
      parse: parseDirectorDecision,
    },
    f.owner,
    {
      id: d.id,
      worldId: f.id,
      commandId: d.command_id,
      engineEpoch: d.engine_epoch,
      expectedWorldVersion: d.expected_world_version,
      inputHash: d.input_hash,
      token: d.token,
      leaseUntil: d.lease_until,
    },
    d.snapshot,
  );
  assert.equal(replay.id, d.decision_id);
  const outsider = randomUUID();
  await new IdentityRepository(app).ensureGuest(outsider);
  assert.equal(
    (
      await app.transaction(outsider, (sql) =>
        sql.query('SELECT id FROM parallel_life.agent_episode_receipts WHERE world_id=$1', [f.id]),
      )
    ).rowCount,
    0,
  );
});
