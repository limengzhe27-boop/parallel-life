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
import { WorldDirectorAgentModel } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
test('actual publication semantic wake advances use one protected Director boundary', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_SEMANTIC_WAKE_TEST_PORT ?? 55505));
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
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function at(f: Fixture, storyNow: string) {
    const clock = await clocks.read(f.owner, f.id);
    await clocks.write(f.owner, f.id, {
      ...clock,
      storyNow,
      paused: false,
      speed: 0,
      lastTickAt: new Date().toISOString(),
    });
  }
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
  const q = (s: DirectorSnapshot, key: string) => {
    const r = s.authoredEligibility!.find((e) => e.nodeKey === key);
    assert.ok(r);
    return r;
  };
  const causeKeys = (s: { evaluationCause?: DirectorSnapshot['evaluationCause'] }) =>
    s.evaluationCause?.kind === 'authored_eligibility'
      ? s.evaluationCause.qualifications.map((q) => q.nodeKey)
      : [];
  const quiet = () => ({
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: 'EXPLICIT_LOCAL_QUIET', basisSourceIds: [] },
  });
  const claim = (s: DirectorSnapshot) => ({
    id: randomUUID(),
    worldId: s.worldId,
    commandId: randomUUID(),
    engineEpoch: s.engineEpoch,
    expectedWorldVersion: s.worldVersion,
    inputHash: directorSnapshotInputHash(s),
    token: randomUUID(),
    leaseUntil: new Date(Date.now() + 120000).toISOString(),
  });
  async function attempts(f: Fixture) {
    return (
      await admin.query(
        'SELECT * FROM parallel_life.director_runtime_attempts WHERE world_id=$1 ORDER BY created_at,id',
        [f.id],
      )
    ).rows;
  }
  async function frozen(f: Fixture) {
    const out: Record<string, unknown> = {};
    for (const table of [
      'worlds',
      'world_events',
      'commands',
      'world_messages',
      'director_runtime_attempts',
      'director_decisions',
      'shared_episodes',
      'actor_agent_states',
      'agent_episode_requests',
      'agent_episode_receipts',
    ])
      out[table] = (
        await admin.query(
          `SELECT to_jsonb(t) r FROM parallel_life.${table} t WHERE ${table === 'worlds' ? 'id' : 'world_id'}=$1 ORDER BY to_jsonb(t)::text`,
          [f.id],
        )
      ).rows;
    return out;
  }
  function harness(
    f: Fixture,
    options: {
      response?: (p: any, index: number) => Promise<string> | string;
      propose?: string;
      npcChoice?: 'quiet' | 'engage';
      wire?: boolean;
    } = {},
  ) {
    const calls: { kind: 'director' | 'npc'; payload: any }[] = [];
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content),
          kind = p.promptVersion.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload: p });
        assert.equal(
          app.pool.totalCount,
          app.pool.idleCount,
          'model must not hold app transaction',
        );
        if (kind === 'npc') {
          const intent = JSON.parse(p.input.text);
          assert.equal(intent.type, 'npc_episode_consideration');
          return JSON.stringify({
            statements:
              options.npcChoice === 'engage'
                ? [{ text: '我愿意考虑参加，尚未完成事件。', dependsOnActionIds: [] }]
                : [],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
            episodeDecision: {
              requestId: intent.requestId,
              choice: options.npcChoice ?? 'quiet',
              reason: '自己的合成安排。',
              sourceIds: [p.input.sourceId, `definition:${p.state.definitionRef}`],
            },
          });
        }
        if (p.evaluationCause?.kind === 'authored_eligibility')
          for (const v of p.evaluationCause.qualifications) {
            assert.deepEqual(
              Object.keys(v).sort(),
              ['nodeKey', 'nodeHash', 'qualificationKey'].sort(),
            );
            const actual = p.authoredEligibility.find((e: any) => e.nodeKey === v.nodeKey);
            assert.equal(actual.status, 'eligible');
            assert.equal(actual.nodeHash, v.nodeHash);
            assert.equal(actual.qualificationKey, v.qualificationKey);
            assert.equal(p.occupiedAuthoredEventKeys.includes(v.nodeKey), false);
          }
        if (options.response)
          return options.response(p, calls.filter((c) => c.kind === 'director').length);
        if (options.propose && calls.filter((c) => c.kind === 'director').length === 1) {
          const m = p.authoredMaterials.materials.find(
            (m: any) => m.ref.nodeKey === options.propose,
          );
          if (options.wire) {
            const event = p.wireCatalog.events.find(
              (e: any) => e.authoredEventKey === options.propose,
            );
            const actor = p.wireCatalog.actors.find(
              (a: any) => a.actorId === f.world.actors[0]!.id,
            );
            return JSON.stringify({
              protocol: 'director-wire-v1',
              mode: 'bounded_opportunity',
              candidates: p.wireCatalog.candidates.map((c: any) => ({
                ref: c.ref,
                decision: 'defer',
                reason: '先考虑此机会',
              })),
              opportunities: [
                {
                  id: randomUUID(),
                  title: '可选分工',
                  description: '邀请本人考虑，不是命令',
                  playerImpact: '允许拒绝或暂缓',
                  actors: [actor.ref],
                  places: [],
                  activity: 'conversation',
                  origin: { kind: 'authored', eventRef: event.ref },
                },
              ],
              audit: { reason: '实际现状允许考虑作者机会', sourceRefs: [event.ref] },
            });
          }
          return JSON.stringify({
            ...quiet(),
            mode: 'bounded_opportunity',
            opportunities: [
              {
                id: randomUUID(),
                title: '合成可选机会',
                description: '只是拟议机会',
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
  async function bootstrap(f: Fixture) {
    const h = harness(f);
    await h.advance();
    assert.equal(h.director().length, 1);
    assert.equal(h.director()[0]!.payload.evaluationCause.kind, 'bootstrap');
    return h;
  }
  await t.test(
    'real new player evidence repairs one speech-blind quiet assessment without replaying the opening or polling models',
    async () => {
      const f = await fixture({ legacy: true });
      const originalRead = snapshots.read.bind(snapshots);
      snapshots.read = async (...args: Parameters<typeof snapshots.read>) => {
        const value = await originalRead(...args);
        return { ...value, observations: value.observations.filter((o) => o.kind !== 'speech') };
      };
      const h = harness(f);
      try {
        await h.advance();
      } finally {
        snapshots.read = originalRead;
      }
      const prior = (await attempts(f))[0]!;
      assert.equal(prior.status, 'committed');
      assert.equal((await wake(f)).cause, null, 'no new evidence means no paid reassessment');
      const actorId = f.world.actors[0]!.id;
      const svc = npcAgentServices(app, () => ({
        async complete() {
          return JSON.stringify({
            statements: [{ text: '收到，先聊聊具体安排。', dependsOnActionIds: [] }],
            goals: [],
            plans: [],
            actions: [],
            responsibilities: [],
            decisions: [],
          });
        },
      }));
      async function reply() {
        const w = await worlds.get({ userId: f.owner }, f.id);
        await svc.sendMessageIfEnabled(f.owner, {
          id: randomUUID(),
          worldId: f.id,
          actorId,
          expectedVersion: w.version,
          text: '我想问问当前有什么安排。',
        });
      }
      await reply();
      const next = await wake(f);
      assert.equal(next.cause?.kind, 'authored_eligibility');
      assert.deepEqual(await wake(f), next, 'read/refresh does not change evidence identity');
      const repaired = await snap(f);
      assert.ok(
        repaired.observations.some((o) => o.kind === 'speech' && o.sourceId.startsWith('message:')),
      );
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.equal(
        (await wake(f)).cause,
        null,
        'new quiet includes the evidence and consumes that context',
      );
      await reply();
      assert.equal(
        (await wake(f)).cause,
        null,
        'same actor ordinary chatter cannot repeatedly buy review',
      );
      assert.equal((await attempts(f))[0]!.id, prior.id, 'old paid decision preserved');
    },
  );

  await t.test(
    'existing migrated phone entry resumes unreviewed author material without replaying genesis or charging on read',
    async () => {
      const f = await fixture({ legacy: true });
      const client = randomUUID();
      await activity.update(f.owner, f.id, { clientId: client, sequence: 0, mode: 'browsing' });
      const probe = () =>
        app.transaction(f.owner, (sql) =>
          readAgentPhoneEntryProbe(sql, f.owner, {
            worldId: f.id,
            engineEpoch: 2,
            worldVersion: 0,
            storyAt: time(9),
          }),
        );
      const first = await probe();
      assert.equal(first.status, 'ready');
      assert.deepEqual(await probe(), first);
      assert.equal((await attempts(f)).length, 0);
      const h = harness(f, { propose: 'always', npcChoice: 'engage', wire: true });
      await h.advance();
      assert.equal(h.director()[0]!.payload.evaluationCause.kind, 'authored_eligibility');
      assert.deepEqual(
        h.calls.map((c) => c.kind),
        ['director', 'npc'],
      );
      const w = await worlds.get({ userId: f.owner }, f.id);
      assert.ok(w.messages.some((m) => m.role === 'assistant'));
      const after = await app.transaction(f.owner, (sql) =>
        readAgentPhoneEntryProbe(sql, f.owner, {
          worldId: f.id,
          engineEpoch: 2,
          worldVersion: w.version,
          storyAt: time(9),
        }),
      );
      assert.equal(after.status, 'quiet');
    },
  );
  await t.test(
    'typed model event reference uses the real advance, independent NPC and transactional episode path',
    async () => {
      const f = await fixture(),
        h = harness(f, { propose: 'always', npcChoice: 'engage', wire: true });
      await h.advance();
      assert.deepEqual(
        h.calls.map((c) => c.kind),
        ['director', 'npc'],
      );
      const episodes = await directors.readEpisodes(f.owner, f.id);
      assert.equal(episodes.length, 1);
      assert.equal(episodes[0]!.status, 'active');
      assert.equal((await attempts(f))[0]!.status, 'committed');
      const outcomes = await admin.query(
        'SELECT 1 FROM parallel_life.agent_episode_outcomes WHERE world_id=$1',
        [f.id],
      );
      assert.equal(
        outcomes.rowCount,
        0,
        'considering an opportunity cannot fabricate a final result',
      );
    },
  );
  await t.test(
    'actual bootstrap quiet and natural authored time transitions each purchase once at worldVersion zero',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f),
        initial = await attempts(f);
      assert.equal(initial.length, 1);
      assert.equal(initial[0].status, 'committed');
      assert.equal(initial[0].snapshot.authoredMaterials.source.origin.publicationVersion, 1);
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await wake(f)).cause, null);
      await at(f, time(10));
      const s = await snap(f);
      assert.equal(q(s, 'a').status, 'eligible');
      assert.deepEqual(causeKeys(s), ['a']);
      const id = s.evaluationCause!.id;
      await at(f, time(10, 0, 2));
      assert.equal((await snap(f)).evaluationCause!.id, id);
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.deepEqual(
        h.director()[1]!.payload.evaluationCause.qualifications,
        s.evaluationCause!.kind === 'authored_eligibility' ? s.evaluationCause!.qualifications : [],
      );
      await at(f, time(10, 15));
      await h.advance();
      assert.equal(h.director().length, 2);
      await at(f, time(11, 30));
      assert.equal(q(await snap(f), 'a').status, 'expired');
      await h.advance();
      assert.equal(h.director().length, 2);
      await at(f, time(12));
      assert.deepEqual(causeKeys(await snap(f)), ['b']);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 3);
      assert.deepEqual(
        (await attempts(f)).map((a) => a.snapshot.evaluationCause.kind),
        ['bootstrap', 'authored_eligibility', 'authored_eligibility'],
      );
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'multiple newly eligible qualifications use stable byte ordering through actual snapshot and one model call',
    async () => {
      const f = await fixture({ multi: true }),
        h = await bootstrap(f);
      await at(f, time(10));
      const s = await snap(f);
      assert.deepEqual(causeKeys(s), ['a', 'a_b', 'aa']);
      const id = s.evaluationCause!.id;
      await at(f, time(10, 0, 3));
      assert.equal((await snap(f)).evaluationCause!.id, id);
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.deepEqual(causeKeys(h.director()[1]!.payload), ['a', 'a_b', 'aa']);
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.equal((await wake(f)).cause, null);
    },
  );
  await t.test(
    'unrelated world version is not a fresh authored qualification or a new author time call',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f);
      await at(f, time(10));
      await h.advance();
      const old = q(await snap(f), 'a').qualificationKey;
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: '独立真实便签',
          text: '非作者资格来源',
        },
      );
      const s = await snap(f);
      assert.equal(s.worldVersion, 1);
      assert.equal(q(s, 'a').qualificationKey, old);
      assert.equal(s.evaluationCause, undefined);
      await h.advance();
      await at(f, time(10, 0, 5));
      await h.advance();
      assert.equal(h.director().length, 2);
    },
  );
  await t.test(
    'all historical captured qualifications suppress old fallback after a genuinely new related position proof and set changes',
    async () => {
      const f = await fixture({ proof: true }),
        h = await bootstrap(f),
        original = q(await snap(f), 'fallback').qualificationKey;
      let map = await space.read(f.owner, f.id);
      await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        routeId: map.routes[0]!.id,
      });
      const away = await snap(f),
        newKey = q(away, 'fallback').qualificationKey;
      assert.notEqual(newKey, original);
      assert.deepEqual(causeKeys(away), ['fallback']);
      await h.advance();
      assert.equal(h.director().length, 2);
      const middle = (await attempts(f)).at(-1)!;
      assert.equal(q(middle.snapshot, 'fallback').qualificationKey, newKey);
      map = await space.read(f.owner, f.id);
      await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        routeId: map.routes[0]!.id,
      });
      const returned = await snap(f);
      assert.equal(q(returned, 'fallback').qualificationKey, original);
      assert.equal(
        (await wake(f)).cause,
        null,
        'older bootstrap, not latest committed key, consumes fallback',
      );
      await h.advance();
      const n = h.director().length;
      assert.equal(
        h.director().at(-1)!.payload.evaluationCause,
        undefined,
        'ordinary travel may require global evaluation but cannot reclassify old qualification',
      );
      await h.advance();
      await at(f, time(9, 30));
      await h.advance();
      assert.equal(h.director().length, n);
    },
  );
  await t.test(
    'a genuine ordinary global evaluation captures eligible author qualifications without an authored wake cause',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f),
        client = randomUUID();
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 0,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.world.actors[0]!.id },
      });
      await at(f, time(10));
      assert.equal((await wake(f)).deferred, true);
      const map = await space.read(f.owner, f.id);
      await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        routeId: map.routes[0]!.id,
      });
      const before = await snap(f);
      assert.equal(q(before, 'a').status, 'eligible');
      assert.equal(before.evaluationCause, undefined);
      assert.equal(before.focus.length, 1);
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.equal(h.director()[1]!.payload.evaluationCause, undefined);
      const row = (await attempts(f)).at(-1)!;
      assert.equal(row.status, 'committed');
      assert.equal(q(row.snapshot, 'a').status, 'eligible');
      await activity.update(f.owner, f.id, { clientId: client, sequence: 1, mode: 'browsing' });
      assert.equal((await wake(f)).cause, null);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 2);
    },
  );
  await t.test(
    'no admission never adopts an existing epoch2 publication on idle or new authored time eligibility',
    async () => {
      const f = await fixture({ admit: false }),
        h = harness(f);
      await h.advance();
      await at(f, time(10));
      await h.advance();
      await at(f, time(12));
      await h.advance();
      assert.equal(h.calls.length, 0);
      assert.equal((await attempts(f)).length, 0);
      assert.equal((await wake(f)).cause, null);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_narrative_admissions WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'deep conversation defers unseen time qualification without consuming it; browsing resumes the same qualified opportunity',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f),
        client = randomUUID();
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 0,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.world.actors[0]!.id },
      });
      await at(f, time(10));
      const focused = await snap(f);
      assert.equal(focused.focus.length, 1);
      assert.equal(focused.evaluationCause, undefined);
      assert.equal(q(focused, 'a').status, 'eligible');
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 1);
      await activity.update(f.owner, f.id, { clientId: client, sequence: 1, mode: 'browsing' });
      assert.deepEqual(causeKeys(await snap(f)), ['a']);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 2);
    },
  );
  await t.test(
    'unknown paid time cause keeps its original attempt identity and pending fence across seconds and new qualifications',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const h = harness(f, {
        response() {
          throw Error('EXPLICIT_LOCAL_TRANSPORT_UNKNOWN');
        },
      });
      await assert.rejects(h.advance(), /EXPLICIT_LOCAL_TRANSPORT_UNKNOWN/);
      assert.equal(h.director().length, 1);
      const original = (await attempts(f)).at(-1)!;
      assert.equal(original.status, 'unknown_after_send');
      for (const when of [time(10, 1), time(12)]) {
        await at(f, when);
        assert.equal((await wake(f)).hasPendingDirector, true);
        await assert.rejects(h.advance(), { code: 'UNKNOWN' });
      }
      assert.equal(h.director().length, 1);
      const after = await attempts(f);
      assert.equal(after.length, 2);
      assert.equal(after.at(-1)!.id, original.id);
      assert.equal(after.at(-1)!.command_id, original.command_id);
      assert.equal(after.at(-1)!.status, 'unknown_after_send');
    },
  );
  await t.test(
    'known invalid result consumes captured qualifications, but a genuinely new later qualification is separate',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const h = harness(f, {
        response(_p, n) {
          return n === 1 ? 'malformed explicit local JSON' : JSON.stringify(quiet());
        },
      });
      await assert.rejects(h.advance(), { code: 'INVALID_DIRECTOR_PROPOSAL' });
      assert.equal((await attempts(f)).at(-1)!.status, 'invalid_output');
      await at(f, time(10, 1));
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await wake(f)).cause, null);
      await at(f, time(12));
      assert.deepEqual(causeKeys(await snap(f)), ['b']);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 2);
    },
  );
  await t.test(
    'paid stale time result is not re-purchased and does not become a result for the authored event',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const h = harness(f, {
        async response() {
          await worlds.saveNote(
            { userId: f.owner },
            {
              worldId: f.id,
              commandId: randomUUID(),
              expectedVersion: 0,
              title: '实际无关版本变更',
              text: '使已发送导演快照过时，但作者资格仍成立。',
            },
          );
          return JSON.stringify(quiet());
        },
      });
      await assert.rejects(h.advance(), { code: 'VERSION_CONFLICT' });
      const row = (await attempts(f)).at(-1)!;
      assert.equal(row.status, 'stale_discarded');
      assert.ok(row.sent_at);
      assert.ok(row.response_hash);
      await h.advance();
      await at(f, time(10, 1));
      assert.equal(q(await snap(f), 'a').status, 'eligible');
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 1);
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await wake(f)).cause, null);
      assert.deepEqual(await directors.readEpisodes(f.owner, f.id), []);
    },
  );
  await t.test(
    'response_received with expired window still enters real recovery without buying a replacement decision',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const s = await snap(f),
        c = claim(s);
      let { attempt } = await directors.claim(f.owner, c, s);
      attempt = await directors.mark(f.owner, attempt, 'request_sent');
      attempt = await directors.saveResponse(f.owner, attempt, JSON.stringify(quiet()));
      assert.equal(attempt.status, 'response_received');
      await at(f, time(11, 30));
      const w = await wake(f);
      assert.equal(w.cause, null);
      assert.equal(w.hasPendingDirector, true);
      const h = harness(f);
      await h.advance();
      assert.equal(h.calls.length, 0);
      assert.equal((await directors.lookup(f.owner, f.id, c.commandId))!.status, 'stale_discarded');
      assert.equal((await wake(f)).hasPendingDirector, false);
      await h.advance();
      assert.equal(h.calls.length, 0);
      assert.equal((await attempts(f)).length, 2);
    },
  );
  await t.test(
    'pending response waits through deep focus and recovers its original decision after browsing without a new model call',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const saved = await snap(f),
        c = claim(saved);
      let { attempt } = await directors.claim(f.owner, c, saved);
      attempt = await directors.mark(f.owner, attempt, 'request_sent');
      attempt = await directors.saveResponse(f.owner, attempt, JSON.stringify(quiet()));
      assert.equal(attempt.status, 'response_received');
      const client = randomUUID();
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 0,
        mode: 'conversation',
        focus: { channel: 'private', threadId: f.world.actors[0]!.id },
      });
      const focused = await wake(f);
      assert.equal(focused.cause, null);
      assert.equal(focused.deferred, true);
      assert.equal(focused.hasPendingDirector, true);
      const h = harness(f),
        before = await frozen(f);
      await h.advance();
      await h.advance();
      assert.deepEqual(await frozen(f), before);
      assert.equal(h.calls.length, 0);
      await activity.update(f.owner, f.id, { clientId: client, sequence: 1, mode: 'browsing' });
      await at(f, time(10));
      const ready = await wake(f);
      assert.equal(ready.deferred, false);
      assert.equal(ready.cause!.id, saved.evaluationCause!.id);
      await h.advance();
      assert.equal(h.calls.length, 0);
      const done = await directors.lookup(f.owner, f.id, c.commandId);
      assert.equal(done!.status, 'committed');
      assert.ok(done!.decisionId);
      assert.equal((await wake(f)).hasPendingDirector, false);
      assert.equal((await wake(f)).cause, null);
      await h.advance();
      assert.equal(h.calls.length, 0);
    },
  );
  await t.test(
    'a real pre-send pause produces explicit zero-send deferral, then resumes one stable semantic cause without treating paid calls as cancellable',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const original = await snap(f),
        h = harness(f);
      const name = 'semantic70_presend_' + randomUUID().replaceAll('-', '');
      await admin.query(`CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      BEGIN IF NEW.world_id='${f.id}' AND NEW.snapshot#>>'{evaluationCause,kind}'='authored_eligibility' THEN
      UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;
      END IF;RETURN NEW;END $$`);
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.director_runtime_attempts FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        const deferred = await h.advance();
        assert.equal(deferred?.played, 0);
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.director_runtime_attempts`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      assert.equal(h.calls.length, 0);
      const stale = (await attempts(f)).at(-1)!;
      assert.equal(stale.status, 'cancelled_before_send');
      assert.equal(stale.sent_at, null);
      assert.equal(stale.response_hash, null);
      assert.equal((await wake(f)).deferred, true);
      await h.advance();
      assert.equal(h.calls.length, 0);
      await clocks.setClock(f.owner, f.id, { paused: false, speed: 0 });
      const resumed = await snap(f);
      assert.deepEqual(causeKeys(resumed), ['a']);
      assert.notEqual(resumed.evaluationCause!.id, original.evaluationCause!.id);
      await at(f, time(10, 0, 2));
      assert.equal((await snap(f)).evaluationCause!.id, resumed.evaluationCause!.id);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 1);
      const all = await attempts(f);
      assert.equal(all.length, 3);
      assert.equal(all.at(-1)!.status, 'committed');
      assert.notEqual(all.at(-1)!.command_id, stale.command_id);
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
    },
  );
  await t.test(
    'actual model whitelist and store CAS reject forged qualification triples and stale semantic snapshots before new payment',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      await at(f, time(10));
      const s = await snap(f);
      assert.equal(s.evaluationCause!.kind, 'authored_eligibility');
      const changed = structuredClone(s);
      if (changed.evaluationCause!.kind !== 'authored_eligibility')
        throw Error('Expected qualification cause');
      changed.evaluationCause!.qualifications[0]!.qualificationKey = 'f'.repeat(64);
      const before = await frozen(f);
      let calls = 0;
      const model = new WorldDirectorAgentModel({
        async complete() {
          calls++;
          return JSON.stringify(quiet());
        },
      });
      assert.throws(() => model.validateInput(changed), { code: 'INVALID_DIRECTOR_PROPOSAL' });
      assert.equal(calls, 0);
      await assert.rejects(directors.claim(f.owner, claim(changed), changed), {
        code: 'DIRECTOR_EVALUATION_CAUSE_CONFLICT',
      });
      assert.deepEqual(await frozen(f), before);
      await at(f, time(11, 30));
      await assert.rejects(directors.claim(f.owner, claim(s), s), {
        code: 'DIRECTOR_AUTHORED_ELIGIBILITY_CONFLICT',
      });
      assert.deepEqual(await frozen(f), before);
      const g = await fixture();
      await bootstrap(g);
      await at(g, time(10));
      const gs = await snap(g),
        h = harness(g);
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.deepEqual(h.director()[0]!.payload.evaluationCause, gs.evaluationCause);
    },
  );
  await t.test(
    'proposed and actual active occupied author opportunities cannot become new qualification wake candidates',
    async () => {
      for (const choice of ['quiet', 'engage'] as const) {
        const f = await fixture({ proof: true }),
          h = harness(f, { propose: 'fallback', npcChoice: choice });
        await h.advance();
        const ep = (await directors.readEpisodes(f.owner, f.id))[0]!;
        assert.equal(ep.status, choice === 'engage' ? 'active' : 'proposed');
        const w = await worlds.get({ userId: f.owner }, f.id),
          map = await space.read(f.owner, f.id);
        await space.travel(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: w.version,
          routeId: map.routes[0]!.id,
        });
        const s = await snap(f);
        assert.ok(s.occupiedAuthoredEventKeys!.includes('fallback'));
        assert.equal(q(s, 'fallback').status, 'eligible');
        assert.equal(causeKeys(s).includes('fallback'), false);
        await h.advance();
        const count = h.director().length;
        await h.advance();
        assert.equal(h.director().length, count);
        assert.equal((await directors.readEpisodes(f.owner, f.id)).length, 1);
      }
    },
  );

  await t.test(
    'a deferred unplayed event is reconsidered once after its own actor actually changes plan, then handed to that NPC',
    async () => {
      const f = await fixture();
      await bootstrap(f);
      const original = q(await snap(f), 'always').qualificationKey;
      const actor = f.world.actors[0]!.id,
        other = f.world.actors[1]!.id;
      async function reply(actorId: string, plan: boolean) {
        const w = await worlds.get({ userId: f.owner }, f.id);
        const svc = npcAgentServices(app, () => ({
          async complete(messages) {
            const p = JSON.parse(messages[1]!.content),
              source = `definition:${p.state.definitionRef}`;
            return JSON.stringify({
              statements: [
                {
                  text: plan ? '我想先讨论准备安排，但还没有执行。' : '普通问候，没有新的决定。',
                  dependsOnActionIds: [],
                },
              ],
              goals: plan
                ? [
                    {
                      id: 'own-planning-goal',
                      summary: '讨论自己的准备安排',
                      status: 'active',
                      sourceIds: [source],
                      resultIds: [],
                    },
                  ]
                : [],
              plans: plan
                ? [
                    {
                      id: 'own-planning-plan',
                      goalId: 'own-planning-goal',
                      summary: '先等商量具体分工',
                      status: 'waiting',
                      sourceIds: [source],
                      actionIds: [],
                      nextActionId: null,
                      triggers: [],
                      missingConditions: ['尚未商量'],
                    },
                  ]
                : [],
              actions: [],
              responsibilities: [],
              decisions: [],
            });
          },
        }));
        await svc.sendMessageIfEnabled(f.owner, {
          id: randomUUID(),
          worldId: f.id,
          actorId,
          expectedVersion: w.version,
          text: plan ? '可以谈谈你自己的安排。' : '你好。',
        });
      }
      await reply(actor, false);
      assert.equal(
        (await wake(f)).cause,
        null,
        'ordinary private chat does not re-buy author consideration',
      );
      await reply(other, true);
      assert.equal(
        (await wake(f)).cause,
        null,
        'unrelated cast plan is not a new reason for this author event',
      );
      await reply(actor, true);
      const before = await snap(f);
      assert.equal(
        q(before, 'always').qualificationKey,
        original,
        'same author prerequisites, genuinely new related plan',
      );
      assert.deepEqual(causeKeys(before), ['always']);
      const key = before.evaluationCause!.id;
      await at(f, time(9, 1));
      assert.equal((await wake(f)).cause!.id, key, 'elapsed time cannot change this paid identity');
      const h = harness(f, { propose: 'always', npcChoice: 'engage' });
      assert.equal((await h.advance())!.played, 1);
      assert.equal(h.director().length, 1);
      assert.equal(h.calls.filter((c) => c.kind === 'npc').length, 1);
      const episodes = await directors.readEpisodes(f.owner, f.id);
      assert.equal(episodes.length, 1);
      assert.equal(episodes[0]!.status, 'active', 'participation is not incident completion');
      assert.equal((await wake(f)).cause, null);
      await h.advance(); // A real NPC participation can itself warrant one global evaluation.
      const count = h.calls.length;
      await h.advance();
      await at(f, time(9, 2));
      await h.advance();
      assert.equal(
        h.calls.length,
        count,
        'unchanged sources and idle ticks never re-buy consideration',
      );
    },
  );
  await t.test('every real fixture keeps old publication ledgers uninitialized', async () => {
    for (const table of [
      'publication_story_plans',
      'publication_story_nodes',
      'publication_story_progress',
      'publication_story_receipts',
      'publication_opening_batches',
      'publication_opening_deliveries',
    ])
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=ANY($1::text[])`,
            [owned.map((f) => f.id)],
          )
        ).rows[0].n,
        0,
        table,
      );
  });
});
