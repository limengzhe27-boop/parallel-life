import { createHash } from 'node:crypto';
import { decodeDirectorWire } from '../../src/modules/world/infrastructure/director-model-protocol.ts';
import {
  createEpisodeRequestsInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { readActorEpisodeIntentsInTransaction } from '../../src/modules/world/infrastructure/actor-episode-intent-repository.ts';
import { readInvalidAuthoredEpisodeIds } from '../../src/modules/world/infrastructure/authored-episode-scope-read.ts';
import { hasPendingEpisodeWork } from '../../src/modules/world/infrastructure/episode-pending-work-repository.ts';
import { revalidateDirectorHandoff } from '../../src/modules/world/domain/director-handoff-revalidation.ts';
import {
  directorWireCatalog,
  directorOpeningOwnerCatalog,
} from '../../src/modules/world/infrastructure/director-model-protocol.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { readActorStrategyBasis } from '../../src/modules/world/infrastructure/agent-source-resolver.ts';
import { migrateLegacyWorldInTransaction } from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
import { readAgentPhoneEntryProbe } from '../../src/modules/world/infrastructure/agent-phone-entry-probe.ts';
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
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
test('authenticated legacy author cast mismatch filters one bad request without blocking a good request or repeating a released window', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AUTHORED_CAST_TEST_PORT ?? 55685));
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
    [staff, 'Only local authored eligibility SQL fixtures'],
  );
  // Reviewer evidence must be stable across check/publish. No provider, no production review claim.
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_AUTHORED_SEMANTIC_WAKE_FIXTURE',
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
  base.actors.forEach((actor: any, index: number) => {
    actor.lifeModules = {
      lifeContext: `ACTOR_BACKGROUND_${index}`,
      traits: `ACTOR_TRAITS_${index}`,
    };
  });
  base.places.push({
    key: 'away',
    name: '合成另一处小店',
    description: '只供实际旅行测试',
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
  base.conditions = [
    {
      key: 'alternative_evidence',
      title: '地点或既有事实',
      match: 'any',
      prerequisites: [
        { kind: 'at_place', placeKey: 'away' },
        { kind: 'history_fact', factKey: 'anchor' },
      ],
    },
  ];
  const node = (key: string, prerequisites: unknown[] = [], extra = {}) => ({
    key,
    kind: 'candidate',
    title: '合成候选_' + key,
    editorialIntent:
      'AUTHOR_GLOBAL_MANUSCRIPT_NOT_FOR_NPC. Future interaction; not an established fact.',
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
    node('always', [], { actorKeys: base.actors.map((actor: any) => actor.key) }),
    node('a', [{ kind: 'not_before', at: time(9) }], {
      timeline: {
        stageKey: 'day',
        window: { notBefore: time(9), expiresAt: time(11) },
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    }),
    node('b', [{ kind: 'not_before', at: time(9) }]),
    node('c', [{ kind: 'not_before', at: time(9) }]),
    node('d', [{ kind: 'not_before', at: time(9) }]),
  ];
  base.openingEventKey = 'always';
  base.phone.messages = base.actors.map((actor: any, index: number) => ({
    key: 'own_history_' + index,
    actorKey: actor.key,
    origin: 'history',
    speaker: 'actor',
    text: 'PRIVATE_GENESIS_HISTORY_' + index,
    at: '2026-10-11T08:00:00.000Z',
  }));

  const clocks = new PostgresClockStore(app),
    activity = new PostgresClockActivityRepository(app),
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
  async function fixture(
    options: { admit?: boolean; proof?: boolean; multi?: boolean; legacy?: boolean } = {},
  ) {
    const content = structuredClone(base);
    if (options.proof)
      content.candidates.push(node('fallback', [], { conditionKeys: ['alternative_evidence'] }));
    if (options.multi)
      for (const key of ['aa', 'a_b'])
        content.candidates.push(node(key, [{ kind: 'not_before', at: time(10) }]));
    const parsed = PublishedWorldContentSchema.parse(content),
      work = await stableWorks.create(staff, {
        commandId: randomUUID(),
        title: 'Only local semantic wake publication',
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
      if (options.legacy) {
        await migrateLegacyWorldInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: world.version,
        });
        return;
      }
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
      if (options.admit !== false)
        await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await clocks.setClock(owner, id, { paused: false, speed: 1 });
    const initialFrame = await snapshots.read(owner, {
      worldId: id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    if (initialFrame.openingContextAuthority) {
      const catalog = directorWireCatalog(initialFrame),
        owners = directorOpeningOwnerCatalog(initialFrame);
      const raw = JSON.stringify({
        protocol: 'director-wire-v14',
        openingContext: {
          informationOwners: Object.fromEntries(
            owners.information.map((i) => [
              i.ref,
              { actorRef: null, reason: '合成设定，不额外建立人物知情' },
            ]),
          ),
        },
        authoredChoices: Object.fromEntries(
          catalog.events.map((e) => [e.ref, { kind: 'defer', reason: '先处理原始信息确认边界' }]),
        ),
        candidates: [],
        opportunities: [],
        audit: { reason: '已有来源确认，不演出未来事件', sourceRefs: [] },
      });
      const claim = {
        id: randomUUID(),
        worldId: id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(initialFrame),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      };
      let a = (await directors.claim(owner, claim, initialFrame)).attempt;
      a = await directors.mark(owner, a, 'request_sent');
      a = await directors.saveResponse(owner, a, raw);
      await directors.commit(owner, a, initialFrame, parseDirectorDecision(initialFrame, raw, a));
    }
    return { owner, id, world };
  }
  const f = await fixture();
  const original = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 0,
    candidates: [],
    blockers: [],
  });
  const catalog = directorWireCatalog(original);
  assert.deepEqual(
    catalog.events.map((e) => e.authoredEventKey),
    ['a', 'b'],
  );
  const performerFor = (eventKey: string, bad: boolean) => {
    const node = original.authoredMaterials!.materials.find((m) => m.ref.nodeKey === eventKey)!;
    const allowed = node.participantRefs.flatMap((r) =>
      r.status === 'resolved' && r.actorId ? [r.actorId] : [],
    );
    return bad
      ? catalog.actors.find((actor) => !allowed.includes(actor.actorId))!.actorId
      : allowed[0]!;
  };
  const wire = {
    protocol: 'director-wire-v14',
    openingContext: null,
    authoredChoices: Object.fromEntries(
      catalog.events.map((e, index) => [
        e.ref,
        {
          kind: 'consider',
          opportunity: {
            title: 'Legacy ' + e.authoredEventKey,
            description: 'A protected historical future task, no action performed.',
            playerImpact: 'Optional consideration.',
            places: [],
            activity: 'conversation',
            actorTasks: Object.fromEntries(
              catalog.actors.map((actor, i) => [
                actor.ref,
                actor.actorId === performerFor(e.authoredEventKey, index === 1)
                  ? {
                      topic: '本人安排' + e.authoredEventKey,
                      personalObjective: '独立决定自己的立场',
                      proposedInteraction: '可选择向玩家提出自己的安排',
                    }
                  : null,
              ]),
            ),
          },
        },
      ]),
    ),
    candidates: [],
    opportunities: [],
    audit: { reason: 'Explicit synthetic old-runtime fixture', sourceRefs: [] },
  };
  const wireRaw = JSON.stringify(wire),
    claim = {
      id: randomUUID(),
      worldId: f.id,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: 0,
      inputHash: directorSnapshotInputHash(original),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
  let a = (await directors.claim(f.owner, claim, original)).attempt;
  a = await directors.mark(f.owner, a, 'request_sent');
  a = await directors.saveResponse(f.owner, a, wireRaw);
  assert.throws(() => parseDirectorDecision(original, wireRaw, a), /authorized boundary/);
  // Reconstruct only this isolated historical fixture using the former decoder
  // and original protected SQL rows. No production checks are disabled, no old
  // history is updated, and this is not a model-success assertion.
  const decoded = decodeDirectorWire(original, wire) as any;
  decoded.opportunities = decoded.opportunities.map((o: any) => ({
    ...o,
    id:
      'director-opportunity:' +
      createHash('sha256')
        .update(JSON.stringify([a.worldId, a.engineEpoch, a.id, o.id]))
        .digest('hex'),
  }));
  const legacy: any = {
    schemaVersion: 1,
    id: a.id + ':decision',
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 0,
    inputHash: a.inputHash,
    evaluatedThroughVersion: original.observedThroughVersion,
    ...decoded,
  };
  await assert.rejects(
    directors.commit(f.owner, a, original, legacy),
    /DIRECTOR_OPPORTUNITY_BOUNDARY/,
  );
  await app.transaction(f.owner, async (sql) => {
    await sql.query(
      'INSERT INTO parallel_life.director_decisions(id,world_id,owner_id,attempt_id,engine_epoch,world_version,input_hash,evaluated_through_version,document)VALUES($1,$2,$3,$4,2,0,$5,$6,$7)',
      [legacy.id, f.id, f.owner, a.id, a.inputHash, legacy.evaluatedThroughVersion, legacy],
    );
    for (const o of legacy.opportunities) {
      const ep = {
        schemaVersion: 1,
        worldId: f.id,
        id: o.id,
        revision: 0,
        origin: { kind: 'director', sourceId: legacy.id },
        status: 'proposed',
        title: o.title,
        description: o.description,
        participantActorIds: o.participantActorIds,
        placeIds: o.placeIds,
        sourceEventIds: [],
        resultIds: [],
        unresolvedResponsibilityIds: [],
      };
      await sql.query(
        'INSERT INTO parallel_life.shared_episodes(world_id,owner_id,id,origin_decision_id,document)VALUES($1,$2,$3,$4,$5)',
        [f.id, f.owner, o.id, legacy.id, ep],
      );
    }
    await sql.query(
      "UPDATE parallel_life.director_runtime_attempts SET status='committed',decision_id=$2 WHERE id=$1",
      [a.id, legacy.id],
    );
    await createEpisodeRequestsInTransaction(sql, f.owner, {
      worldId: f.id,
      engineEpoch: 2,
      decision: legacy,
    });
  });
  const bad = legacy.opportunities.find((o: any) => o.authoredEventKey === 'b')!,
    good = legacy.opportunities.find((o: any) => o.authoredEventKey === 'a')!;
  const pending = await app.transaction(f.owner, (sql) =>
    readPendingEpisodeRequestsInTransaction(sql, f.owner, { worldId: f.id, engineEpoch: 2 }),
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.episodeId, good.id);
  const all = await admin.query(
    'SELECT id,actor_id,episode_id,status FROM parallel_life.agent_episode_requests WHERE world_id=$1',
    [f.id],
  );
  assert.equal(all.rowCount, 2);
  const badRequest = all.rows.find((r) => r.episode_id === bad.id)!;
  await app.transaction(f.owner, async (sql) => {
    const invalid = await readInvalidAuthoredEpisodeIds(sql, f.owner, {
      worldId: f.id,
      engineEpoch: 2,
    });
    assert.deepEqual([...invalid], [bad.id]);
    assert.equal(await hasPendingEpisodeWork(sql, f.owner, f.id, 2, badRequest.actor_id), false);
    assert.equal(await hasPendingEpisodeWork(sql, f.owner, f.id, 2), true);
    const badView = await readActorEpisodeIntentsInTransaction(
      sql,
      f.owner,
      { worldId: f.id, actorId: badRequest.actor_id, worldVersion: 0, storyAt: original.storyAt },
      [badRequest.id],
    );
    assert.equal(badView.has(badRequest.id), false);
    const goodView = await readActorEpisodeIntentsInTransaction(
      sql,
      f.owner,
      { worldId: f.id, actorId: pending[0]!.actorId, worldVersion: 0, storyAt: original.storyAt },
      [pending[0]!.id],
    );
    assert.ok(goodView.get(pending[0]!.id));
  });
  const current = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 0,
    candidates: [],
    blockers: [],
  });
  assert.deepEqual(
    current.deliberationWindow!.nodeKeys,
    ['c', 'd'],
    'invalid unperformed old proposal releases one finite, unassessed window',
  );
  assert.deepEqual(
    (
      await snapshots.read(f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: 0,
        candidates: [],
        blockers: [],
      })
    ).deliberationWindow,
    current.deliberationWindow,
  );
  const nextCatalog = directorWireCatalog(current),
    quietRaw = JSON.stringify({
      protocol: 'director-wire-v14',
      openingContext: null,
      authoredChoices: Object.fromEntries(
        nextCatalog.events.map((e) => [
          e.ref,
          { kind: 'defer', reason: '合成测试仅核验一次容量释放' },
        ]),
      ),
      candidates: [],
      opportunities: [],
      audit: { reason: 'No forced story output', sourceRefs: [] },
    });
  const nextClaim = {
    ...claim,
    id: randomUUID(),
    commandId: randomUUID(),
    inputHash: directorSnapshotInputHash(current),
    token: randomUUID(),
  };
  let next = (await directors.claim(f.owner, nextClaim, current)).attempt;
  next = await directors.mark(f.owner, next, 'request_sent');
  next = await directors.saveResponse(f.owner, next, quietRaw);
  await directors.commit(f.owner, next, current, parseDirectorDecision(current, quietRaw, next));
  const after = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 0,
    candidates: [],
    blockers: [],
  });
  assert.equal(after.evaluationCause, undefined);
  assert.equal(
    (await admin.query('SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1', [f.id]))
      .rowCount,
    0,
    'read filters never reserve or call an NPC',
  );
  assert.equal(
    (
      await admin.query(
        "SELECT 1 FROM parallel_life.agent_episode_requests WHERE world_id=$1 AND status='pending'",
        [f.id],
      )
    ).rowCount,
    2,
    'historical pending rows remain unchanged',
  );
  assert.equal(
    (await directors.readEpisodes(f.owner, f.id)).filter((e) => e.status === 'proposed').length,
    2,
    'no fake consumed/quiet/withdrawn episode',
  );
});
