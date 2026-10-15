import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  projectCommittedWorldAwareness,
  PostgresWorldAwarenessRepository,
  markDirectorEvaluated,
} from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { worldBoundary } from '../../src/modules/world/domain/world-awareness.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import type {
  DirectorSnapshot,
  DirectorAttempt,
  DirectorDecision,
} from '../../src/modules/world/domain/director-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

// Actual local owner-RLS SQL and synthetic fictional snapshots/raw results, no model calls.
test('director persistence: protected finite attempts, complete observation range and atomic quiet/draft decisions', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.DIRECTOR_RUNTIME_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worker = new PostgresDatabase(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const repository = new PostgresDirectorRuntimeRepository(db),
    worlds = new PostgresWorldRepository(db);
  t.after(async () => {
    await db.close();
    await worker.close();
    await admin.end();
  });
  const story = '2026-10-15T08:00:00.000Z';
  async function fixture() {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const state: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Explicit director SQL fixture',
      time: story,
      actors: [
        { id: a, name: 'A', persona: '虚构人物 A' },
        { id: b, name: 'B', persona: '虚构人物 B' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: [
          {
            id: 'home',
            name: '虚构客厅',
            description: '',
            source,
            contactActorIds: [a],
            appointmentIds: [],
          },
          {
            id: 'shop',
            name: '虚构商店',
            description: '',
            source,
            contactActorIds: [b],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, state);
    const states = state.actors.map((actor) =>
      emptyActorAgentState({ worldId: id, actorId: actor.id }, 'authored:director-fixture', 0),
    );
    await db.transaction(owner, async (sql) => {
      for (const s of states) await initializeActorAgentStateInTransaction(sql, owner, s);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
    });
    const snapshot: DirectorSnapshot = {
      schemaVersion: 1,
      worldId: id,
      engineEpoch: 2,
      worldVersion: 0,
      storyAt: story,
      observedThroughVersion: 0,
      evaluatedThroughVersion: 0,
      boundary: worldBoundary(state, null),
      worldSetting: '仅虚构设定，不包含现实访谈',
      cast: state.actors,
      actorStates: states,
      episodes: [],
      candidates: [
        {
          id: 'candidate-a',
          worldId: id,
          actorId: a,
          source: 'conversation',
          episodeId: null,
          actionId: null,
          resourceIds: [],
          channel: 'private',
          threadId: a,
          sourceIds: ['source-a'],
          expectedWorldVersion: 0,
          expectedActorRevision: 0,
          priority: 1,
          reason: '明确的合成候选',
          requiresCoordination: false,
        },
      ],
      blockers: [],
      changes: [],
      observations: [
        { sourceId: 'source-a', text: 'A 已获准事实', kind: 'fact', knownByActorIds: [a] },
        {
          sourceId: 'private-b',
          text: 'GLOBAL_PRIVATE_SENTINEL',
          kind: 'belief',
          knownByActorIds: [b],
        },
      ],
      focus: [],
    };
    return { owner, id, a, b, snapshot };
  }
  function command(s: DirectorSnapshot) {
    return {
      id: randomUUID(),
      worldId: s.worldId,
      commandId: randomUUID(),
      engineEpoch: s.engineEpoch,
      expectedWorldVersion: s.worldVersion,
      inputHash: directorSnapshotInputHash(s),
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 60000).toISOString(),
    };
  }
  async function claimed(f: Awaited<ReturnType<typeof fixture>>, s = f.snapshot) {
    return (await repository.claim(f.owner, command(s), s)).attempt;
  }
  async function received(
    f: Awaited<ReturnType<typeof fixture>>,
    s = f.snapshot,
    response: unknown = { explicitSyntheticRaw: true },
  ) {
    let attempt = await claimed(f, s);
    attempt = await repository.mark(f.owner, attempt, 'request_sent');
    return repository.saveResponse(f.owner, attempt, response);
  }
  function decision(s: DirectorSnapshot, a: DirectorAttempt): DirectorDecision {
    return {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: s.worldId,
      engineEpoch: s.engineEpoch,
      worldVersion: s.worldVersion,
      inputHash: a.inputHash,
      evaluatedThroughVersion: s.observedThroughVersion,
      mode: 'quiet',
      selectedCandidateIds: [],
      deferred: s.candidates.map((c) => ({ candidateId: c.id, reason: '本次安静' })),
      nudges: [],
      opportunities: [],
      audit: { reason: 'GLOBAL_PRIVATE_SENTINEL', basisSourceIds: ['private-b'] },
    };
  }
  async function total(table: string, id: string) {
    assert.ok(
      [
        'director_runtime_attempts',
        'director_decisions',
        'shared_episodes',
        'world_events',
        'agent_attempts',
      ].includes(table),
    );
    return Number(
      (
        await admin.query(`SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`, [
          id,
        ])
      ).rows[0].n,
    );
  }
  async function addPending(f: Awaited<ReturnType<typeof fixture>>, n = 3) {
    for (let i = 0; i < n; i++)
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: `合成笔记${i}`,
          text: '实际原生玩家命令',
        },
      );
    const events = (
      await admin.query(
        'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
        [f.id],
      )
    ).rows;
    await db.transaction(f.owner, (sql) =>
      projectCommittedWorldAwareness(sql, f.owner, events.at(-1)!.payload),
    );
    // Explicit source-backed pending reasons exercise paging independently of event semantics.
    for (const { payload: e } of events)
      await admin.query(
        `INSERT INTO parallel_life.director_pending_reasons(world_id,owner_id,id,source_event_id,source_version,document)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(world_id,id) DO NOTHING`,
        [
          f.id,
          f.owner,
          'fixture:' + e.id,
          e.id,
          e.version,
          {
            id: 'fixture:' + e.id,
            eventId: e.id,
            worldVersion: e.version,
            kind: 'new_condition',
            ref: { kind: 'event', id: e.id },
          },
        ],
      );
    const s = structuredClone(f.snapshot);
    s.worldVersion = n;
    s.observedThroughVersion = n;
    s.boundary = (
      await admin.query(
        'SELECT document FROM parallel_life.world_awareness_boundaries WHERE world_id=$1',
        [f.id],
      )
    ).rows[0].document;
    s.candidates = s.candidates.map((c) => ({ ...c, expectedWorldVersion: n }));
    s.changes = (
      await admin.query(
        'SELECT document FROM parallel_life.director_pending_reasons WHERE world_id=$1 ORDER BY source_version,id',
        [f.id],
      )
    ).rows.map((r) => r.document);
    return s;
  }
  await t.test(
    'canonical snapshot hash is independent of object key order but protects every actual input field',
    async () => {
      const f = await fixture(),
        reordered = Object.fromEntries(Object.entries(f.snapshot).reverse()) as DirectorSnapshot;
      assert.equal(directorSnapshotInputHash(reordered), directorSnapshotInputHash(f.snapshot));
      assert.notEqual(
        directorSnapshotInputHash({ ...f.snapshot, worldSetting: 'changed' }),
        directorSnapshotInputHash(f.snapshot),
      );
      const input = command(f.snapshot);
      await assert.rejects(
        repository.claim(f.owner, { ...input, inputHash: '0'.repeat(64) }, f.snapshot),
        { code: 'INVALID_DIRECTOR_INPUT' },
      );
      assert.equal(await total('director_runtime_attempts', f.id), 0);
    },
  );
  await t.test(
    'actual reservation is replayed, captured original snapshot survives process restart and raw null is found',
    async () => {
      const f = await fixture(),
        input = command(f.snapshot);
      const first = await repository.claim(f.owner, input, f.snapshot);
      assert.equal(first.replay, false);
      assert.equal(
        (
          await repository.claim(
            f.owner,
            { ...input, id: randomUUID(), token: randomUUID() },
            f.snapshot,
          )
        ).replay,
        true,
      );
      assert.deepEqual(await repository.readCompletion(f.owner, first.attempt), { found: false });
      await repository.mark(f.owner, first.attempt, 'request_sent');
      const result = await repository.saveResponse(f.owner, first.attempt, null);
      assert.equal(result.status, 'response_received');
      const fresh = new PostgresDirectorRuntimeRepository(db),
        completion = await fresh.readCompletion(f.owner, result);
      assert.equal(completion.found, true);
      if (completion.found) {
        assert.deepEqual(completion.snapshot, f.snapshot);
        assert.equal(completion.response, null);
      }
      await assert.rejects(
        repository.claim(
          f.owner,
          {
            ...input,
            inputHash: directorSnapshotInputHash({ ...f.snapshot, worldSetting: 'changed' }),
          },
          { ...f.snapshot, worldSetting: 'changed' },
        ),
        { code: 'DIRECTOR_COMMAND_CONFLICT' },
      );
      await assert.rejects(repository.saveResponse(f.owner, result, { different: true }), {
        code: 'DIRECTOR_RESPONSE_CONFLICT',
      });
    },
  );
  await t.test(
    'quiet commits immutable real decision/cursor/attempt, creates no NPC/world event and returns original receipt',
    async () => {
      const f = await fixture(),
        a = await received(f),
        d = decision(f.snapshot, a);
      assert.deepEqual(await repository.commit(f.owner, a, f.snapshot, d), d);
      assert.deepEqual(await repository.readDecision(f.owner, f.id, d.id), d);
      assert.equal((await repository.lookup(f.owner, f.id, a.commandId))!.status, 'committed');
      assert.equal(await total('world_events', f.id), 0);
      assert.equal(await total('agent_attempts', f.id), 0);
      assert.equal(await total('shared_episodes', f.id), 0);
      const cursor = await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(
        f.owner,
        f.id,
      );
      assert.equal(cursor.lastEvaluation, 'quiet');
      assert.equal(cursor.evaluatedThroughVersion, 0);
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: '之后的真实玩家操作',
          text: '',
        },
      );
      assert.deepEqual(await repository.commit(f.owner, a, f.snapshot, d), d);
      await assert.rejects(
        repository.commit(f.owner, a, f.snapshot, {
          ...d,
          audit: { ...d.audit, reason: 'changed' },
        }),
        { code: 'DIRECTOR_DECISION_CONFLICT' },
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.director_decisions SET document=jsonb_set(document,'{mode}','\"coordinate\"') WHERE id=$1",
            [d.id],
          ),
        ),
        { code: '42501' },
      );
    },
  );
  await t.test(
    'global opportunity is only proposed episode with actual decision origin and no invented execution',
    async () => {
      const f = await fixture(),
        a = await received(f),
        d = decision(f.snapshot, a);
      d.mode = 'bounded_opportunity';
      d.opportunities = [
        {
          id: 'opportunity',
          title: '受保护的全局草案',
          description: '尚未发生的会面机会',
          playerImpact: '可以选择参与',
          participantActorIds: [f.a],
          placeIds: ['shop'],
          activity: 'meeting',
          basisSourceIds: ['source-a'],
        },
      ];
      await repository.commit(f.owner, a, f.snapshot, d);
      const [episode] = await repository.readEpisodes(f.owner, f.id);
      assert.equal(episode!.status, 'proposed');
      assert.equal(episode!.revision, 0);
      assert.deepEqual(episode!.origin, { kind: 'director', sourceId: d.id });
      assert.deepEqual(episode!.sourceEventIds, []);
      assert.deepEqual(episode!.resultIds, []);
      assert.deepEqual(episode!.unresolvedResponsibilityIds, []);
      assert.equal(await total('world_events', f.id), 0);
      assert.equal(await total('agent_attempts', f.id), 0);
      assert.doesNotMatch(JSON.stringify(d.nudges), /GLOBAL_PRIVATE_SENTINEL|受保护/);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.shared_episodes SET document=jsonb_set(document,'{status}','\"active\"') WHERE world_id=$1",
            [f.id],
          ),
        ),
        { code: '42501' },
      );
      await assert.rejects(
        admin.query(
          'INSERT INTO parallel_life.shared_episodes(world_id,owner_id,id,origin_decision_id,document) VALUES($1,$2,$3,$4,$5)',
          [f.id, f.owner, 'forged', d.id, { ...episode, id: 'forged' }],
        ),
        { code: '23514' },
      );
    },
  );
  await t.test(
    'every selected/deferred candidate is accounted for; nudge is typed and restricted to its actor/source subset',
    async () => {
      const f = await fixture(),
        a = await received(f),
        base = decision(f.snapshot, a);
      const coordinate = {
        ...base,
        mode: 'coordinate' as const,
        selectedCandidateIds: ['candidate-a'],
        deferred: [],
        nudges: [
          {
            actorId: f.a,
            candidateId: 'candidate-a',
            kind: 'respond_to_player' as const,
            basisSourceIds: ['source-a'],
          },
        ],
      };
      for (const bad of [
        { ...base, deferred: [] },
        { ...base, selectedCandidateIds: ['candidate-a'] },
        { ...coordinate, nudges: [{ ...coordinate.nudges[0]!, actorId: f.b }] },
        { ...coordinate, nudges: [{ ...coordinate.nudges[0]!, basisSourceIds: ['private-b'] }] },
        { ...coordinate, nudges: [{ ...coordinate.nudges[0]!, text: 'GLOBAL_PRIVATE_SENTINEL' }] },
      ])
        await assert.rejects(repository.commit(f.owner, a, f.snapshot, bad as DirectorDecision));
      assert.equal(await total('director_decisions', f.id), 0);
      await repository.commit(f.owner, a, f.snapshot, coordinate);
      assert.deepEqual(
        Object.keys(
          (await repository.readDecision(f.owner, f.id, coordinate.id))!.nudges[0]!,
        ).sort(),
        ['actorId', 'basisSourceIds', 'candidateId', 'kind'],
      );
    },
  );
  await t.test(
    'opportunity cannot add important actor/place/activity/source or fabricate active episode through output extras',
    async () => {
      const f = await fixture(),
        a = await received(f),
        base = decision(f.snapshot, a);
      base.mode = 'bounded_opportunity';
      const opportunity = {
        id: 'op',
        title: '机会',
        description: '尚未发生',
        playerImpact: '自己决定',
        participantActorIds: [f.a],
        placeIds: ['shop'],
        activity: 'conversation' as const,
        basisSourceIds: ['source-a'],
      };
      for (const bad of [
        { ...opportunity, participantActorIds: ['new-important-person'] },
        { ...opportunity, placeIds: ['new-place'] },
        { ...opportunity, activity: 'execute_arbitrary' },
        { ...opportunity, basisSourceIds: ['private-real-interview'] },
        { ...opportunity, status: 'active' },
      ])
        await assert.rejects(
          repository.commit(f.owner, a, f.snapshot, {
            ...base,
            opportunities: [bad],
          } as DirectorDecision),
        );
      assert.equal(await total('shared_episodes', f.id), 0);
      assert.equal(await total('director_decisions', f.id), 0);
    },
  );
  await t.test(
    'complete pending range is required beyond a read page and evaluated cursor advances atomically to observed only',
    async () => {
      const f = await fixture(),
        s = await addPending(f, 3),
        page = structuredClone(s);
      page.changes = page.changes.slice(0, 1);
      await assert.rejects(repository.claim(f.owner, command(page), page), {
        code: 'DIRECTOR_PENDING_RANGE_INCOMPLETE',
      });
      const a = await received(f, s),
        d = decision(s, a);
      await assert.rejects(repository.commit(f.owner, a, s, { ...d, evaluatedThroughVersion: 2 }), {
        code: 'INVALID_DIRECTOR_DECISION',
      });
      await repository.commit(f.owner, a, s, d);
      const read = await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(
        f.owner,
        f.id,
        { limit: 1 },
      );
      assert.equal(read.observedThroughVersion, 3);
      assert.equal(read.evaluatedThroughVersion, 3);
      assert.equal(read.needsEvaluation, false);
      assert.equal(await total('world_events', f.id), 3);
    },
  );
  await t.test(
    'default fifty-row page cannot skip pending work and a concurrent evaluated cursor invalidates the old decision',
    async () => {
      const f = await fixture(),
        s = await addPending(f, 51);
      const page = await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(
        f.owner,
        f.id,
      );
      assert.equal(page.pendingReasons.length, 50);
      assert.ok(page.nextCursor);
      const truncated = { ...s, changes: page.pendingReasons };
      await assert.rejects(repository.claim(f.owner, command(truncated), truncated), {
        code: 'DIRECTOR_PENDING_RANGE_INCOMPLETE',
      });
      const a = await received(f, s),
        d = decision(s, a);
      await db.transaction(f.owner, (sql) =>
        markDirectorEvaluated(sql, f.owner, f.id, {
          expectedObservedThroughVersion: 51,
          throughVersion: 1,
          result: 'quiet',
        }),
      );
      await assert.rejects(repository.commit(f.owner, a, s, d), {
        code: 'DIRECTOR_CURSOR_CONFLICT',
      });
      assert.equal(await total('director_decisions', f.id), 0);
      assert.equal((await repository.readCompletion(f.owner, a)).found, true);
      assert.equal(
        (await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(f.owner, f.id))
          .evaluatedThroughVersion,
        1,
      );
    },
  );
  await t.test(
    'stale actor, candidate CAS, boundary/cast/clock/current cursor and missing observer cannot reserve a model call',
    async () => {
      for (const kind of ['actor', 'candidate', 'boundary', 'cast', 'clock'] as const) {
        const f = await fixture(),
          s = structuredClone(f.snapshot);
        if (kind === 'actor') s.actorStates[0]!.revision++;
        if (kind === 'candidate') s.candidates[0]!.expectedActorRevision++;
        if (kind === 'boundary') s.boundary.placeIds.push('hidden-place');
        if (kind === 'cast') s.cast![0]!.persona = 'not actual fictional persona';
        if (kind === 'clock') s.storyAt = '2026-10-16T08:00:00.000Z';
        await assert.rejects(repository.claim(f.owner, command(s), s));
        assert.equal(await total('director_runtime_attempts', f.id), 0);
      }
      const f = await fixture();
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: 'not observed',
          text: '',
        },
      );
      const s = {
        ...f.snapshot,
        worldVersion: 1,
        candidates: f.snapshot.candidates.map((c) => ({ ...c, expectedWorldVersion: 1 })),
      };
      await assert.rejects(repository.claim(f.owner, command(s), s), {
        code: 'DIRECTOR_CURSOR_CONFLICT',
      });
    },
  );
  await t.test(
    'unknown is durable and blocks a new director attempt; reliable late response recovers without any retry',
    async () => {
      const f = await fixture();
      let a = await claimed(f);
      a = await repository.mark(f.owner, a, 'request_sent');
      a = await repository.mark(f.owner, a, 'unknown_after_send');
      assert.equal(
        (await repository.lookup(f.owner, f.id, a.commandId))!.status,
        'unknown_after_send',
      );
      await assert.rejects(repository.claim(f.owner, command(f.snapshot), f.snapshot), {
        code: 'DIRECTOR_ATTEMPT_PENDING',
      });
      await assert.rejects(
        repository.mark(f.owner, a, 'request_sent'),
        /INVALID_ATTEMPT_TRANSITION/,
      );
      a = await repository.saveResponse(f.owner, a, { explicitKnownLateRaw: true });
      assert.equal(a.status, 'response_received');
      await repository.commit(f.owner, a, f.snapshot, decision(f.snapshot, a));
      assert.equal(await total('director_runtime_attempts', f.id), 1);
    },
  );
  await t.test(
    'expired after send keeps original raw as stale but cannot commit or masquerade as unknown',
    async () => {
      const f = await fixture(),
        input = { ...command(f.snapshot), leaseUntil: new Date(Date.now() + 500).toISOString() };
      let a = (await repository.claim(f.owner, input, f.snapshot)).attempt;
      a = await repository.mark(f.owner, a, 'request_sent');
      await admin.query('SELECT pg_sleep(0.6)');
      a = await repository.saveResponse(f.owner, a, { explicitExpiredRaw: true });
      assert.equal(a.status, 'stale_discarded');
      assert.equal((await repository.readCompletion(f.owner, a)).found, true);
      await assert.rejects(repository.commit(f.owner, a, f.snapshot, decision(f.snapshot, a)), {
        code: 'DIRECTOR_ATTEMPT_STALE',
      });
    },
  );
  await t.test(
    'known invalid response is recorded, cancellation before send has no response and illegal terminal marks are refused',
    async () => {
      const f = await fixture(),
        a = await claimed(f);
      await assert.rejects(repository.saveResponse(f.owner, a, { neverSent: true }), {
        code: 'INVALID_DIRECTOR_TRANSITION',
      });
      await assert.rejects(repository.mark(f.owner, a, 'response_received'), {
        code: 'ATOMIC_DIRECTOR_COMMIT_REQUIRED',
      });
      await assert.rejects(repository.mark(f.owner, a, 'committed'), {
        code: 'ATOMIC_DIRECTOR_COMMIT_REQUIRED',
      });
      assert.equal(
        (await repository.mark(f.owner, a, 'cancelled_before_send')).status,
        'cancelled_before_send',
      );
      let b = await claimed(f);
      b = await repository.mark(f.owner, b, 'request_sent');
      b = await repository.saveResponse(f.owner, b, undefined);
      assert.equal(b.status, 'invalid_output');
      assert.equal((await repository.readCompletion(f.owner, b)).found, true);
    },
  );
  await t.test(
    'world version changes before response retain stale raw; current owner/version/token/epoch fences prevent commit',
    async () => {
      const f = await fixture();
      let a = await claimed(f);
      a = await repository.mark(f.owner, a, 'request_sent');
      await worlds.saveNote(
        { userId: f.owner },
        {
          worldId: f.id,
          commandId: randomUUID(),
          expectedVersion: 0,
          title: 'new event',
          text: '',
        },
      );
      a = await repository.saveResponse(f.owner, a, { knownButOldSnapshot: true });
      assert.equal(a.status, 'stale_discarded');
      await assert.rejects(repository.readCompletion(f.owner, { ...a, token: randomUUID() }), {
        code: 'DIRECTOR_ATTEMPT_STALE',
      });
      const other = await fixture();
      await assert.rejects(repository.readCompletion(other.owner, a), { code: 'NOT_FOUND' });
      const fresh = await fixture(),
        b = await received(fresh);
      await db.transaction(fresh.owner, (sql) =>
        switchAgentEngineEpochInTransaction(sql, fresh.owner, {
          worldId: fresh.id,
          expectedWorldVersion: 0,
          expectedEpoch: 2,
          nextEpoch: 3,
        }),
      );
      await assert.rejects(
        repository.commit(fresh.owner, b, fresh.snapshot, decision(fresh.snapshot, b)),
        { code: 'ENGINE_EPOCH_CONFLICT' },
      );
    },
  );
  await t.test(
    'SQL failure after decision/episode insert rolls back cursor, receipt, draft and attempt together',
    async () => {
      const f = await fixture(),
        a = await received(f),
        d = decision(f.snapshot, a);
      d.mode = 'bounded_opportunity';
      d.opportunities = [
        {
          id: 'rollback-op',
          title: '待撤回',
          description: '尚未发生',
          playerImpact: '合成SQL',
          participantActorIds: [f.a],
          placeIds: [],
          activity: 'follow_up',
          basisSourceIds: ['source-a'],
        },
      ];
      const guard = 'director_fixture_fail_' + randomUUID().replaceAll('-', '');
      await admin.query(
        `CREATE FUNCTION parallel_life.${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'DIRECTOR_INJECTED_FAILURE'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${guard} BEFORE UPDATE ON parallel_life.director_observed_states FOR EACH ROW EXECUTE FUNCTION parallel_life.${guard}()`,
      );
      try {
        await assert.rejects(
          repository.commit(f.owner, a, f.snapshot, d),
          /DIRECTOR_INJECTED_FAILURE/,
        );
      } finally {
        await admin.query(`DROP TRIGGER ${guard} ON parallel_life.director_observed_states`);
        await admin.query(`DROP FUNCTION parallel_life.${guard}()`);
      }
      assert.equal(await total('director_decisions', f.id), 0);
      assert.equal(await total('shared_episodes', f.id), 0);
      assert.equal(
        (await repository.lookup(f.owner, f.id, a.commandId))!.status,
        'response_received',
      );
      await repository.commit(f.owner, a, f.snapshot, d);
      assert.equal(await total('shared_episodes', f.id), 1);
    },
  );
  await t.test(
    'protected capture is detached from caller mutation of unknown-typed state children and lease arguments',
    async () => {
      const f = await fixture(),
        state = f.snapshot.actorStates[0]!;
      state.goals = [
        {
          id: 'g',
          summary: 'original fictional goal',
          status: 'active',
          sourceIds: ['source-a'],
          resultIds: [],
        },
      ];
      await db.transaction(f.owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.actor_agent_states SET document=$3 WHERE world_id=$1 AND actor_id=$2',
          [f.id, f.a, state],
        ),
      );
      const input = command(f.snapshot),
        token = input.token,
        pending = repository.claim(f.owner, input, f.snapshot);
      input.token = randomUUID();
      state.goals[0]!.summary = 'MUTATED_AFTER_CALL';
      const reserved = await pending;
      assert.equal(reserved.attempt.token, token);
      await repository.mark(f.owner, reserved.attempt, 'request_sent');
      const received = await repository.saveResponse(f.owner, reserved.attempt, {
        explicitKnownRaw: true,
      });
      const completion = await repository.readCompletion(f.owner, received);
      assert.equal(completion.found, true);
      if (completion.found)
        assert.equal(
          completion.snapshot.actorStates[0]!.goals[0]!.summary,
          'original fictional goal',
        );
    },
  );
  await t.test(
    'lease expiring during final SQL rolls back decision, evaluated cursor and draft before terminal receipt',
    async () => {
      const f = await fixture(),
        input = { ...command(f.snapshot), leaseUntil: new Date(Date.now() + 500).toISOString() };
      let a = (await repository.claim(f.owner, input, f.snapshot)).attempt;
      a = await repository.mark(f.owner, a, 'request_sent');
      a = await repository.saveResponse(f.owner, a, { explicitKnownRaw: true });
      const d = decision(f.snapshot, a),
        guard = 'director_expiry_fixture_' + randomUUID().replaceAll('-', '');
      await admin.query(
        `CREATE FUNCTION parallel_life.${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN PERFORM pg_sleep(0.6); END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${guard} BEFORE UPDATE ON parallel_life.director_observed_states FOR EACH ROW EXECUTE FUNCTION parallel_life.${guard}()`,
      );
      try {
        await assert.rejects(repository.commit(f.owner, a, f.snapshot, d), {
          code: 'DIRECTOR_ATTEMPT_STALE',
        });
      } finally {
        await admin.query(`DROP TRIGGER ${guard} ON parallel_life.director_observed_states`);
        await admin.query(`DROP FUNCTION parallel_life.${guard}()`);
      }
      assert.equal(await total('director_decisions', f.id), 0);
      assert.equal(
        (await repository.lookup(f.owner, f.id, a.commandId))!.status,
        'response_received',
      );
      assert.equal(
        (await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(f.owner, f.id))
          .lastEvaluation,
        null,
      );
    },
  );
  await t.test(
    'owner RLS and actual app role isolate protected snapshots/raw/audit; worker has no new grants',
    async () => {
      const f = await fixture(),
        foreign = await fixture(),
        a = await received(f),
        d = decision(f.snapshot, a);
      await repository.commit(f.owner, a, f.snapshot, d);
      for (const table of ['director_runtime_attempts', 'director_decisions', 'shared_episodes']) {
        assert.equal(
          (
            await db.transaction(foreign.owner, (sql) =>
              sql.query(`SELECT * FROM parallel_life.${table} WHERE world_id=$1`, [f.id]),
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await admin.query('SELECT has_table_privilege($1,$2,$3) ok', [
              'pl_worker',
              'parallel_life.' + table,
              'SELECT',
            ])
          ).rows[0].ok,
          false,
        );
      }
      await assert.rejects(
        new PostgresDirectorRuntimeRepository(worker).lookup(f.owner, f.id, a.commandId),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(repository.readDecision(foreign.owner, f.id, d.id), {
        code: 'NOT_FOUND',
      });
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          sql.query(
            "UPDATE parallel_life.director_runtime_attempts SET snapshot=jsonb_set(snapshot,'{worldSetting}','\"rewrite\"') WHERE id=$1",
            [a.id],
          ),
        ),
        { code: '23514' },
      );
    },
  );
});
