import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
import { authoredDirectorSourceHandle } from '../../src/modules/world/domain/authored-agent-material.ts';
import {
  readAuthoredEligibilityInTransaction,
  authoredEligibilitySummary,
  type AuthoredEligibilityView,
} from '../../src/modules/world/infrastructure/authored-event-eligibility-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
} from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { readPrivateAgentSnapshot } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  admitNewAgentNarrativeInTransaction,
  readPendingEpisodeRequestsInTransaction,
} from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type {
  AgentInputReceipt,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type {
  DirectorSnapshot,
  DirectorDecision,
} from '../../src/modules/world/domain/director-runtime.ts';
import type { AgentEpisodeRequest } from '../../src/modules/world/domain/agent-narrative.ts';

test('actual bound publication eligibility: immutable source, real positions and Director fences', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AUTHORED_ELIGIBILITY_TEST_PORT ?? 55505));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
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
      await worker.close();
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
        reviewerVersion: 'EXPLICIT_LOCAL_AUTHORED_ELIGIBILITY_FIXTURE',
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
  const trials = new PublicationWorldRepository(pub, compiler),
    published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const start = '2026-10-12T09:00:00.000Z';
  const originalStart = '2026-10-12T09:00:00.000000000001Z';
  const originalEnd = '2026-10-13T09:00:00.000000000001Z';
  base.world.startAt = start;
  base.places.push({
    key: 'away',
    name: '另一处小店',
    description: '合成远处地点',
    knownAtStart: true,
  });
  base.routes = [
    { fromPlaceKey: 'shop', toPlaceKey: 'away', minutes: 5 },
    { fromPlaceKey: 'away', toPlaceKey: 'shop', minutes: 5 },
  ];
  base.history = ['a_bound', 'b_bound', 'c_unbound'].map((key) => ({
    key,
    kind: 'established_fact',
    text: '完全相同的合成历史文本',
    occurredAt: '2026-10-11T09:00:00.000000000001Z',
    actorKeys: base.actors.map((a: { key: string }) => a.key),
    visibility: { kind: 'world' },
  }));
  base.initialKnowledge = [{ actorKey: base.actors[0].key, factKeys: ['a_bound', 'b_bound'] }];
  base.timeline = {
    initialStageKey: 'day',
    stages: [
      {
        key: 'day',
        title: '原稿的一天',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: originalStart, expiresAt: originalEnd },
      },
    ],
  };
  base.conditions = [
    {
      key: 'actually_away',
      title: '真实到达远处',
      match: 'all',
      prerequisites: [{ kind: 'at_place', placeKey: 'away' }],
    },
  ];
  const node = (key: string, prerequisites: unknown[] = [], extra = {}) => ({
    key,
    kind: 'candidate',
    title: '合成未来事件_' + key,
    editorialIntent: '这是作者意图，不是已经发生。',
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
    node('start', [], { placeKey: 'away', script: '  原稿保留空格。必须去远处只是文案。  ' }),
    node('here', [{ kind: 'at_place', placeKey: 'shop' }]),
    node('away_gate', [], { conditionKeys: ['actually_away'] }),
    ...['a_bound', 'b_bound', 'c_unbound'].map((key) =>
      node('history_' + key, [{ kind: 'history_fact', factKey: key }]),
    ),
    node('after_presented', [{ kind: 'after_presented_node', nodeKey: 'start' }]),
    node('after_resolved', [
      { kind: 'after_resolved_node', nodeKey: 'start', outcomes: ['committed', 'skipped'] },
    ]),
    node('tomorrow', [{ kind: 'not_before', at: '2026-10-13T00:00:00.000000000001Z' }]),
  ];
  base.openingEventKey = 'start';
  const content = PublishedWorldContentSchema.parse(base);
  const work = await stableWorks.create(staff, {
    commandId: randomUUID(),
    title: 'Only local eligibility fixture',
    content,
  });
  const checked = await stableWorks.check(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
  });
  assert.equal(checked.status, 'ready');
  await stableWorks.publish(staff, work.id, {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    expectedMetadataVersion: 0,
    checkId: checked.id,
  });
  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    director = new PostgresDirectorRuntimeRepository(app),
    actors = new PostgresAgentRuntimeRepository(app),
    space = new PostgresWorldSpace(app, {
      list() {
        return [];
      },
      get() {
        return undefined;
      },
    });
  async function enroll(owner: string, id: string) {
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
    return { owner, id };
  }
  async function fixture() {
    const owner = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const result = await published.startPublished(owner, work.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    return enroll(owner, result.worldId);
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const scope = (f: Fixture, version = 0, storyAt = start) => ({
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: version,
    storyAt,
  });
  const read = (f: Fixture, version = 0, storyAt = start) =>
    app.transaction(f.owner, (sql) =>
      readAuthoredEligibilityInTransaction(sql, f.owner, scope(f, version, storyAt)),
    );
  const item = (view: AuthoredEligibilityView, key: string) => {
    const result = view.eligibility.find((e) => e.ref.nodeKey === key);
    assert.ok(result);
    return result;
  };
  async function snapshot(f: Fixture) {
    const w = await worlds.get({ userId: f.owner }, f.id);
    return snapshots.read(f.owner, { ...scope(f, w.version), candidates: [], blockers: [] });
  }
  async function rows(f: Fixture) {
    const names = [
      'worlds',
      'world_clock',
      'publication_story_plans',
      'publication_story_nodes',
      'publication_story_progress',
      'publication_story_receipts',
      'publication_opening_batches',
      'publication_opening_deliveries',
      'world_events',
      'world_messages',
      'world_authoritative_positions',
      'actor_agent_states',
      'agent_narrative_admissions',
      'commands',
      'agent_input_receipts',
      'agent_attempts',
      'director_runtime_attempts',
      'director_decisions',
      'shared_episodes',
      'agent_episode_requests',
      'agent_episode_receipts',
    ];
    const result: Record<string, unknown> = {};
    for (const name of names)
      result[name] = (
        await admin.query(
          `SELECT to_jsonb(t) row FROM parallel_life.${name} t WHERE ${name === 'worlds' ? 'id' : 'world_id'}=$1 ORDER BY to_jsonb(t)::text`,
          [f.id],
        )
      ).rows;
    return result;
  }
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
  function output(s: DirectorSnapshot, key = 'start', keyPresent = true) {
    const m = s.authoredMaterials!.materials.find((m) => m.ref.nodeKey === key)!;
    const handle = authoredDirectorSourceHandle(m);
    return {
      mode: 'bounded_opportunity',
      selectedCandidateIds: [],
      deferred: [],
      nudges: [],
      opportunities: [
        {
          id: randomUUID(),
          title: '只考虑原稿',
          description: '尚未发生的机会',
          playerImpact: '由玩家决定',
          participantActorIds: [s.cast![0]!.id],
          placeIds: [],
          activity: 'conversation',
          basisSourceIds: [handle],
          ...(keyPresent ? { authoredEventKey: key } : {}),
        },
      ],
      audit: { reason: '本地合成审计', basisSourceIds: [handle] },
    };
  }
  async function perform(f: Fixture, r?: AgentEpisodeRequest) {
    const w = await worlds.get({ userId: f.owner }, f.id),
      actorId = r?.actorId ?? w.actors[0]!.id;
    const state = (await actors.read(f.owner, { worldId: f.id, actorId }))!;
    const text = r
      ? JSON.stringify({
          type: 'npc_episode_consideration',
          requestId: r.id,
          revision: 0,
          activity: r.activity,
          placeOptionIds: [],
          basisSourceIds: [`definition:${state.definitionRef}`],
        })
      : '我已到远处了；这只是玩家报告。';
    const input: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.id,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(text).digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: w.version,
      origin: r ? 'coordination' : 'player',
      text,
      receivedAt: new Date().toISOString(),
      storyAt: w.time,
    };
    await actors.accept(f.owner, input);
    const { snapshot: s } = await readPrivateAgentSnapshot(
      app,
      f.owner,
      w,
      actorId,
      input,
      w.time,
      state,
    );
    const c = {
      id: randomUUID(),
      worldId: f.id,
      actorId,
      commandId: input.commandId,
      inputReceiptId: input.id,
      inputHash: input.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: w.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };
    const proposal: AgentProposal = {
      statements: [
        { text: '我听说你已到远处，开场已经完成。这里只是NPC台词。', dependsOnActionIds: [] },
      ],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      ...(r
        ? {
            episodeDecision: {
              requestId: r.id,
              choice: 'engage' as const,
              reason: '自己的安排允许参加。',
              sourceIds: [input.id, `definition:${state.definitionRef}`],
            },
          }
        : {}),
    };
    return runNpcAgent(
      {
        attempts: actors,
        kernel: new PostgresNpcAgentKernel(app, worlds),
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
      },
      f.owner,
      c,
      s,
    );
  }
  await t.test(
    'bound publication reads in RR READ ONLY; actual snapshot shares eligibility with zero old-plan initialization',
    async () => {
      const f = await fixture(),
        before = await rows(f),
        sql = await app.pool.connect();
      let view: AuthoredEligibilityView;
      try {
        await sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await sql.query("SELECT set_config('app.user_id',$1,true)", [f.owner]);
        view = await readAuthoredEligibilityInTransaction(sql, f.owner, scope(f));
        assert.equal(
          (await sql.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
          'on',
        );
        await sql.query('COMMIT');
      } catch (e) {
        await sql.query('ROLLBACK');
        throw e;
      } finally {
        sql.release();
      }
      const s = await snapshot(f);
      assert.deepEqual(s.authoredEligibility, authoredEligibilitySummary(view));
      assert.deepEqual(s.occupiedAuthoredEventKeys, []);
      assert.equal(view.catalog.source!.origin.publicationVersion, 1);
      assert.equal(view.catalog.timeline!.stages[0]!.window!.notBefore, originalStart);
      assert.deepEqual(await rows(f), before);
      for (const key of [
        'publication_story_plans',
        'publication_story_nodes',
        'publication_story_progress',
        'publication_story_receipts',
      ])
        assert.deepEqual(before[key], []);
    },
  );
  await t.test(
    'original day window uses equal UTC/+08 instants and >9 fractional digits without mutating author hashes',
    async () => {
      const f = await fixture(),
        utc = await read(f),
        offset = await read(f, 0, '2026-10-12T17:00:00.000000000001+08:00');
      assert.deepEqual(offset, utc);
      assert.equal(item(utc, 'start').status, 'eligible');
      assert.deepEqual(item(utc, 'tomorrow').reasons, ['not_before']);
      const nextDay = await read(f, 0, '2026-10-13T08:59:59.999999999999Z');
      assert.equal(item(nextDay, 'tomorrow').status, 'eligible');
      const ended = await read(f, 0, '2026-10-13T17:00:00.000000000001+08:00');
      assert.equal(item(ended, 'start').status, 'expired');
      assert.ok(item(ended, 'start').reasons.includes('window_expired'));
      assert.equal(item(ended, 'start').ref.nodeHash, item(utc, 'start').ref.nodeHash);
      assert.equal(ended.catalog.source!.sourceHash, utc.catalog.source!.sourceHash);
    },
  );
  await t.test(
    'identical history prose cannot bind another fact key or fabricate a source allocation',
    async () => {
      const f = await fixture(),
        view = await read(f),
        a = item(view, 'history_a_bound'),
        b = item(view, 'history_b_bound'),
        hidden = item(view, 'history_c_unbound');
      assert.equal(a.status, 'eligible');
      assert.equal(b.status, 'eligible');
      assert.equal(hidden.status, 'blocked');
      assert.deepEqual(hidden.reasons, ['history_fact_missing']);
      assert.equal(a.basisSourceIds.length, 1);
      assert.equal(b.basisSourceIds.length, 1);
      assert.notDeepEqual(a.basisSourceIds, b.basisSourceIds);
      const initial = (
        await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [f.id],
        )
      ).rows[0].state;
      assert.equal(initial.facts.length, 2);
      for (const result of [a, b])
        assert.ok(
          initial.facts.some((fact: { id: string }) =>
            result.basisSourceIds.includes(`fact:${fact.id}`),
          ),
        );
      assert.equal(initial.facts[0].text, initial.facts[1].text);
      assert.deepEqual(a.basisSourceIds, [`fact:${initial.facts[0].id}`]);
      assert.deepEqual(b.basisSourceIds, [`fact:${initial.facts[1].id}`]);
      assert.deepEqual(hidden.basisSourceIds, []);
    },
  );
  await t.test(
    'only explicit at_place gates; actual travel differs from player report, NPC prose and ordinary message volume',
    async () => {
      const f = await fixture(),
        before = await read(f);
      assert.equal(item(before, 'start').status, 'eligible');
      assert.equal(item(before, 'here').status, 'eligible');
      assert.equal(item(before, 'away_gate').status, 'blocked');
      const report = await perform(f);
      await perform(f);
      await perform(f);
      const view = await read(f, 3, (await worlds.get({ userId: f.owner }, f.id)).time);
      assert.ok(report.eventId);
      assert.equal(item(view, 'away_gate').status, 'blocked');
      assert.deepEqual(item(view, 'away_gate').reasons, ['at_place_not_met', 'condition_not_met']);
      assert.equal(
        item(view, 'away_gate').qualificationKey,
        item(before, 'away_gate').qualificationKey,
      );
      assert.deepEqual(item(view, 'after_presented').reasons, ['node_not_presented']);
      assert.deepEqual(item(view, 'after_resolved').reasons, ['node_not_resolved']);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key='player'",
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      const map = await space.read(f.owner, f.id),
        route = map.routes.find((r) => r.toPlaceId !== map.currentPlaceId)!;
      await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 3,
        routeId: route.id,
      });
      const moved = await worlds.get({ userId: f.owner }, f.id),
        after = await read(f, 4, moved.time);
      assert.equal(item(after, 'away_gate').status, 'eligible');
      assert.deepEqual(item(after, 'away_gate').basisSourceIds, ['actual-position:player']);
      assert.equal(item(after, 'here').status, 'blocked');
      const position = (
        await admin.query(
          "SELECT p.document,e.payload,c.status FROM parallel_life.world_authoritative_positions p JOIN parallel_life.world_events e ON e.id=p.source_event_id AND e.world_id=p.world_id JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id WHERE p.world_id=$1 AND p.subject_key='player'",
          [f.id],
        )
      ).rows[0];
      assert.equal(position.payload.type, 'travel.completed');
      assert.equal(position.status, 'succeeded');
      assert.equal(position.document.placeId, moved.space!.currentPlaceId);
    },
  );
  await t.test(
    'a proposed and genuinely active episode occupy the author key but prove neither presentation nor resolution',
    async () => {
      const f = await fixture(),
        s = await snapshot(f),
        c = claim(s),
        raw = output(s);
      const d = await runDirectorAgent(
        {
          attempts: director,
          parse: parseDirectorDecision,
          model: new WorldDirectorAgentModel({
            async complete() {
              return JSON.stringify(raw);
            },
          }),
        },
        f.owner,
        c,
        s,
      );
      const proposed = await read(f);
      assert.deepEqual(proposed.occupiedEventKeys, ['start']);
      assert.equal(item(proposed, 'start').status, 'eligible');
      assert.deepEqual(item(proposed, 'after_presented').reasons, ['node_not_presented']);
      assert.deepEqual(item(proposed, 'after_resolved').reasons, ['node_not_resolved']);
      const requests = await app.transaction(f.owner, (sql) =>
        readPendingEpisodeRequestsInTransaction(sql, f.owner, { worldId: f.id, engineEpoch: 2 }),
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.originDecisionId, d.id);
      await perform(f, requests[0]);
      const active = (await director.readEpisodes(f.owner, f.id))[0]!;
      assert.equal(active.status, 'active');
      assert.equal(active.sourceEventIds.length, 1);
      assert.deepEqual(active.resultIds, []);
      const w = await worlds.get({ userId: f.owner }, f.id),
        view = await read(f, w.version, w.time);
      assert.deepEqual(view.occupiedEventKeys, ['start']);
      assert.deepEqual(item(view, 'after_presented').reasons, ['node_not_presented']);
      assert.deepEqual(item(view, 'after_resolved').reasons, ['node_not_resolved']);
      assert.equal(item(view, 'start').status, 'eligible');
      const next = await snapshot(f),
        nextClaim = claim(next),
        before = await rows(f);
      assert.throws(
        () =>
          parseDirectorDecision(next, output(next), { ...nextClaim, status: 'response_received' }),
        { code: 'INVALID_DIRECTOR_PROPOSAL' },
      );
      assert.deepEqual(await rows(f), before);
    },
  );
  await t.test(
    'eligibility and actual snapshot enforce owner, worker, epoch and world version with read-only failures',
    async () => {
      const f = await fixture(),
        other = randomUUID();
      await new IdentityRepository(app).ensureGuest(other);
      const before = await rows(f);
      await assert.rejects(
        app.transaction(other, (sql) => readAuthoredEligibilityInTransaction(sql, other, scope(f))),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        worker.transaction(f.owner, (sql) =>
          readAuthoredEligibilityInTransaction(sql, f.owner, scope(f)),
        ),
        { code: '42501' },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredEligibilityInTransaction(sql, f.owner, { ...scope(f), engineEpoch: 3 }),
        ),
        { code: 'ENGINE_EPOCH_CONFLICT' },
      );
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          readAuthoredEligibilityInTransaction(sql, f.owner, { ...scope(f), worldVersion: 1 }),
        ),
        { code: 'VERSION_CONFLICT' },
      );
      await assert.rejects(snapshots.read(other, { ...scope(f), candidates: [], blockers: [] }), {
        code: 'DIRECTOR_WORLD_NOT_FOUND',
      });
      await assert.rejects(
        new PostgresDirectorSnapshotRepository(worker).read(f.owner, {
          ...scope(f),
          candidates: [],
          blockers: [],
        }),
        { code: 'DIRECTOR_WORLD_NOT_FOUND' },
      );
      await assert.rejects(
        snapshots.read(f.owner, { ...scope(f), engineEpoch: 3, candidates: [], blockers: [] }),
        { code: 'ENGINE_EPOCH_CONFLICT' },
      );
      await assert.rejects(
        snapshots.read(f.owner, { ...scope(f), worldVersion: 1, candidates: [], blockers: [] }),
        { code: 'VERSION_CONFLICT' },
      );
      assert.deepEqual(await rows(f), before);
    },
  );
  await t.test(
    'blocked author opportunities cannot omit the key; actual persisted failure cannot be re-purchased',
    async () => {
      const f = await fixture(),
        s = await snapshot(f);
      assert.equal(
        s.authoredEligibility!.find((e) => e.nodeKey === 'away_gate')!.status,
        'blocked',
      );
      for (const keyPresent of [true, false]) {
        const g = await fixture(),
          current = await snapshot(g),
          c = claim(current),
          raw = output(current, 'away_gate', keyPresent);
        let calls = 0;
        const deps = {
          attempts: director,
          parse: parseDirectorDecision,
          model: new WorldDirectorAgentModel({
            async complete() {
              calls++;
              return JSON.stringify(raw);
            },
          }),
        };
        await assert.rejects(runDirectorAgent(deps, g.owner, c, current), {
          code: 'INVALID_DIRECTOR_PROPOSAL',
        });
        assert.equal(calls, 1);
        assert.equal((await director.lookup(g.owner, g.id, c.commandId))!.status, 'invalid_output');
        await assert.rejects(runDirectorAgent(deps, g.owner, c, current), {
          code: 'INVALID_STATE',
        });
        assert.equal(calls, 1);
        assert.deepEqual(await director.readEpisodes(g.owner, g.id), []);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.director_decisions WHERE world_id=$1',
              [g.id],
            )
          ).rows[0].n,
          0,
        );
      }
      assert.deepEqual(await director.readEpisodes(f.owner, f.id), []);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_decisions WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      const c = claim(s),
        forged = structuredClone(s);
      forged.authoredEligibility!.find((e) => e.nodeKey === 'away_gate')!.status = 'eligible';
      await assert.rejects(
        director.claim(f.owner, { ...c, inputHash: directorSnapshotInputHash(forged) }, forged),
        { code: 'DIRECTOR_AUTHORED_ELIGIBILITY_CONFLICT' },
      );
    },
  );
  await t.test(
    'actual Director commit revalidates blocked author source even when caller bypasses output parser',
    async () => {
      for (const keyPresent of [true, false]) {
        const f = await fixture(),
          s = await snapshot(f),
          c = claim(s),
          raw = output(s, 'away_gate', keyPresent);
        let { attempt } = await director.claim(f.owner, c, s);
        attempt = await director.mark(f.owner, attempt, 'request_sent');
        attempt = await director.saveResponse(f.owner, attempt, raw);
        const decision: DirectorDecision = {
          schemaVersion: 1,
          id: randomUUID(),
          worldId: f.id,
          engineEpoch: 2,
          worldVersion: 0,
          inputHash: c.inputHash,
          evaluatedThroughVersion: 0,
          ...raw,
        } as DirectorDecision;
        const before = await rows(f);
        await assert.rejects(director.commit(f.owner, attempt, s, decision), {
          code: 'DIRECTOR_OPPORTUNITY_BOUNDARY',
        });
        assert.deepEqual(await rows(f), before);
        assert.equal(
          (await director.lookup(f.owner, f.id, c.commandId))!.status,
          'response_received',
        );
        assert.deepEqual(await director.readEpisodes(f.owner, f.id), []);
      }
    },
  );
  await t.test(
    'published source and trial revision stay isolated from the current draft and one another',
    async () => {
      const f = await fixture(),
        before = await read(f),
        updated = structuredClone(content);
      updated.candidates.find((n) => n.key === 'away_gate')!.conditionKeys = [];
      updated.candidates.find((n) => n.key === 'start')!.script = '新草稿专属原文';
      await stableWorks.save(staff, work.id, {
        commandId: randomUUID(),
        expectedDraftVersion: 0,
        content: updated,
      });
      assert.deepEqual(await read(f), before);
      const detail = await stableWorks.get(staff, work.id),
        trial = await trials.startTrial(staff, work.id, {
          commandId: randomUUID(),
          draftVersion: 1,
          contentHash: detail.draft.contentHash,
        });
      const session = await trials.trialSession(staff, trial.trialId!),
        next = await enroll(session.ownerId, session.worldId),
        view = await read(next);
      assert.equal(view.catalog.source!.origin.publicationVersion, 0);
      assert.equal(view.catalog.source!.origin.draftVersion, 1);
      assert.equal(item(view, 'away_gate').status, 'eligible');
      assert.equal(item(before, 'away_gate').status, 'blocked');
      assert.notEqual(view.catalog.source!.sourceHash, before.catalog.source!.sourceHash);
      assert.notEqual(
        item(view, 'away_gate').qualificationKey,
        item(before, 'away_gate').qualificationKey,
      );
      assert.equal(
        (await read(f)).catalog.materials.find((m) => m.ref.nodeKey === 'start')!.node.script,
        content.candidates[0]!.script,
      );
      const again = await fixture();
      assert.equal(item(await read(again), 'away_gate').status, 'blocked');
    },
  );
  await t.test(
    'all real publication, travel, chat and active-participation paths leave legacy author ledgers uninitialized',
    async () => {
      assert.ok(owned.length > 10);
      for (const table of [
        'publication_story_plans',
        'publication_story_nodes',
        'publication_story_progress',
        'publication_story_receipts',
        'publication_opening_batches',
        'publication_opening_deliveries',
      ]) {
        const result = await admin.query(
          `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=ANY($1::text[])`,
          [owned.map((f) => f.id)],
        );
        assert.equal(result.rows[0].n, 0, table);
      }
    },
  );
});
