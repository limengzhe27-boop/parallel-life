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
test('v10 opening information commits authenticated private reports without external execution', async (t) => {
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
          : '我只知道自己的生活，不知道小店书友会的安排。',
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

  const f = await fixture({ emptyAgenda: true, multiActorOpening: true });
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
            premises: [
              {
                actorRef: p.wireCatalog.actors.find((a: any) => a.actorId === own.actorId).ref,
                kind: 'opening_information',
                field: 'script',
                quote: '小店老板收到店内书友会将在今晚开放的消息。',
                knowledge: {
                  module: 'lifeContext',
                  quote: '我是小店老板，负责接收店内书友会的消息。',
                },
              },
            ],
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
  const world = await worlds.get({ userId: f.owner }, f.id);
  assert.equal(world.version, 1);
  assert.deepEqual(world.actors, f.world.actors, 'no invented position or attitude');
  const packet = await app.transaction(f.owner, (sql) =>
    readActorNarrativeObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: own.actorId,
      worldVersion: 1,
      storyAt: s.storyAt,
    }),
  );
  assert.equal(packet.sources.length, 1);
  const outer = JSON.parse(packet.observations[0]!.text),
    report = JSON.parse(outer.text);
  assert.equal(report.assertion, 'report');
  assert.equal(report.executionEvidence, false);
  assert.equal(report.type, 'received_opening_information');
  assert.equal(outer.learnedAt, new Date(s.storyAt).toISOString());
  assert.ok(!JSON.stringify(packet).includes('definitionSourceId'));
  const other = world.actors.find((a) => a.id !== own.actorId)!;
  assert.ok(other);
  const absent = await app.transaction(f.owner, (sql) =>
    readActorNarrativeObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: other.id,
      worldVersion: 1,
      storyAt: s.storyAt,
    }),
  );
  assert.equal(absent.sources.length, 0);
  const ack = await app.transaction(f.owner, (sql) =>
    readConsumedSceneObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: own.actorId,
      engineEpoch: 2,
      worldVersion: 1,
    }),
  );
  assert.deepEqual(ack, [], 'Director receipt is not an NPC consumption ACK');
  const group = await app.transaction(f.owner, (sql) =>
    readActorObservationInbox(sql, f.owner, { channel: { kind: 'group' } } as any),
  );
  assert.equal(group.sources.length, 0, 'private report does not leak into group');
  const counts = await admin.query(
    'SELECT (SELECT count(*)::int FROM parallel_life.actor_narrative_knowledge WHERE world_id=$1) AS knowledge,(SELECT count(*)::int FROM parallel_life.opening_context_reviews WHERE world_id=$1) AS reviews',
    [f.id],
  );
  assert.deepEqual(counts.rows[0], { knowledge: 1, reviews: 1 });
  const again = await runDirectorAgent(deps, f.owner, input, s);
  assert.equal(again.id, d.id);
  assert.equal(calls, 1, 'original paid response reused');
  const next = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: 1,
    candidates: [],
    blockers: [],
  });
  assert.equal(next.openingContextAuthority, undefined, 'review cannot be rebought');
  const actors = new PostgresAgentRuntimeRepository(app);
  const state = (await actors.read(f.owner, { worldId: f.id, actorId: own.actorId }))!;
  const text = '可以说说你刚收到的消息吗？';
  const incoming = {
    id: randomUUID(),
    worldId: f.id,
    commandId: randomUUID(),
    inputHash: createHash('sha256').update(text).digest('hex'),
    channel: 'private' as const,
    threadId: own.actorId,
    recipientActorId: own.actorId,
    expectedWorldVersion: world.version,
    origin: 'player' as const,
    text,
    receivedAt: new Date().toISOString(),
    storyAt: s.storyAt,
  };
  await actors.accept(f.owner, incoming);
  const { snapshot } = await readPrivateAgentSnapshot(
    app,
    f.owner,
    world,
    own.actorId,
    incoming,
    s.storyAt,
    state,
  );
  assert.ok(snapshot.sources.some((x) => x.id === packet.sources[0]!.id));
  let attempt = (
    await actors.claim(f.owner, {
      id: randomUUID(),
      worldId: f.id,
      actorId: own.actorId,
      commandId: incoming.commandId,
      inputReceiptId: incoming.id,
      inputHash: incoming.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    })
  ).attempt;
  attempt = await actors.markRequestSentWithSources(f.owner, attempt, snapshot);
  await actors.saveResponse(f.owner, attempt, {
    kind: 'npc_agent_completion',
    schemaVersion: 1,
    snapshot,
    suppliedContext: {
      schemaVersion: 1,
      promptVersion: 'EXPLICIT_LOCAL_INFORMATION_FIXTURE',
      modelInputHash: 'b'.repeat(64),
      observations: packet.sources.map((x) => ({ sourceId: x.id, contentHash: x.contentHash })),
    },
    response: JSON.stringify({
      statements: [{ text: '我收到了书友会今晚开放的消息，想和你聊聊。', dependsOnActionIds: [] }],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    }),
  });
  const ops = new AdvanceOperationRepository(app),
    opid = randomUUID();
  await ops.start(f.owner, f.id, opid);
  await ops.track(f.owner, f.id, opid, { kind: 'npc', commandId: incoming.commandId });
  await ops.finish(
    f.owner,
    f.id,
    opid,
    undefined,
    Error('Controlled saved response before commit'),
  );
  const recover = agentAdvanceOperations(app, async () => {
    throw Error('NO_NEW_MODEL_OR_SELECTION');
  });
  assert.equal((await recover.perform(f.owner, f.id, opid, 'recover')).status, 'complete');
  const after = await worlds.get({ userId: f.owner }, f.id);
  const consumed = await app.transaction(f.owner, (sql) =>
    readConsumedSceneObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: own.actorId,
      engineEpoch: 2,
      worldVersion: after.version,
    }),
  );
  assert.ok(
    consumed.some((x) => x.sourceId === packet.sources[0]!.id),
    'only actual supplied committed NPC response acknowledges',
  );
  const batchWorld = await fixture({ multiActorOpening: true });
  let directorCalls = 0,
    npcCalls = 0;
  let npcPayload: any;
  const batchModel = {
    async complete(messages: any[]) {
      const p = JSON.parse(messages[1].content);
      if (p.promptVersion.startsWith('director-')) {
        directorCalls++;
        const authority = p.openingContextAuthority;
        const knowledge = authority.actorKnowledge.find(
          (a: any) => a.actorId === batchWorld.world.actors[0]!.id,
        );
        const actor = p.wireCatalog.actors.find((a: any) => a.actorId === knowledge.actorId);
        return JSON.stringify({
          protocol: 'director-wire-v10',
          candidates: p.wireCatalog.candidates.map((c: any) => ({
            ref: c.ref,
            decision: 'defer',
            reason: 'Consider received information first',
          })),
          authoredChoices: Object.fromEntries(
            p.wireCatalog.events.map((e: any) => [
              e.ref,
              {
                kind: 'consider',
                opportunity: {
                  title: 'Book club information',
                  description: 'An optional invitation based on received information',
                  playerImpact: 'Free to respond',
                  places: [],
                  activity: 'conversation',
                  actorTasks: Object.fromEntries(
                    p.wireCatalog.actors.map((a: any) => [
                      a.ref,
                      a.ref === actor.ref
                        ? {
                            topic: 'Book club information',
                            personalObjective: 'Discuss whether to attend together',
                            proposedInteraction:
                              'Share the received report and offer an optional invitation',
                          }
                        : null,
                    ]),
                  ),
                },
              },
            ]),
          ),
          opportunities: [],
          audit: { reason: 'Bounded information and optional participation', sourceRefs: [] },
          openingContext: {
            disposition: 'confirm',
            reason: 'Explicit own information receipt',
            premises: [
              {
                actorRef: actor.ref,
                kind: 'opening_information',
                field: 'script',
                quote: authority.sourceExcerpt,
                knowledge: { module: 'lifeContext', quote: knowledge.modules.lifeContext },
              },
            ],
          },
        });
      }
      npcCalls++;
      npcPayload = p;
      return JSON.stringify({
        protocol: 'npc-wire-v12',
        statements: [
          {
            text: 'I received news about the book club tonight. Would you like to discuss going?',
            dependsOnActionIds: [],
          },
        ],
        executions: [],
        planIntents: [],
        goals: [],
        responsibilities: [],
        agendaReview: null,
        inputInterpretation: null,
        focusChange: { kind: 'keep' },
        continuation: {
          decision: 'no_current_intent',
          reason: 'Shared the optional information; no further action now',
          sourceIds: [p.input.sourceId],
          planIds: [],
          questionIds: [],
          conditions: [],
        },
        questionWithdrawals: null,
        locationReports: null,
        consideration: {
          choice: 'engage',
          reason: 'I want to share the received information',
          basisSourceIds: [p.input.sourceId],
          followUp: null,
        },
      });
    },
  };
  const batched = npcAgentAdvanceServices(app, () => batchModel, snapshots, {
    maxActors: 1,
    maxModelCalls: 3,
    maxSteps: 8,
  });
  await batched.advanceIfEnabled(batchWorld.owner, batchWorld.id);
  assert.equal(
    npcPayload?.worldVersion,
    1,
    JSON.stringify({ keys: Object.keys(npcPayload ?? {}), version: npcPayload?.worldVersion }),
  );
  assert.ok(
    JSON.stringify(npcPayload.presentationContext.internalContext).includes(
      'received_opening_information',
    ),
  );
  assert.ok(!JSON.stringify(npcPayload.observations).includes('received_opening_information'));
  assert.equal(directorCalls, 1);
  assert.equal(npcCalls, 1, 'same batch reaches participant after information commit');
  const bw = await worlds.get({ userId: batchWorld.owner }, batchWorld.id);
  const knowledge = (
    await admin.query(
      'SELECT actor_id,id FROM parallel_life.actor_narrative_knowledge WHERE world_id=$1',
      [bw.id],
    )
  ).rows[0];
  const batchAck = await app.transaction(batchWorld.owner, (sql) =>
    readConsumedSceneObservationSourcesInTransaction(sql, batchWorld.owner, {
      worldId: bw.id,
      actorId: knowledge.actor_id,
      engineEpoch: 2,
      worldVersion: bw.version,
    }),
  );
  assert.ok(
    batchAck.some((x) => x.sourceId === 'narrative:' + knowledge.id),
    JSON.stringify(
      (
        await admin.query(
          "SELECT status, response->'suppliedContext' AS supplied FROM parallel_life.agent_attempts WHERE world_id=$1",
          [bw.id],
        )
      ).rows,
    ),
  );
  const latestState = (await actors.read(batchWorld.owner, {
    worldId: bw.id,
    actorId: knowledge.actor_id,
  }))!;
  const recallText = 'Tell me again what you know about tonight';
  const recallInput = {
    id: randomUUID(),
    worldId: bw.id,
    commandId: randomUUID(),
    inputHash: createHash('sha256').update(recallText).digest('hex'),
    channel: 'private' as const,
    threadId: knowledge.actor_id,
    recipientActorId: knowledge.actor_id,
    expectedWorldVersion: bw.version,
    origin: 'player' as const,
    text: recallText,
    receivedAt: new Date().toISOString(),
    storyAt: bw.time,
  };
  await actors.accept(batchWorld.owner, recallInput);
  const recalled = (
    await readPrivateAgentSnapshot(
      app,
      batchWorld.owner,
      bw,
      knowledge.actor_id,
      recallInput,
      bw.time,
      latestState,
    )
  ).snapshot;
  const knownSource = 'narrative:' + knowledge.id;
  assert.ok(
    recalled.observations.some(
      (o) => o.sourceId === knownSource && o.text.includes('received_opening_information'),
    ),
  );
  assert.ok(
    !recalled.actorObservationInbox?.sourceIds.includes(knownSource),
    'ACKed knowledge does not become a fresh inbox wake',
  );
  await app.transaction(batchWorld.owner, (sql) =>
    validateActorObservationInbox(sql, batchWorld.owner, recalled),
  );
  const changed = structuredClone(recalled);
  changed.observations.find((o) => o.sourceId === knownSource)!.text = 'forged private fact';
  await assert.rejects(
    app.transaction(batchWorld.owner, (sql) =>
      validateActorObservationInbox(sql, batchWorld.owner, changed),
    ),
    /ACTOR_NARRATIVE_RECALL_CONFLICT/,
  );
  const changedSource = structuredClone(recalled);
  changedSource.sources.find((o) => o.id === knownSource)!.contentHash = 'a'.repeat(64);
  await assert.rejects(
    app.transaction(batchWorld.owner, (sql) =>
      validateActorObservationInbox(sql, batchWorld.owner, changedSource),
    ),
    /ACTOR_NARRATIVE_RECALL_CONFLICT/,
  );
});
