import {
  runDirectorAgent,
  recoverDirectorAgent,
} from '../../src/modules/world/application/run-director-agent.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import { modelOutputTruncation } from '../../src/modules/ai/application/model-output-truncation.ts';
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
test('director truncation: atomic private evidence, no proposal execution, replay and network-unknown safety', async (t) => {
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

  const privateContent = '{"partial-private-director-output":';
  let calls = 0,
    parseCalls = 0;
  const model = new YibuTextModel(
    {
      apiKey: 'fixture-private-key',
      model: 'fixture',
      baseUrl: 'https://yibuapi.com',
      timeoutMs: 1000,
    },
    async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: privateContent }, finish_reason: 'length' }],
        usage: { completion_tokens: 4096 },
      });
    },
  );
  const deps = {
    attempts: repository,
    model: { decide: () => model.complete([{ role: 'user', content: 'synthetic' }]) },
    parse: () => {
      parseCalls++;
      throw Error('TRUNCATED_MUST_NOT_PARSE');
    },
  };
  await t.test(
    'known received truncation is atomically invalid, protected and never bought or executed twice',
    async () => {
      const f = await fixture(),
        input = command(f.snapshot);
      await assert.rejects(runDirectorAgent(deps, f.owner, input, f.snapshot), {
        code: 'TRUNCATED',
      });
      const row = (
        await admin.query('SELECT * FROM parallel_life.director_runtime_attempts WHERE id=$1', [
          input.id,
        ])
      ).rows[0];
      assert.equal(row.status, 'invalid_output');
      assert(row.response_hash);
      assert(row.sent_at);
      assert.equal(row.decision_id, null);
      assert.equal(row.response.content, privateContent);
      assert.equal(row.response.finish_reason, 'length');
      assert.deepEqual(row.response.usage, { completion_tokens: 4096 });
      assert.equal(
        (await repository.lookup(f.owner, f.id, input.commandId))?.status,
        'invalid_output',
      );
      const completion = await repository.readCompletion(f.owner, {
        ...input,
        status: 'invalid_output',
      });
      assert(completion.found);
      assert.equal(
        completion.response && (completion.response as { content: string }).content,
        privateContent,
      );
      await assert.rejects(
        repository.readCompletion(randomUUID(), { ...input, status: 'invalid_output' }),
      );
      await assert.rejects(runDirectorAgent(deps, f.owner, input, f.snapshot), {
        code: 'INVALID_STATE',
      });
      assert.equal((await recoverDirectorAgent(deps, f.owner, f.snapshot)).status, 'none');
      assert.deepEqual(await repository.readUnsentFrameAttempts(f.owner, f.snapshot), []);
      assert.equal(calls, 1);
      assert.equal(parseCalls, 0);
      for (const table of [
        'world_events',
        'world_messages',
        'director_decisions',
        'shared_episodes',
      ]) {
        const result = await admin.query(
          `SELECT count(*)::int AS n FROM parallel_life.${table} WHERE world_id=$1`,
          [f.id],
        );
        assert.equal(result.rows[0].n, 0, table);
      }
      assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, 0);
    },
  );
  await t.test(
    'a stop immediately after saving still leaves terminal evidence, not a pending parseable response',
    async () => {
      const f = await fixture();
      let attempt = await claimed(f);
      attempt = await repository.mark(f.owner, attempt, 'request_sent');
      let evidence: unknown;
      try {
        await model.complete([{ role: 'user', content: 'synthetic' }]);
      } catch (error) {
        evidence = modelOutputTruncation(error);
      }
      assert(evidence);
      const saved = await repository.saveResponse(f.owner, attempt, evidence);
      assert.equal(saved.status, 'invalid_output');
      assert.equal(
        (await repository.saveResponse(f.owner, attempt, evidence)).status,
        'invalid_output',
      );
      await assert.rejects(repository.saveResponse(f.owner, attempt, { different: true }), {
        code: 'DIRECTOR_RESPONSE_CONFLICT',
      });
      assert.equal((await recoverDirectorAgent(deps, f.owner, f.snapshot)).status, 'none');
      await assert.rejects(runDirectorAgent(deps, f.owner, attempt, f.snapshot), {
        code: 'INVALID_STATE',
      });
      assert.equal(calls, 2);
      assert.equal(parseCalls, 0);
    },
  );
  await t.test(
    'ordinary JSON cannot opt into transport classification; no-response network failures remain unknown',
    async () => {
      const f = await fixture();
      const a = await received(f, f.snapshot, {
        kind: 'model_output_truncated',
        schemaVersion: 1,
        finish_reason: 'length',
        content: 'model-authored',
        contentCharacters: 14,
        usage: null,
      });
      assert.equal(a.status, 'response_received');
      await repository.mark(f.owner, a, 'invalid_output');
      const other = await fixture(),
        input = command(other.snapshot);
      let failures = 0;
      const broken = {
        ...deps,
        model: {
          async decide() {
            failures++;
            throw Error('NETWORK_WITHOUT_RESPONSE');
          },
        },
      };
      await assert.rejects(
        runDirectorAgent(broken, other.owner, input, other.snapshot),
        /NETWORK_WITHOUT_RESPONSE/,
      );
      const row = (
        await admin.query(
          'SELECT status,response,response_hash FROM parallel_life.director_runtime_attempts WHERE id=$1',
          [input.id],
        )
      ).rows[0];
      assert.equal(row.status, 'unknown_after_send');
      assert.equal(row.response, null);
      assert.equal(row.response_hash, null);
      await assert.rejects(runDirectorAgent(broken, other.owner, input, other.snapshot), {
        code: 'UNKNOWN',
      });
      assert.equal(
        (await recoverDirectorAgent(broken, other.owner, other.snapshot)).status,
        'blocked',
      );
      assert.equal(failures, 1);
      assert.equal(parseCalls, 0);
    },
  );
});
