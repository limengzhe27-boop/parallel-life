import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { createHash } from 'node:crypto';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { AdvanceOperationRepository } from '../../src/modules/world/infrastructure/advance-operation-repository.ts';
import { agentAdvanceOperations } from '../../src/server/agent-advance-operations.ts';
import { readActorNarrativeObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-narrative-observation-sources.ts';
import {
  readActorObservationInbox,
  validateActorObservationInbox,
} from '../../src/modules/world/infrastructure/actor-observation-inbox.ts';
import { readConsumedSceneObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-observation-consumption-repository.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { migrateLegacyWorldInTransaction } from '../../src/modules/world/infrastructure/legacy-world-migration.ts';
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
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
test('private opening observations run ahead of mixed shared-episode coordination', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.OPENING_INFORMATION_TEST_PORT ?? 55587));
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
    editorialIntent: '只可考虑，不代表发生。',
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
    node('always'),
    node('a', [{ kind: 'not_before', at: time(10) }], {
      timeline: {
        stageKey: 'day',
        window: { notBefore: time(10), expiresAt: time(11) },
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    }),
    node('b', [{ kind: 'not_before', at: time(12) }]),
  ];
  base.openingEventKey = 'always';
  base.candidates = [base.candidates[0]];
  base.candidates[0].script = '小店老板收到店内书友会将在今晚开放的消息。';
  base.actors.forEach((a: any, index: number) => {
    a.lifeModules = {
      lifeContext:
        index === 0
          ? '我是小店老板，负责接收店内书友会的消息。'
          : '我是小店老板，负责接收店内书友会的消息。',
    };
  });
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
    options: {
      admit?: boolean;
      proof?: boolean;
      multi?: boolean;
      legacy?: boolean;
      emptyAgenda?: boolean;
      multiActorOpening?: boolean;
    } = {},
  ) {
    const content = structuredClone(base);
    if (options.multiActorOpening)
      content.candidates[0].actorKeys = content.actors.map((a: any) => a.key);
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
    // These older semantic-wake scenarios start with an existing character agenda.
    // No invented execution/history: an active definition-based intention, with no action or result.
    // Explicit emptyAgenda fixtures below retain the real cold-start initialization path.
    if (!options.emptyAgenda)
      await app.transaction(owner, async (sql) => {
        for (const actor of world.actors) {
          const source = `definition:${agentDefinitionRef(world, actor.id)}`;
          await sql.query(
            `UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{goals}',$3::jsonb)
            WHERE world_id=$1 AND owner_id=$2 AND actor_id=$4`,
            [
              id,
              owner,
              JSON.stringify([
                {
                  id: `fixture-existing-agenda:${actor.id}`,
                  summary: 'PRIVATE_OWN_AGENDA_' + actor.id,
                  status: 'active',
                  sourceIds: [source],
                  resultIds: [],
                },
              ]),
              actor.id,
            ],
          );
        }
      });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }

  const f = await fixture({ multiActorOpening: true });
  const s = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 0,
    candidates: [],
    blockers: [],
  });
  assert.ok(s.openingContextAuthority);
  const own = s.openingContextAuthority.actorKnowledge.find((a) =>
    a.modules.lifeContext?.startsWith('我是小店老板'),
  )!;
  assert.ok(own);
  let calls = 0;
  const deps = {
    attempts: directors,
    parse: parseDirectorDecision,
    model: new WorldDirectorAgentModel({
      async complete(messages) {
        calls++;
        const p = JSON.parse(messages[1]!.content);
        return JSON.stringify({
          protocol: 'director-wire-v10',
          candidates: [],
          authoredChoices: Object.fromEntries(
            p.wireCatalog.events.map((e: any) => [
              e.ref,
              { kind: 'defer', reason: '先确认本人收到的开场信息，不宣称外部结果' },
            ]),
          ),
          opportunities: [],
          audit: { reason: 'private opening information', sourceRefs: [] },
          openingContext: {
            disposition: 'confirm',
            reason: '作者原文及本人模块明确授权收到消息',
            premises: s.openingContextAuthority!.actorKnowledge.map((knowledge: any) => ({
              actorRef: p.wireCatalog.actors.find((a: any) => a.actorId === knowledge.actorId).ref,
              kind: 'opening_information',
              field: 'script',
              quote: '小店老板收到店内书友会将在今晚开放的消息。',
              knowledge: {
                module: 'lifeContext',
                quote: '我是小店老板，负责接收店内书友会的消息。',
              },
            })),
          },
        });
      },
    }),
  };
  const input = {
    id: randomUUID(),
    worldId: f.id,
    commandId: randomUUID(),
    engineEpoch: 2,
    expectedWorldVersion: 0,
    inputHash: directorSnapshotInputHash(s),
    token: randomUUID(),
    leaseUntil: new Date(Date.now() + 120000).toISOString(),
  };
  const d = await runDirectorAgent(deps, f.owner, input, s);
  assert.equal(calls, 1);

  // Both actors have an existing responsibility for the same episode. These compete
  // for global coordination, unlike each actor's independently received report.
  await app.transaction(f.owner, async (sql) => {
    for (const actor of f.world.actors) {
      const source = `definition:${agentDefinitionRef(f.world, actor.id)}`;
      await sql.query(
        "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{responsibilities}',$3::jsonb) WHERE world_id=$1 AND actor_id=$2",
        [
          f.id,
          actor.id,
          JSON.stringify([
            {
              id: 'shared-duty',
              subject: { kind: 'episode', id: 'shared-episode' },
              summary: 'Consider shared arrangement',
              status: 'open',
              waitingOn: 'self',
              sourceIds: [source],
              nextCheck: [{ kind: 'observation', sourceId: source }],
            },
          ]),
        ],
      );
    }
  });
  const currentWorld = await worlds.get({ userId: f.owner }, f.id);
  const actorViews = await Promise.all(
    currentWorld.actors.map(async (actor) => ({
      snapshot: (
        await readPrivateAgentSnapshot(
          app,
          f.owner,
          currentWorld,
          actor.id,
          null,
          currentWorld.time,
          await new PostgresAgentRuntimeRepository(app).read(f.owner, {
            worldId: f.id,
            actorId: actor.id,
          }),
        )
      ).snapshot,
      trustedResults: [],
      appointments: [],
    })),
  );
  const originalSources = createAgentScheduleSources({
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 1,
    storyAt: currentWorld.time,
    actors: actorViews,
    activeAttempts: [],
    consumedCandidateIds: [],
  });
  const collections = await Promise.all(
    originalSources.map((r) => r.source.collect(f.owner, f.id)),
  );
  const shared = collections
    .flatMap((r) => r.candidates)
    .filter((c) => c.source === 'responsibility' && c.episodeId === 'shared-episode');
  assert.equal(
    shared.length,
    currentWorld.actors.length,
    'real collectors expose competing shared episode work',
  );
  let directorCalls = 0,
    npcCalls = 0;
  const model = {
    async complete(messages: any[]) {
      const p = JSON.parse(messages[1].content);
      if (p.promptVersion.startsWith('director-')) {
        directorCalls++;
        throw Error('UNEXPECTED_DIRECTOR_FOR_INDEPENDENT_PACKET');
      }
      npcCalls++;
      assert.ok(
        JSON.stringify(p.presentationContext.internalContext).includes(
          'received_opening_information',
        ),
      );
      return JSON.stringify({
        protocol: 'npc-wire-v12',
        statements: [],
        executions: [],
        planIntents: [],
        goals: [],
        responsibilities: [],
        agendaReview: null,
        inputInterpretation: null,
        focusChange: { kind: 'keep' },
        continuation: {
          decision: 'no_current_intent',
          reason: 'I have considered this information and choose quiet',
          sourceIds: [p.input.sourceId],
          planIds: [],
          questionIds: [],
          conditions: [],
        },
        questionWithdrawals: null,
        locationReports: null,
        consideration: null,
      });
    },
  };
  const services = npcAgentAdvanceServices(app, () => model, snapshots, {
    maxActors: 2,
    maxModelCalls: 1,
    maxSteps: 4,
  });
  const protectedFrame = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 1,
    candidates: [],
    blockers: [],
  });
  const protectedClaim = await directors.claim(
    f.owner,
    {
      id: randomUUID(),
      worldId: f.id,
      commandId: randomUUID(),
      engineEpoch: 2,
      expectedWorldVersion: 1,
      inputHash: directorSnapshotInputHash(protectedFrame),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    },
    protectedFrame,
  );
  try {
    await services.advanceIfEnabled(f.owner, f.id);
  } catch (error) {
    assert.ok(['BUSY', 'DIRECTOR_ATTEMPT_PENDING'].includes((error as { code: string }).code));
  }
  assert.equal(npcCalls, 0, 'protected pending Director frame must not be bypassed');
  assert.equal(directorCalls, 0, 'pending request must not be repurchased');
  await directors.mark(f.owner, protectedClaim.attempt, 'cancelled_before_send');
  // Deterministic preflight rejection uses the real runner's claim/cancel path.
  // It is not a provider failure and must not prevent another actor's legal work.
  const originalValidate = NpcAgentModel.prototype.validateInput;
  let rejectedActor: string | undefined;
  let rejectedCalls = 0;
  NpcAgentModel.prototype.validateInput = function (snapshot) {
    rejectedActor ??= snapshot.state.actorId;
    if (snapshot.state.actorId === rejectedActor) {
      rejectedCalls++;
      throw Object.assign(Error('NPC_AGENT_SNAPSHOT_LIMIT'), { code: 'NPC_AGENT_SNAPSHOT_LIMIT' });
    }
    return originalValidate.call(this, snapshot);
  };
  try {
    await services.advanceIfEnabled(f.owner, f.id);
  } finally {
    NpcAgentModel.prototype.validateInput = originalValidate;
  }
  assert.equal(rejectedCalls, 1, 'batch never retries the rejected actor');
  const zeroSend = (
    await admin.query(
      'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1',
      [f.id, rejectedActor],
    )
  ).rows[0];
  assert.equal(zeroSend.status, 'cancelled_before_send');
  for (const key of ['sent_at', 'response', 'response_hash', 'event_id'])
    assert.equal(zeroSend[key], null);

  assert.equal(npcCalls, 1);
  assert.equal(directorCalls, 0);
  async function pending() {
    let count = 0;
    const w = await worlds.get({ userId: f.owner }, f.id);
    for (const actor of w.actors) {
      const snap = (
        await readPrivateAgentSnapshot(
          app,
          f.owner,
          w,
          actor.id,
          null,
          w.time,
          await new PostgresAgentRuntimeRepository(app).read(f.owner, {
            worldId: f.id,
            actorId: actor.id,
          }),
        )
      ).snapshot;
      count += snap.actorObservationInbox?.narrativeKnowledgeIds?.length ?? 0;
    }
    return count;
  }
  assert.equal(
    await pending(),
    f.world.actors.length - 1,
    'only processed actor ACKs; other packets remain',
  );
  await services.advanceIfEnabled(f.owner, f.id);
  assert.equal(npcCalls, 2);
  assert.equal(directorCalls, 0);
  assert.equal(await pending(), f.world.actors.length - 2);
  assert.deepEqual(
    (await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1', [zeroSend.id]))
      .rows[0],
    zeroSend,
    'later frame recovery preserves old zero-send receipt',
  );
  const rows = (
    await admin.query(
      "SELECT actor_id,count(*)::int AS n FROM parallel_life.agent_attempts WHERE world_id=$1 AND status='committed' GROUP BY actor_id",
      [f.id],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((r) => r.n === 1),
    'second batch must not re-buy the first actor observation',
  );
});
