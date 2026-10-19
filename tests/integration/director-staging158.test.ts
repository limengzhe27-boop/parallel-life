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
test('Director catalog staging crosses actual authored opportunity and independent NPC boundary', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_STAGING158_TEST_PORT ?? 55618));
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
    return { owner, id, world };
  }
  await t.test(
    'bound publication history reaches only its own NPC and retains source authentication through execution reads',
    async () => {
      const h = await fixture();
      const ownWorld = await worlds.get({ userId: h.owner }, h.id);
      for (const [i, actor] of ownWorld.actors.entries()) {
        const state = await app.transaction(
          h.owner,
          async (sql) =>
            (
              await sql.query(
                'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND actor_id=$2',
                [h.id, actor.id],
              )
            ).rows[0].document,
        );
        const { snapshot } = await readPrivateAgentSnapshot(
          app,
          h.owner,
          ownWorld,
          actor.id,
          null,
          ownWorld.time,
          state,
        );
        assert.ok(
          snapshot.observations.some(
            (o) => o.kind === 'speech' && o.text.includes('PRIVATE_GENESIS_HISTORY_' + i),
          ),
        );
        assert.ok(
          !snapshot.observations.some((o) => o.text.includes('PRIVATE_GENESIS_HISTORY_' + (1 - i))),
        );
        const own = ownWorld.messages.find((m) => m.actorId === actor.id)!;
        const foreign = ownWorld.messages.find((m) => m.actorId !== actor.id)!;
        const readState = structuredClone(state);
        readState.knowledgeSourceIds = ['message:' + own.id, 'message:' + foreign.id];
        const sources = await app.transaction(h.owner, (sql) =>
          readActorStrategyBasis(sql, h.owner, readState, ownWorld.version, ownWorld.time),
        );
        assert.ok(sources.some((s) => s.id === 'message:' + own.id && s.worldVersion === 0));
        assert.ok(!sources.some((s) => s.id === 'message:' + foreign.id));
        const forged = structuredClone(ownWorld);
        forged.messages.find((m) => m.id === own.id)!.text = 'FORGED_HISTORY_MUST_NOT_CROSS';
        const bad = await readPrivateAgentSnapshot(
          app,
          h.owner,
          forged,
          actor.id,
          null,
          ownWorld.time,
          state,
        );
        assert.ok(
          !bad.snapshot.observations.some((o) => o.text.includes('FORGED_HISTORY_MUST_NOT_CROSS')),
        );
      }
    },
  );
  const f = await fixture();
  const calls: { kind: string; payload: any; format: any }[] = [];
  const tasks = [
    'Consider asking about your own part of the opening arrangement. Actor A task.',
    'Consider asking whether the player wants to discuss your own request. Actor B task.',
  ];
  const model: TextModel = {
    async complete(messages, _signal, _tokens, format) {
      const p = JSON.parse(messages.find((message) => message.role === 'user')!.content);
      const kind = p.promptVersion.startsWith('director-') ? 'director' : 'npc';
      calls.push({ kind, payload: p, format });
      assert.equal(app.pool.totalCount, app.pool.idleCount, 'model must not hold a transaction');
      if (kind === 'director') {
        assert.equal(format?.format, 'json_schema');
        const event = p.wireCatalog.events.find(
          (entry: any) => entry.authoredEventKey === 'always',
        );
        return JSON.stringify({
          protocol: 'director-wire-v2',
          mode: 'bounded_opportunity',
          candidates: p.wireCatalog.candidates.map((entry: any) => ({
            ref: entry.ref,
            decision: 'defer',
            reason: 'Consider the independent opening first',
          })),
          opportunities: [
            {
              id: 'opening_staging',
              title: 'Optional opening',
              description: 'GLOBAL_DIRECTOR_ONLY_DESCRIPTION',
              playerImpact: 'GLOBAL_DIRECTOR_ONLY_IMPACT',
              actors: p.wireCatalog.actors.map((entry: any) => entry.ref),
              places: [],
              activity: 'conversation',
              origin: { kind: 'authored', eventRef: event.ref },
              stagingIntents: p.wireCatalog.actors.map((entry: any) => ({
                actorRef: entry.ref,
                kind: 'future_task',
                task: tasks[f.world.actors.findIndex((actor) => actor.id === entry.actorId)],
              })),
              actorTopics: null,
            },
          ],
          audit: { reason: 'GLOBAL_DIRECTOR_AUDIT', sourceRefs: [event.ref] },
        });
      }
      const at = f.world.actors.findIndex((actor) => actor.id === p.replyAs.actorId);
      assert.ok(at >= 0);
      const intent = p.observations.find((entry: any) =>
        p.sources.some(
          (source: any) => source.kind === 'director_intent' && source.id === entry.sourceId,
        ),
      );
      assert.ok(intent, 'No manual author hint grammar is needed for the actual NPC proposal');
      assert.equal(intent.kind, 'plan');
      assert.ok(intent.text.includes(tasks[at]!));
      assert.ok(!JSON.stringify(p).includes(tasks[1 - at]!));
      for (const secret of [
        'GLOBAL_DIRECTOR_ONLY_DESCRIPTION',
        'GLOBAL_DIRECTOR_ONLY_IMPACT',
        'GLOBAL_DIRECTOR_AUDIT',
        'AUTHOR_GLOBAL_MANUSCRIPT_NOT_FOR_NPC',
      ])
        assert.ok(!JSON.stringify(p).includes(secret));
      assert.ok(intent.text.includes('NOT a report, known fact'));
      const source = p.sources.find((entry: any) => entry.id === intent.sourceId);
      assert.equal(source.kind, 'director_intent');
      assert.equal(source.worldVersion, 0);
      assert.equal(p.worldContext.selfPosition.status, 'unknown');
      assert.ok(!p.sources.some((entry: any) => entry.id === 'actual-position:player'));
      return JSON.stringify({
        protocol: 'npc-wire-v9',
        executions: [],
        planIntents: [],
        inputInterpretation: null,
        agendaReview: null,
        focusChange: { kind: 'keep' },
        questionWithdrawals: null,
        locationReports: null,
        consideration: {
          choice: at === 0 ? 'quiet' : 'engage',
          reason: 'I independently want to consider my own task.',
          basisSourceIds: [intent.sourceId],
        },
        statements:
          at === 0
            ? []
            : [
                {
                  text: 'Would you like to discuss this? You may decline.',
                  dependsOnActionIds: [],
                },
              ],
        goals: [],
        responsibilities: [],
      });
    },
  };
  const service = npcAgentAdvanceServices(app, () => model, snapshots);
  await service.advanceIfEnabled(f.owner, f.id);
  const npc = calls.filter((call) => call.kind === 'npc');
  assert.equal(calls.filter((call) => call.kind === 'director').length, 1);
  assert.equal(npc.length, 2);
  const episodes = await directors.readEpisodes(f.owner, f.id);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.status, 'active');
  assert.deepEqual(episodes[0]!.resultIds, []);
  const receipts = (
    await admin.query('SELECT choice FROM parallel_life.agent_episode_receipts WHERE world_id=$1', [
      f.id,
    ])
  ).rows;
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.choice).sort(), ['engage', 'quiet']);
  const results = await admin.query(
    'SELECT 1 FROM parallel_life.agent_episode_outcomes WHERE world_id=$1',
    [f.id],
  );
  assert.equal(results.rowCount, 0);
  const facts = (await worlds.get({ userId: f.owner }, f.id)).facts;
  assert.ok(!JSON.stringify(facts).includes('Actor A task'));
  assert.ok(!JSON.stringify(facts).includes('Actor B task'));
  await t.test(
    'known late authored handoff revalidates at current CAS without repurchasing the Director; expired unknown stays fenced',
    async () => {
      const g = await fixture();
      const original = await snapshots.read(g.owner, {
        worldId: g.id,
        engineEpoch: 2,
        worldVersion: 0,
        candidates: [],
        blockers: [],
      });
      const claim = (s: DirectorSnapshot, duration = 120000) => ({
        id: randomUUID(),
        worldId: g.id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: s.worldVersion,
        inputHash: directorSnapshotInputHash(s),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + duration).toISOString(),
      });
      let first = (await directors.claim(g.owner, claim(original), original)).attempt;
      first = await directors.mark(g.owner, first, 'request_sent');
      const m = original.authoredMaterials!.materials.find((m) => m.ref.nodeKey === 'always')!;
      const raw = {
        mode: 'bounded_opportunity',
        selectedCandidateIds: [],
        deferred: [],
        nudges: [],
        opportunities: [
          {
            id: 'revalidated-opening',
            title: 'Original authored future opportunity',
            description: 'A future conversation, not an accomplished event.',
            playerImpact: 'Optional participation',
            participantActorIds: original.boundary.actorIds,
            placeIds: [],
            activity: 'conversation',
            authoredEventKey: 'always',
            basisSourceIds: ['authored:' + m.ref.nodeHash],
            stagingIntents: original.boundary.actorIds.map((actorId) => ({
              actorId,
              kind: 'future_task',
              task: 'Consider offering your own next step, if you wish.',
            })),
          },
        ],
        audit: {
          reason: 'Explicit synthetic late proposal',
          basisSourceIds: ['authored:' + m.ref.nodeHash],
        },
      };
      const privateModel: TextModel = {
        async complete() {
          return JSON.stringify({
            protocol: 'npc-wire-v1',
            consideration: null,
            statements: [{ text: 'I heard your question.', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      };
      const chat = npcAgentServices(app, () => privateModel);
      await chat.sendMessageIfEnabled(g.owner, {
        id: randomUUID(),
        worldId: g.id,
        actorId: g.world.actors[0]!.id,
        expectedVersion: 0,
        text: 'A real intervening player turn',
      });
      first = await directors.saveResponse(g.owner, first, JSON.stringify(raw));
      assert.equal(first.status, 'stale_discarded');
      await assert.rejects(
        app.transaction(g.owner, async (sql) => {
          await sql.query("SELECT set_config('app.director_handoff_revalidation',$1,true)", [
            first.id,
          ]);
          await sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET status='committed',decision_id=$2 WHERE id=$1",
            [first.id, randomUUID()],
          );
        }),
        /INVALID_DIRECTOR_TRANSITION/,
        'a session flag without an authenticated receipt cannot revive a discarded result',
      );

      const before = (
        await admin.query(
          'SELECT snapshot,response,response_hash,sent_at FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [first.id],
        )
      ).rows[0];
      const current = await snapshots.read(g.owner, {
        worldId: g.id,
        engineEpoch: 2,
        worldVersion: 1,
        candidates: [],
        blockers: [],
      });
      let unknown = (await directors.claim(g.owner, claim(current, 1400), current)).attempt;
      unknown = await directors.mark(g.owner, unknown, 'request_sent');
      unknown = await directors.mark(g.owner, unknown, 'unknown_after_send');
      // Same-frame unknown is never a retry grant, even if its lease later expires.
      assert.equal(await directors.revalidateKnownHandoff(g.owner, current), null);
      await chat.sendMessageIfEnabled(g.owner, {
        id: randomUUID(),
        worldId: g.id,
        actorId: g.world.actors[0]!.id,
        expectedVersion: 1,
        text: 'A second real player turn',
      });
      await new Promise((resolve) => setTimeout(resolve, 1450));
      const latest = await snapshots.read(g.owner, {
        worldId: g.id,
        engineEpoch: 2,
        worldVersion: 2,
        candidates: [],
        blockers: [],
      });
      const d = await directors.revalidateKnownHandoff(g.owner, latest);
      assert.ok(d);
      assert.equal(d.worldVersion, 0, 'assessed frame is immutable');
      assert.equal(d.id, parseDirectorDecision(original, JSON.stringify(raw), first).id);
      const receipt = (
        await admin.query(
          'SELECT * FROM parallel_life.director_handoff_revalidations WHERE world_id=$1',
          [g.id],
        )
      ).rows[0];
      assert.equal(receipt.assessed_version, 0);
      assert.equal(receipt.applied_version, 2);
      assert.deepEqual(receipt.superseded_unknown_ids, [unknown.id]);
      const after = (
        await admin.query(
          'SELECT snapshot,response,response_hash,sent_at FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [first.id],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      const u = (
        await admin.query(
          'SELECT status,response_hash,sent_at FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [unknown.id],
        )
      ).rows[0];
      assert.equal(u.status, 'stale_discarded');
      assert.equal(u.response_hash, null);
      assert.ok(u.sent_at);
      assert.equal(
        (await worlds.get({ userId: g.owner }, g.id)).version,
        2,
        'handoff executes no world actions',
      );
      assert.equal((await directors.readEpisodes(g.owner, g.id))[0]!.status, 'proposed');
      const requests = (
        await admin.query(
          'SELECT status,actor_id FROM parallel_life.agent_episode_requests WHERE world_id=$1',
          [g.id],
        )
      ).rows;
      assert.equal(requests.length, g.world.actors.length);
      assert.ok(requests.every((r) => r.status === 'pending'));
      assert.equal(
        await directors.revalidateKnownHandoff(
          g.owner,
          await snapshots.read(g.owner, {
            worldId: g.id,
            engineEpoch: 2,
            worldVersion: 2,
            candidates: [],
            blockers: [],
          }),
        ),
        null,
        'once-only known proposal application',
      );
      // The original normal dispatcher asks both independent actors; no Director model is called.
      let npcCalls = 0;
      const noDirector: TextModel = {
        async complete(messages) {
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          assert.ok(!p.promptVersion.startsWith('director-'));
          npcCalls++;
          const intent = p.observations.find((o: any) =>
            p.sources.some(
              (source: any) => source.kind === 'director_intent' && source.id === o.sourceId,
            ),
          );
          assert.ok(intent);
          return JSON.stringify({
            protocol: 'npc-wire-v9',
            executions: [],
            planIntents: [],
            inputInterpretation: null,
            agendaReview: null,
            focusChange: { kind: 'keep' },
            questionWithdrawals: null,
            locationReports: null,
            consideration: {
              choice: 'engage',
              reason: 'Own independent choice',
              basisSourceIds: [intent.sourceId],
            },
            statements: [{ text: 'My own optional next step.', dependsOnActionIds: [] }],
            goals: [],
            responsibilities: [],
          });
        },
      };
      const resume = npcAgentAdvanceServices(app, () => noDirector, snapshots, {
        maxActors: 2,
        maxModelCalls: 2,
      });
      await resume.advanceIfEnabled(g.owner, g.id);
      assert.equal(npcCalls, g.world.actors.length);
      assert.equal((await directors.readEpisodes(g.owner, g.id))[0]!.status, 'active');
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.agent_episode_outcomes WHERE world_id=$1',
            [g.id],
          )
        ).rowCount,
        0,
      );
    },
  );
});
