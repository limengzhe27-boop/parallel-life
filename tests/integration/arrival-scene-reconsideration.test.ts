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
import { publicationStorageIssues } from '../../src/modules/settings/domain/publication-content.ts';
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
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';

test('real arrival and scene entry trigger stable authored event reconsideration without location leakage', async (t) => {
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
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, 'Local arrival scene wake fixture'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'LOCAL_ARRIVAL_SCENE_WAKE_FIXTURE',
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
  base.places.push({
    key: 'away',
    name: '合成远端场所',
    description: '只供实际到达测试',
    knownAtStart: true,
  });
  base.routes = [
    { fromPlaceKey: 'shop', toPlaceKey: 'away', minutes: 5 },
    { fromPlaceKey: 'away', toPlaceKey: 'shop', minutes: 5 },
  ];
  base.history = [
    {
      key: 'anchor',
      kind: 'established_fact',
      text: '真实绑定的合成起点历史',
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
        title: '原稿一天',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: time(9), expiresAt: '2026-10-13T09:00:00.000Z' },
      },
    ],
  };

  const node = (key: string, prerequisites: unknown[] = [], extra = {}) => ({
    key,
    kind: 'candidate',
    title: '合成候选_' + key,
    editorialIntent: '只可重新考虑，不代表发生。',
    actorKeys: [base.actors[0].key],
    prerequisites,
    mutuallyExclusiveNodeKeys: [],
    intent: { kind: 'director_event' },
    timeline: {
      stageKey: 'day',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    },
    ...extra,
  });

  base.candidates = [
    node('meeting_at_away', [], { placeKey: 'away' }),
    node('meeting_at_shop', [], { placeKey: 'shop' }),
    node('unrelated_anywhere', []),
  ];
  base.openingEventKey = 'meeting_at_shop';

  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app),
    space = new PostgresWorldSpace(app, {
      list() {
        return [];
      },
      get() {
        return undefined;
      },
    });

  async function fixture() {
    const content = structuredClone(base);
    const parsed = PublishedWorldContentSchema.parse(content),
      work = await stableWorks.create(staff, {
        commandId: randomUUID(),
        title: 'Local arrival scene reconsideration publication',
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
          kind = p.promptVersion?.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload: p });
        if (kind === 'npc') {
          const intent = JSON.parse(p.input.text);
          return JSON.stringify({
            statements: [{ text: '好的，我会在现场参与。', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            episodeDecision: {
              requestId: intent.requestId,
              choice: options.npcChoice ?? 'engage',
              reason: '自愿参与。',
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
                title: '合成到达机会',
                description: '到达后现场事件',
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

  // 1. Initial bootstrap
  const f = await fixture();
  const h = harness(f);
  await h.advance();
  assert.equal(h.director().length, 1);
  assert.equal(h.director()[0]!.payload.evaluationCause.kind, 'bootstrap');

  // Verify all candidates initially quieted, no active wake cause
  const postBootstrapWake = await wake(f);
  assert.equal(postBootstrapWake.cause, null, 'after bootstrap quiet, wake cause is null');

  // 2. Chat saying "我到了" does NOT count as actual arrival
  const npcService = npcAgentServices(app, () => ({
    async complete() {
      return JSON.stringify({
        statements: [{ text: '知道了。', dependsOnActionIds: [] }],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      });
    },
  }));
  const w1 = await worlds.get({ userId: f.owner }, f.id);
  await npcService.sendMessageIfEnabled(f.owner, {
    id: randomUUID(),
    worldId: f.id,
    actorId: f.world.actors[0]!.id,
    expectedVersion: w1.version,
    text: '我到了，就在门口。',
  });
  const postChatWake = await wake(f);
  assert.equal(
    postChatWake.cause,
    null,
    'chat utterance "我到了" is not physical execution evidence and must not wake director',
  );

  // 3. Player actually travels to "away" via space.travel (travel.completed)
  const map1 = await space.read(f.owner, f.id);
  const toAwayRoute = map1.routes.find((r) => r.toPlaceId === 'away')!;
  const w2 = await worlds.get({ userId: f.owner }, f.id);
  await space.travel(f.owner, f.id, {
    commandId: randomUUID(),
    expectedVersion: w2.version,
    routeId: toAwayRoute.id,
  });

  // Verify arrival at "away" wakes ONLY "meeting_at_away"
  const postTravelWake = await wake(f);
  assert.ok(postTravelWake.cause, 'real arrival at away must wake director');
  assert.equal(postTravelWake.cause!.kind, 'authored_eligibility');
  const qualificationKeys = postTravelWake.cause!.qualifications.map((q) => q.nodeKey);
  assert.deepEqual(
    qualificationKeys,
    ['meeting_at_away'],
    'only event matching place "away" is reconsidered; shop and anywhere events are not awakened',
  );

  // 4. Advance director with quiet decision
  const h2 = harness(f);
  await h2.advance();
  assert.equal(h2.director().length, 1);
  assert.deepEqual(
    h2.director()[0]!.payload.evaluationCause.qualifications.map((q: any) => q.nodeKey),
    ['meeting_at_away'],
  );

  // 5. Subsequent clock ticks or refreshes do NOT duplicate the wake
  const postQuietWake = await wake(f);
  assert.equal(
    postQuietWake.cause,
    null,
    'once evaluated and quieted, same arrival evidence does not repeatedly wake director',
  );
  await h2.advance();
  assert.equal(h2.director().length, 1, 'no extra model calls without new evidence');

  // 6. Player travels back to "shop" -> wakes "meeting_at_shop"
  const map2 = await space.read(f.owner, f.id);
  const toShopRoute = map2.routes.find((r) => r.toPlaceId === 'shop')!;
  const w3 = await worlds.get({ userId: f.owner }, f.id);
  await space.travel(f.owner, f.id, {
    commandId: randomUUID(),
    expectedVersion: w3.version,
    routeId: toShopRoute.id,
  });

  const returnWake = await wake(f);
  assert.ok(returnWake.cause, 'real arrival back at shop must wake shop event');
  assert.equal(returnWake.cause!.kind, 'authored_eligibility');
  assert.deepEqual(
    returnWake.cause!.qualifications.map((q) => q.nodeKey),
    ['meeting_at_shop'],
    'returning to shop wakes meeting_at_shop, meeting_at_away is no longer matched',
  );

  // 7. Director proposes opportunity for "meeting_at_shop" -> NPC engages
  const h3 = harness(f, { propose: 'meeting_at_shop', npcChoice: 'engage' });
  const advanceResult = await h3.advance();
  assert.equal(advanceResult?.played, 1);
  assert.equal(h3.director().length, 1);
  assert.equal(h3.calls.filter((c) => c.kind === 'npc').length, 1);

  const episodes = await directors.readEpisodes(f.owner, f.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.status, 'active');
  assert.equal(episodes[0]!.origin.kind, 'director');

  // 8. Re-advancing does not duplicate or loop
  await h3.advance(); // A real NPC participation can itself warrant one global evaluation
  const count = h3.calls.length;
  await h3.advance();
  assert.equal(h3.calls.length, count, 'unchanged sources and idle ticks never re-buy consideration');

  // 9. Position Knowledge Isolation: verify NPC has not received leaked knowledge of player position
  const knowledgeRows = (
    await admin.query(
      'SELECT * FROM parallel_life.actor_position_knowledge WHERE world_id=$1',
      [f.id],
    )
  ).rows;
  // Any existing knowledge must not be direct player tracking without legitimate observation
  for (const k of knowledgeRows) {
    assert.notEqual(
      k.document?.subject?.kind,
      'player',
      'NPC must not receive leaked player position knowledge through director wake',
    );
  }
});
