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
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import {
  runDirectorAgent,
  recoverDirectorAgent,
} from '../../src/modules/world/application/run-director-agent.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresClockActivityRepository } from '../../src/modules/world/infrastructure/clock-activity-repository.ts';
import { readDirectorNarrativeWakeInTransaction } from '../../src/modules/world/infrastructure/narrative-wake-repository.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
test('actual Director delivery rechecks activity and preserves protected paid results', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_DELIVERY_TEST_PORT ?? 55505));
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
  async function fixture(options: { admit?: boolean; proof?: boolean; multi?: boolean } = {}) {
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
        await admin.query('SELECT id FROM parallel_life.worlds WHERE id=$1 FOR UPDATE NOWAIT', [
          f.id,
        ]);
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
  type Boundary = 'pause' | 'inactive' | 'expired' | 'focus';
  async function boundary(f: Fixture, kind: Boundary, client = randomUUID()) {
    if (kind === 'pause') await clocks.setClock(f.owner, f.id, { paused: true });
    else
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 0,
        mode: kind === 'inactive' ? 'away' : kind === 'focus' ? 'conversation' : 'browsing',
        ...(kind === 'focus'
          ? { focus: { channel: 'private' as const, threadId: f.world.actors[0]!.id } }
          : {}),
      });
    if (kind === 'expired')
      await admin.query(
        "UPDATE parallel_life.world_clock SET active_until=clock_timestamp()-interval '1 second' WHERE world_id=$1 AND owner_id=$2",
        [f.id, f.owner],
      );
    return async () => {
      if (kind === 'pause') await clocks.setClock(f.owner, f.id, { paused: false, speed: 0 });
      else
        await activity.update(f.owner, f.id, {
          clientId: client,
          sequence: 1,
          mode: 'browsing',
          resume: true,
        });
    };
  }
  async function noDecision(f: Fixture) {
    for (const table of [
      'director_decisions',
      'shared_episodes',
      'agent_episode_requests',
      'agent_episode_receipts',
      'world_events',
    ])
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`,
            [f.id],
          )
        ).rows[0].n,
        0,
        table,
      );
  }
  for (const kind of ['pause', 'inactive', 'expired', 'focus'] as const)
    await t.test(
      `initial ${kind} defers actual admitted bootstrap without any model or attempt`,
      async () => {
        const f = await fixture(),
          restore = await boundary(f, kind),
          h = harness(f),
          before = await frozen(f);
        const deferred = await wake(f);
        assert.equal(deferred.cause, null);
        assert.equal(deferred.deferred, true);
        assert.equal(deferred.hasPendingDirector, false);
        await h.advance();
        await h.advance();
        assert.equal(h.calls.length, 0);
        assert.equal((await attempts(f)).length, 0);
        await noDecision(f);
        assert.deepEqual(await frozen(f), before);
        await restore();
        const ready = await wake(f);
        assert.equal(ready.cause!.kind, 'bootstrap');
        await h.advance();
        await h.advance();
        assert.equal(h.director().length, 1);
        assert.equal((await attempts(f)).length, 1);
        assert.equal((await attempts(f))[0]!.status, 'committed');
        assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      },
    );
  await t.test(
    'a real claim-local pause cancels before send; resume keeps worldVersion and uses one stable zero-send successor',
    async () => {
      const f = await fixture(),
        original = await snap(f),
        h = harness(f),
        name = 'delivery72_presend_' + randomUUID().replaceAll('-', '');
      assert.equal(original.evaluationCause!.kind, 'bootstrap');
      await admin.query(`CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
      BEGIN IF NEW.world_id='${f.id}' AND NEW.snapshot#>>'{evaluationCause,kind}'='bootstrap' THEN
      UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;
      END IF;RETURN NEW;END $$`);
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.director_runtime_attempts FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(h.advance(), { code: 'DIRECTOR_DELIVERY_DEFERRED' });
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.director_runtime_attempts`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      assert.equal(h.calls.length, 0);
      const first = (await attempts(f))[0]!;
      assert.equal(first.status, 'cancelled_before_send');
      assert.equal(first.sent_at, null);
      assert.equal(first.response_hash, null);
      await noDecision(f);
      await h.advance();
      assert.equal(h.calls.length, 0);
      await clocks.setClock(f.owner, f.id, { paused: false, speed: 0 });
      const resumed = await snap(f);
      assert.equal(resumed.worldVersion, 0);
      assert.equal(resumed.evaluationCause!.kind, 'bootstrap');
      assert.notEqual(resumed.evaluationCause!.id, original.evaluationCause!.id);
      await at(f, time(9, 0, 3));
      assert.equal((await snap(f)).evaluationCause!.id, resumed.evaluationCause!.id);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 1);
      const all = await attempts(f);
      assert.equal(all.length, 2);
      assert.equal(all[0]!.id, first.id);
      assert.equal(all[0]!.status, 'cancelled_before_send');
      assert.equal(all[1]!.status, 'committed');
      assert.notEqual(all[1]!.command_id, first.command_id);
    },
  );
  for (const kind of ['pause', 'inactive', 'expired', 'focus'] as const)
    await t.test(
      `a paid bootstrap response arriving during ${kind} waits intact, then original raw commits with zero extra model calls`,
      async () => {
        const f = await fixture();
        let restore: (() => Promise<void>) | undefined;
        const h = harness(f, {
          async response() {
            restore = await boundary(f, kind);
            return JSON.stringify(quiet());
          },
        });
        await assert.rejects(h.advance(), { code: 'DIRECTOR_DELIVERY_DEFERRED' });
        assert.equal(h.director().length, 1);
        assert.equal(h.calls.length, 1);
        const row = (await attempts(f))[0]!;
        assert.equal(row.status, 'response_received');
        assert.ok(row.sent_at);
        assert.ok(row.response_hash);
        assert.equal(row.response, JSON.stringify(quiet()));
        await noDecision(f);
        const saved = await frozen(f);
        await h.advance();
        await h.advance();
        assert.equal(h.calls.length, 1);
        assert.deepEqual(await frozen(f), saved);
        assert.ok(restore);
        await restore();
        assert.equal((await wake(f)).cause!.id, row.snapshot.evaluationCause.id);
        await h.advance();
        assert.equal(h.calls.length, 1);
        const done = (await attempts(f))[0]!;
        assert.equal(done.id, row.id);
        assert.equal(done.command_id, row.command_id);
        assert.equal(done.status, 'committed');
        assert.equal(done.response, row.response);
        assert.equal(done.response_hash, row.response_hash);
        assert.equal(done.input_hash, row.input_hash);
        assert.equal(done.token, row.token);
        assert.deepEqual(done.snapshot, row.snapshot);
        assert.equal((await directors.readEpisodes(f.owner, f.id)).length, 0);
        assert.equal((await attempts(f)).length, 1);
        const n = (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.director_decisions WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n;
        assert.equal(n, 1);
        await h.advance();
        assert.equal(h.calls.length, 1);
        assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      },
    );
  await t.test(
    'activity expiring during request_sent SQL rolls back send despite a still-live execution lease',
    async () => {
      const f = await fixture(),
        client = randomUUID(),
        h = harness(f),
        name = 'delivery72_expiry_send_' + randomUUID().replaceAll('-', '');
      await activity.update(f.owner, f.id, { clientId: client, sequence: 0, mode: 'browsing' });
      await admin.query(`CREATE SEQUENCE parallel_life.${name}`);
      await admin.query(`GRANT USAGE,SELECT ON SEQUENCE parallel_life.${name} TO pl_app`);
      await admin.query(`CREATE FUNCTION parallel_life.${name}_claim() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
      IF NEW.world_id='${f.id}' THEN UPDATE parallel_life.world_clock SET active_until=clock_timestamp()+interval '2 seconds' WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;END IF;RETURN NEW;END $$`);
      await admin.query(`CREATE FUNCTION parallel_life.${name}_send() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE expiry timestamptz;BEGIN
      IF NEW.world_id='${f.id}' AND NEW.status='request_sent' THEN
      SELECT active_until INTO expiry FROM parallel_life.world_clock WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;
      IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'DELIVERY72_SEND_ENTRY_ALREADY_EXPIRED';END IF;
      PERFORM nextval('parallel_life.${name}'::regclass);PERFORM pg_sleep(EXTRACT(EPOCH FROM(expiry-clock_timestamp()))+0.1);
      END IF;RETURN NEW;END $$`);
      await admin.query(
        `CREATE TRIGGER ${name}_claim BEFORE INSERT ON parallel_life.director_runtime_attempts FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}_claim()`,
      );
      await admin.query(
        `CREATE TRIGGER ${name}_send BEFORE UPDATE ON parallel_life.director_runtime_attempts FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}_send()`,
      );
      try {
        await assert.rejects(h.advance(), { code: 'DIRECTOR_DELIVERY_DEFERRED' });
        assert.equal(
          (await admin.query(`SELECT is_called FROM parallel_life.${name}`)).rows[0].is_called,
          true,
          'actual request_sent UPDATE trigger was reached before activity expired',
        );
      } finally {
        for (const suffix of ['claim', 'send']) {
          await admin.query(
            `DROP TRIGGER ${name}_${suffix} ON parallel_life.director_runtime_attempts`,
          );
          await admin.query(`DROP FUNCTION parallel_life.${name}_${suffix}()`);
        }
        await admin.query(`DROP SEQUENCE parallel_life.${name}`);
      }
      assert.equal(h.calls.length, 0);
      const row = (await attempts(f))[0]!;
      assert.equal(row.status, 'cancelled_before_send');
      assert.equal(row.sent_at, null);
      assert.equal(row.response_hash, null);
      assert.ok(Date.parse(row.lease_until) > Date.now() + 60000);
      const actual = (
        await admin.query(
          'SELECT paused,managed,active_until<clock_timestamp() expired FROM parallel_life.world_clock WHERE world_id=$1',
          [f.id],
        )
      ).rows[0];
      assert.deepEqual(actual, { paused: false, managed: true, expired: true });
      await noDecision(f);
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await attempts(f)).length, 2);
    },
  );
  await t.test(
    'activity expiring during last actor-request INSERT rolls back decision, opportunity, request and committed status while protected raw survives',
    async () => {
      const f = await fixture(),
        client = randomUUID(),
        name = 'delivery72_expiry_commit_' + randomUUID().replaceAll('-', '');
      const h = harness(f, {
        async response(p) {
          await activity.update(f.owner, f.id, { clientId: client, sequence: 0, mode: 'browsing' });
          await admin.query(
            "UPDATE parallel_life.world_clock SET active_until=clock_timestamp()+interval '2 seconds' WHERE world_id=$1 AND owner_id=$2",
            [f.id, f.owner],
          );
          const m = p.authoredMaterials.materials.find((m: any) => m.ref.nodeKey === 'always');
          return JSON.stringify({
            ...quiet(),
            mode: 'bounded_opportunity',
            opportunities: [
              {
                id: randomUUID(),
                title: '合成候选',
                description: '仅等待人物考虑',
                playerImpact: '玩家自主决定',
                participantActorIds: [f.world.actors[0]!.id],
                placeIds: [],
                activity: 'conversation',
                basisSourceIds: [m.sourceId],
                authoredEventKey: 'always',
              },
            ],
          });
        },
      });
      await admin.query(`CREATE SEQUENCE parallel_life.${name}`);
      await admin.query(`GRANT USAGE,SELECT ON SEQUENCE parallel_life.${name} TO pl_app`);
      await admin.query(`CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE expiry timestamptz;BEGIN
      IF NEW.world_id='${f.id}' THEN SELECT active_until INTO expiry FROM parallel_life.world_clock WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;
      IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'DELIVERY72_COMMIT_ENTRY_ALREADY_EXPIRED';END IF;
      PERFORM nextval('parallel_life.${name}'::regclass);PERFORM pg_sleep(EXTRACT(EPOCH FROM(expiry-clock_timestamp()))+0.1);END IF;RETURN NEW;END $$`);
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.agent_episode_requests FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(h.advance(), { code: 'DIRECTOR_DELIVERY_DEFERRED' });
        assert.equal(
          (await admin.query(`SELECT is_called FROM parallel_life.${name}`)).rows[0].is_called,
          true,
          'actual final request INSERT was reached while activity was live',
        );
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.agent_episode_requests`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
        await admin.query(`DROP SEQUENCE parallel_life.${name}`);
      }
      assert.equal(h.director().length, 1);
      const row = (await attempts(f))[0]!;
      assert.equal(row.status, 'response_received');
      assert.ok(row.sent_at);
      assert.ok(row.response_hash);
      assert.ok(Date.parse(row.lease_until) > Date.now() + 60000);
      await noDecision(f);
      assert.deepEqual(
        (
          await admin.query(
            'SELECT paused,managed,active_until<clock_timestamp() expired FROM parallel_life.world_clock WHERE world_id=$1',
            [f.id],
          )
        ).rows[0],
        { paused: false, managed: true, expired: true },
      );
      const before = await frozen(f);
      await h.advance();
      assert.deepEqual(await frozen(f), before);
      assert.equal(h.calls.length, 1);
      await activity.update(f.owner, f.id, {
        clientId: client,
        sequence: 1,
        mode: 'browsing',
        resume: true,
      });
      const result = await recoverDirectorAgent(
        { attempts: directors, parse: parseDirectorDecision },
        f.owner,
        await snap(f),
      );
      assert.equal(result.status, 'recovered');
      assert.equal(h.calls.length, 1);
      const done = (await attempts(f))[0]!;
      assert.equal(done.id, row.id);
      assert.equal(done.status, 'committed');
      assert.equal(done.response_hash, row.response_hash);
      assert.equal(done.response, row.response);
      assert.equal((await directors.readEpisodes(f.owner, f.id)).length, 1);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.agent_episode_requests WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'new authored time cause is also deferred during deep focus, and restored without consuming the qualification',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f);
      await at(f, time(10));
      const ready = await snap(f);
      assert.deepEqual(causeKeys(ready), ['a']);
      const restore = await boundary(f, 'focus');
      assert.equal((await wake(f)).deferred, true);
      await h.advance();
      assert.equal(h.director().length, 1);
      await restore();
      assert.equal((await snap(f)).evaluationCause!.id, ready.evaluationCause!.id);
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 2);
    },
  );
  await t.test(
    'paid invalid bootstrap is terminal and never receives a successor command on resume or later ticks',
    async () => {
      const f = await fixture(),
        h = harness(f, {
          response() {
            return 'EXPLICIT_LOCAL_INVALID_OUTPUT';
          },
        });
      await assert.rejects(h.advance(), { code: 'INVALID_DIRECTOR_PROPOSAL' });
      const original = (await attempts(f))[0]!;
      assert.equal(original.status, 'invalid_output');
      assert.ok(original.sent_at);
      assert.ok(original.response_hash);
      const restore = await boundary(f, 'pause');
      await h.advance();
      await restore();
      await at(f, time(9, 1));
      await h.advance();
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await attempts(f)).length, 1);
      assert.equal((await attempts(f))[0]!.command_id, original.command_id);
      assert.equal((await wake(f)).cause, null);
      await noDecision(f);
    },
  );
  await t.test(
    'paid stale bootstrap remains consumed while its captured author qualification still holds',
    async () => {
      const f = await fixture(),
        h = harness(f, {
          async response() {
            await worlds.saveNote(
              { userId: f.owner },
              {
                worldId: f.id,
                commandId: randomUUID(),
                expectedVersion: 0,
                title: '实际版本变化',
                text: '使原导演输入过时。',
              },
            );
            return JSON.stringify(quiet());
          },
        });
      await assert.rejects(h.advance(), { code: 'VERSION_CONFLICT' });
      const original = (await attempts(f))[0]!;
      assert.equal(original.status, 'stale_discarded');
      assert.ok(original.sent_at);
      assert.ok(original.response_hash);
      const restore = await boundary(f, 'focus');
      await h.advance();
      await restore();
      await h.advance();
      await at(f, time(9, 1));
      await h.advance();
      assert.equal(h.director().length, 1);
      assert.equal((await attempts(f)).length, 1);
      assert.equal(q(await snap(f), 'always').status, 'eligible');
      assert.equal((await wake(f)).cause, null);
      assert.deepEqual(await directors.readEpisodes(f.owner, f.id), []);
    },
  );
  await t.test(
    'unknown paid bootstrap preserves the original pending identity across inactivity and newer authored time causes',
    async () => {
      const f = await fixture(),
        h = harness(f, {
          response() {
            throw Error('EXPLICIT_LOCAL_DIRECTOR_UNKNOWN');
          },
        });
      await assert.rejects(h.advance(), /EXPLICIT_LOCAL_DIRECTOR_UNKNOWN/);
      const original = (await attempts(f))[0]!;
      assert.equal(original.status, 'unknown_after_send');
      assert.ok(original.sent_at);
      assert.equal(original.response_hash, null);
      const restore = await boundary(f, 'pause');
      await h.advance();
      await restore();
      await assert.rejects(h.advance(), { code: 'UNKNOWN' });
      await at(f, time(10));
      await assert.rejects(h.advance(), { code: 'UNKNOWN' });
      assert.equal(h.director().length, 1);
      const all = await attempts(f);
      assert.equal(all.length, 1);
      assert.equal(all[0]!.id, original.id);
      assert.equal(all[0]!.command_id, original.command_id);
      assert.equal(all[0]!.status, 'unknown_after_send');
    },
  );
  await t.test(
    'ordinary actual global change still coordinates under deep conversation without creating a new-opportunity cause',
    async () => {
      const f = await fixture(),
        h = await bootstrap(f),
        restore = await boundary(f, 'focus');
      const map = await space.read(f.owner, f.id);
      await space.travel(f.owner, f.id, {
        commandId: randomUUID(),
        expectedVersion: 0,
        routeId: map.routes[0]!.id,
      });
      const s = await snap(f);
      assert.equal(s.focus.length, 1);
      assert.equal(s.evaluationCause, undefined);
      assert.ok(s.changes.length > 0);
      await h.advance();
      assert.equal(h.director().length, 2);
      assert.equal(h.director()[1]!.payload.evaluationCause, undefined);
      assert.equal(h.director()[1]!.payload.focus.length, 1);
      assert.equal((await attempts(f)).at(-1)!.status, 'committed');
      await h.advance();
      assert.equal(h.director().length, 2);
      await restore();
    },
  );
  await t.test(
    'actual owner/worker/version/epoch fences reject without altering protected rows; immutable response cannot be replaced',
    async () => {
      const f = await fixture(),
        s = await snap(f),
        c = claim(s),
        other = randomUUID();
      await new IdentityRepository(app).ensureGuest(other);
      const before = await frozen(f);
      await assert.rejects(directors.claim(other, c, s), { code: 'NOT_FOUND' });
      await assert.rejects(new PostgresDirectorRuntimeRepository(worker).claim(f.owner, c, s), {
        code: 'NOT_FOUND',
      });
      const wrongV = { ...s, worldVersion: 1 };
      await assert.rejects(directors.claim(f.owner, claim(wrongV), wrongV), {
        code: 'VERSION_CONFLICT',
      });
      const wrongEpoch = { ...s, engineEpoch: 3 };
      await assert.rejects(directors.claim(f.owner, claim(wrongEpoch), wrongEpoch), {
        code: 'ENGINE_EPOCH_CONFLICT',
      });
      assert.deepEqual(await frozen(f), before);
      let { attempt } = await directors.claim(f.owner, c, s);
      attempt = await directors.mark(f.owner, attempt, 'request_sent');
      attempt = await directors.saveResponse(f.owner, attempt, JSON.stringify(quiet()));
      const captured = await frozen(f);
      await assert.rejects(directors.saveResponse(f.owner, attempt, 'different protected raw'), {
        code: 'DIRECTOR_RESPONSE_CONFLICT',
      });
      await assert.rejects(
        app.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET response='{}'::jsonb WHERE world_id=$1 AND id=$2",
            [f.id, attempt.id],
          ),
        ),
        { code: '23514' },
      );
      assert.deepEqual(await frozen(f), captured);
      const h = harness(f);
      await h.advance();
      assert.equal(h.calls.length, 0);
      assert.equal((await directors.lookup(f.owner, f.id, c.commandId))!.status, 'committed');
      assert.equal(
        (
          await worker.transaction(f.owner, (sql) =>
            sql.query('SELECT * FROM parallel_life.worlds WHERE id=$1', [f.id]),
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    'late episode insert fault rolls back the whole Director transaction; actual raw recovery and later committed replay do not repay',
    async () => {
      const f = await fixture(),
        h = harness(f, { propose: 'always' }),
        name = 'delivery72_late_' + randomUUID().replaceAll('-', '');
      await admin.query(
        `CREATE FUNCTION parallel_life.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'EXPLICIT_DELIVERY72_LATE_FAULT';END IF;RETURN NEW;END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON parallel_life.shared_episodes FOR EACH ROW EXECUTE FUNCTION parallel_life.${name}()`,
      );
      try {
        await assert.rejects(h.advance(), /EXPLICIT_DELIVERY72_LATE_FAULT/);
      } finally {
        await admin.query(`DROP TRIGGER ${name} ON parallel_life.shared_episodes`);
        await admin.query(`DROP FUNCTION parallel_life.${name}()`);
      }
      const row = (await attempts(f))[0]!;
      assert.equal(row.status, 'response_received');
      assert.ok(row.response_hash);
      assert.equal(h.calls.length, 1);
      await noDecision(f);
      const recovered = await recoverDirectorAgent(
        { attempts: directors, parse: parseDirectorDecision },
        f.owner,
        await snap(f),
      );
      assert.equal(recovered.status, 'recovered');
      if (recovered.status !== 'recovered') throw Error('Expected actual raw recovery');
      assert.equal(h.calls.length, 1);
      assert.equal(recovered.attempt.id, row.id);
      assert.equal(recovered.attempt.commandId, row.command_id);
      assert.equal(recovered.decision.opportunities.length, 1);
      assert.equal((await directors.readEpisodes(f.owner, f.id)).length, 1);
      assert.equal((await attempts(f)).length, 1);
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
      const restore = await boundary(f, 'pause');
      let replays = 0;
      const replay = await runDirectorAgent(
        {
          attempts: directors,
          parse: parseDirectorDecision,
          model: {
            async decide() {
              replays++;
              return quiet();
            },
          },
        },
        f.owner,
        recovered.attempt,
        row.snapshot,
      );
      assert.deepEqual(replay, recovered.decision);
      assert.equal(replays, 0);
      assert.equal(h.calls.length, 1);
      await restore();
    },
  );
  await t.test(
    'all delivery tests retain honest legacy ledgers and leave no temporary trigger functions',
    async () => {
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
      assert.equal(
        (await admin.query("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'delivery72_%'"))
          .rows[0].n,
        0,
      );
    },
  );
});
