import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { MemoryRepository } from '../../src/modules/memory/infrastructure/memory-repository.ts';
import { forgetMemoryInStore } from '../../src/modules/memory/infrastructure/memory-store.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
  type AgentSource,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { ConsumedSceneObservationSource } from '../../src/modules/world/domain/actor-observation-candidate.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { readNativeAgentSnapshot } from '../../src/modules/world/infrastructure/agent-channel-snapshot.ts';
import { readActorSceneObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-scene-observation-sources.ts';
import { readConsumedSceneObservationSourcesInTransaction as consumed } from '../../src/modules/world/infrastructure/actor-observation-consumption-repository.ts';
import { collectPendingSceneObservationCandidates as candidates } from '../../src/modules/world/domain/actor-observation-candidate.ts';
import { withLeasedAgentDatabase } from '../../src/modules/world/infrastructure/leased-agent-database.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { NpcAgentModel } from '../../src/modules/world/infrastructure/npc-agent-model.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  finishNativeAgentTask,
  nativeAgentCommandId,
} from '../../src/server/npc-agent-channel-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
import { nativeNpcTaskHandler } from '../../src/server/npc-agent-channel-services.ts';

test('only actual supplied scene context in a successful original NPC commit is consumed (real PG, controlled gateway)', async (t) => {
  const cfg = await localConfig();
  const port = Number(process.env.ACTOR_OBSERVATION_CONSUMPTION_TEST_PORT ?? 55565);
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
  assert.equal(cfg.port, port);
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    scenes = new SceneRepository(db),
    tasks = new TaskRepository(db);
  const generated: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    try {
      for (const f of generated)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.worldId, f.owner],
        );
    } finally {
      await queue.close();
      await db.close();
      await admin.end();
    }
  });
  type Fixture = { owner: string; worldId: string; a: string; b: string; sceneId: string };
  async function input(f: Fixture, text: string) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const commandId = randomUUID();
    const value = await scenes.input(f.owner, f.worldId, f.sceneId, {
      commandId,
      expectedVersion: world.version,
      text,
      relatedMatterIds: [],
    });
    return { ...value, commandId };
  }
  async function fixture(large = false): Promise<Fixture> {
    const owner = randomUUID(),
      worldId = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    generated.push({ owner, worldId });
    await new IdentityRepository(db).ensureGuest(owner);
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const initial: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Actual scene supplied-context fixture',
      time: new Date().toISOString(),
      actors: [
        { id: a, name: '甲', persona: '只知本人获准来源。' },
        { id: b, name: '乙', persona: '不在现场。' },
      ],
      facts: large
        ? Array.from({ length: 10 }, (_, i) => ({
            id: randomUUID(),
            text: 'Explicit authored budget fixture ' + i + ': ' + 'X'.repeat(1800),
            visibility: { kind: 'world' as const },
            sourceEventId: 'genesis:' + worldId,
            kind: 'canonical' as const,
          }))
        : [],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'room',
        positionSource: source,
        places: [
          {
            id: 'room',
            name: 'Room',
            description: 'Explicit historical fixture',
            source,
            contactActorIds: [a],
            appointmentIds: [],
          },
        ],
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, initial);
    const entered = await scenes.enterPlace(owner, worldId, {
      commandId: randomUUID(),
      expectedVersion: 0,
      placeId: 'room',
    });
    const lease = await queue.claimForOwner(entered.task!.id, owner, ['world']);
    assert.ok(lease);
    const version = await db.transaction(owner, (sql) =>
      commitSceneProposal(
        sql,
        owner,
        worldId,
        lease.input as Parameters<typeof commitSceneProposal>[3],
        {
          location: 'Room',
          narration: '窗边有一把椅子。',
          presentActorIds: [a],
          outcome: null,
          observation: null,
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [],
          stepProposals: [],
          npcActions: [],
        },
        randomUUID(),
      ),
    );
    await queue.finish(lease, { status: 'succeeded', resultVersion: version });
    const f = { owner, worldId, a, b, sceneId: entered.sceneId };
    if (large)
      for (let i = 0; i < 9; i++) {
        const history = await input(f, '我打算记下第' + i + '段：' + '获准原文'.repeat(350));
        if (history.task) await tasks.cancel(owner, history.task.id);
      }
    const world = await worlds.get({ userId: owner }, worldId);
    await db.transaction(owner, async (sql) => {
      for (const actorId of [a, b])
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId },
            agentDefinitionRef(world, actorId),
            world.version,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: world.version,
      });
      const event = (
        await sql.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND version=$2',
          [worldId, world.version],
        )
      ).rows[0].payload;
      await projectCommittedWorldAwareness(sql, owner, event);
    });
    return f;
  }
  async function refs(f: Fixture, actorId = f.a) {
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    return db.transaction(f.owner, (sql) =>
      consumed(sql, f.owner, {
        worldId: f.worldId,
        actorId,
        engineEpoch: 2,
        worldVersion: world.version,
      }),
    );
  }
  async function execution(
    f: Fixture,
    mode: 'reply' | 'legacy' | 'unknown' | 'invalid' | 'stale' = 'reply',
    fault = false,
  ) {
    const accepted = await input(f, '@甲 你听到了吗？');
    const lease = await queue.claimForOwner(accepted.task!.id, f.owner, ['world']);
    assert.ok(lease);
    const scoped = withLeasedAgentDatabase(db, lease);
    const store = new PostgresAgentRuntimeRepository(scoped);
    const world = await worlds.get({ userId: f.owner }, f.worldId);
    const receipt = (
      await db.transaction(f.owner, (sql) =>
        sql.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND command_id=$2',
          [f.worldId, accepted.commandId],
        ),
      )
    ).rows[0].document as AgentInputReceipt;
    const state = (await store.read(f.owner, { worldId: f.worldId, actorId: f.a }))!;
    const snapshot = await readNativeAgentSnapshot(
      scoped,
      f.owner,
      world,
      f.a,
      receipt,
      world.time,
      state,
    );
    let calls = 0;
    let messages: unknown;
    let failAfterCommit = fault;
    const gateway: TextModel = {
      async complete(actual) {
        calls++;
        messages = structuredClone(actual);
        if (mode === 'unknown') throw Error('EXPLICIT_CONTROLLED_GATEWAY_UNKNOWN');
        if (mode === 'invalid') return 'EXPLICIT_CONTROLLED_INVALID_JSON';
        if (mode === 'stale') {
          const source = snapshot.sources.find((s) => s.kind === 'scene_entry')!;
          const memory = await new MemoryRepository(db).create(f.owner, {
            id: randomUUID(),
            ownerId: f.owner,
            scopeType: 'character',
            scopeId: f.a,
            branchId: f.worldId,
            characterId: f.a,
            text: 'Forget this actual scene source',
            kind: 'belief',
            sourceType: 'agent_inference',
            sourceIds: [source.id],
            status: 'active',
            importance: 5,
            createdAt: new Date().toISOString(),
          });
          await db.transaction(f.owner, (sql) =>
            forgetMemoryInStore(sql, {
              ownerId: f.owner,
              targetMemoryId: memory.id,
              playerVisibleOnly: false,
            }),
          );
        }
        return JSON.stringify({
          statements: [{ text: '我听到了，先保留自己的判断。', dependsOnActionIds: [] }],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        });
      },
    };
    const model = new NpcAgentModel(gateway);
    const kernel = new PostgresNpcAgentKernel(
      scoped,
      new PostgresWorldRepository(scoped),
      async (sql, value) => {
        if (failAfterCommit) throw Error('EXPLICIT_CONTROLLED_COMMIT_ROLLBACK');
        await finishNativeAgentTask(sql, f.owner, lease, value.attempt, value.eventId);
      },
    );
    const deps = {
      attempts: store,
      kernel,
      model:
        mode === 'legacy'
          ? { validateInput: model.validateInput.bind(model), decide: model.decide.bind(model) }
          : model,
    };
    const claim = {
      id: randomUUID(),
      worldId: f.worldId,
      actorId: f.a,
      commandId: nativeAgentCommandId(lease.id, f.a),
      inputReceiptId: receipt.id,
      inputHash: receipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: world.version,
      expectedActorRevision: state.revision,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    };
    return {
      snapshot,
      claim,
      store,
      lease,
      gateway,
      invoke: () => runNpcAgent(deps, f.owner, claim, snapshot),
      recover: () => {
        failAfterCommit = false;
        return runNpcAgent(deps, f.owner, claim, null);
      },
      calls: () => calls,
      messages: () => messages,
      row: async () =>
        (await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1', [claim.id]))
          .rows[0],
    };
  }

  await t.test(
    'successful original envelope certifies exact actual messages; another actor gets no ACK',
    async () => {
      const f = await fixture();
      const e = await execution(f);
      await e.invoke();
      const row = await e.row();
      assert.equal(row.status, 'committed');
      assert.equal(
        row.response.suppliedContext.modelInputHash,
        createHash('sha256').update(JSON.stringify(e.messages())).digest('hex'),
      );
      assert.ok(row.response.suppliedContext.observations.length > 0);
      assert.deepEqual(
        await refs(f),
        [...row.response.suppliedContext.observations].sort((a, b) =>
          a.sourceId.localeCompare(b.sourceId),
        ),
      );
      assert.deepEqual(await refs(f, f.b), []);
      const before = await refs(f);
      assert.deepEqual(await refs(f), before);
      assert.equal(e.calls(), 1);
      const tampered = structuredClone(row.response);
      tampered.suppliedContext.observations[0].contentHash = 'f'.repeat(64);
      await assert.rejects(
        admin.query('UPDATE parallel_life.agent_attempts SET response=$2 WHERE id=$1', [
          row.id,
          tampered,
        ]),
        { code: '23514' },
      );
      assert.deepEqual(await refs(f), before);
    },
  );

  await t.test(
    'the actual native task handler preserves the same final-model manifest',
    async () => {
      const f = await fixture();
      const e = await execution(f);
      assert.equal(
        await nativeNpcTaskHandler(db, () => e.gateway)(e.lease, new AbortController().signal),
        true,
      );
      const row = (
        await admin.query(
          'SELECT response FROM parallel_life.agent_attempts WHERE world_id=$1 AND command_id=$2',
          [f.worldId, e.claim.commandId],
        )
      ).rows[0];
      assert.equal(
        row.response.suppliedContext.modelInputHash,
        createHash('sha256').update(JSON.stringify(e.messages())).digest('hex'),
      );
      assert.ok((await refs(f)).length > 0);
      assert.equal(e.calls(), 1);
    },
  );

  await t.test(
    'legacy success and selected source lists without actual manifest are not ACKs',
    async () => {
      const f = await fixture();
      const e = await execution(f, 'legacy');
      await e.invoke();
      assert.equal((await e.row()).status, 'committed');
      assert.ok(
        (await e.row()).response.snapshot.sceneObservationContext.selectedSourceIds.length > 0,
      );
      assert.equal((await e.row()).response.suppliedContext, undefined);
      assert.deepEqual(await refs(f), []);
    },
  );

  await t.test(
    'actual final prepare omissions stay pending despite advanced actor version',
    async () => {
      const f = await fixture(true);
      const e = await execution(f);
      await e.invoke();
      const row = await e.row();
      const supplied = row.response.suppliedContext
        .observations as ConsumedSceneObservationSource[];
      const snapshotSources = (row.response.snapshot.sources as AgentSource[]).filter(
        (s) => s.kind === 'scene_entry',
      );
      const omitted = snapshotSources.filter((s) => !supplied.some((ref) => ref.sourceId === s.id));
      assert.ok(
        omitted.length > 0,
        'fixture must actually cause final model observation budget trimming',
      );
      const consumedRefs = await refs(f);
      assert.ok(omitted.every((s) => !consumedRefs.some((ref) => ref.sourceId === s.id)));
      const world = await worlds.get({ userId: f.owner }, f.worldId);
      const pending = await candidates({
        worldId: f.worldId,
        actorId: f.a,
        engineEpoch: 2,
        worldVersion: world.version,
        actorRevision: 1,
        storyAt: world.time,
        sources: snapshotSources,
        consumed: consumedRefs,
      });
      assert.deepEqual(pending.map((c) => c.sourceIds[0]).sort(), omitted.map((s) => s.id).sort());
      assert.ok(
        row.response.snapshot.state.projectedWorldVersion >=
          Math.min(...omitted.map((s) => s.worldVersion)),
      );
    },
  );

  for (const mode of ['unknown', 'invalid', 'stale'] as const)
    await t.test(
      `${mode} original paid attempt cannot consume or silently repurchase`,
      async () => {
        const f = await fixture();
        const e = await execution(f, mode);
        await assert.rejects(e.invoke());
        assert.equal(
          (await e.row()).status,
          mode === 'unknown'
            ? 'unknown_after_send'
            : mode === 'invalid'
              ? 'invalid_output'
              : 'stale_discarded',
        );
        assert.deepEqual(await refs(f), []);
        await assert.rejects(e.recover());
        assert.equal(e.calls(), 1);
      },
    );

  await t.test(
    'received raw is not consumed before commit and recovers with zero extra model calls',
    async () => {
      const f = await fixture();
      const e = await execution(f, 'reply', true);
      await assert.rejects(e.invoke(), /EXPLICIT_CONTROLLED_COMMIT_ROLLBACK/);
      const saved = await e.row();
      assert.equal(saved.status, 'response_received');
      assert.ok(saved.response.suppliedContext.observations.length > 0);
      assert.deepEqual(await refs(f), []);
      await e.recover();
      assert.equal((await e.row()).response_hash, saved.response_hash);
      assert.ok((await refs(f)).length > 0);
      assert.equal(e.calls(), 1);
    },
  );
});
