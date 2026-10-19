import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import type { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';
import {
  readActorMediaCompletionContextInTransaction,
  readActorStrategyBasis,
  validateActorMediaResultContextInTransaction,
} from '../../src/modules/world/infrastructure/agent-source-resolver.ts';
import { attachAgentWorldContext } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('own actual media completion enters native snapshots and revalidates independently of worldVersion', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ACTOR_MEDIA_CONTEXT_TEST_PORT ?? 55632));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
    );
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db),
    attempts = new PostgresAgentRuntimeRepository(db);
  async function fixture(speak = true) {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic media result world',
      time: '2026-10-15T08:00:00.000Z',
      actors: [
        { id: 'a', name: 'A', persona: 'Independent photographer' },
        { id: 'b', name: 'B', persona: 'Knows only own life' },
      ],
      messages: [],
      facts: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const actor of world.actors)
        await initializeActorAgentStateInTransaction(
          sql,
          owner,
          emptyActorAgentState(
            { worldId, actorId: actor.id },
            agentDefinitionRef(world, actor.id),
            0,
          ),
        );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    await new PostgresClockStore(db).setClock(owner, worldId, { paused: false, speed: 0 });
    const { receipt } = await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(worldId).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: world.time,
      origin: speak ? 'player' : 'wake',
      text: speak ? 'Would you like to take a picture?' : 'Evaluate your own scheduled media plan.',
    });
    const state = (await attempts.read(owner, { worldId, actorId: 'a' }))!,
      snapshot = (await readPrivateAgentSnapshot(db, owner, world, 'a', receipt, world.time, state))
        .snapshot;
    const proposal = {
      protocol: 'npc-wire-v3',
      consideration: null,
      mediaDecision: {
        kind: 'generate_image',
        goalSummary: 'Share one photograph',
        planSummary: 'Request one image and wait for actual result',
        parameters: {
          sceneDescription: 'An ordinary desk in this fictional world',
          purpose: 'scene',
        },
        basisSourceIds: [receipt.id],
      },
      executions: [],
      statements: speak
        ? [{ text: 'I will try taking a picture.', dependsOnActionIds: ['media:current'] }]
        : [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    };
    const committed = await runNpcAgent(
      {
        attempts,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel: new PostgresNpcAgentKernel(db, worlds),
      },
      owner,
      {
        id: randomUUID(),
        worldId,
        actorId: 'a',
        commandId: receipt.commandId,
        inputReceiptId: receipt.id,
        inputHash: receipt.inputHash,
        engineEpoch: 2,
        expectedWorldVersion: 0,
        expectedActorRevision: 0,
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 240000).toISOString(),
      },
      snapshot,
    );
    const requestId = committed.results[0]!.outputRefs![0]!.id;
    return { owner, worldId, requestId, committed, world };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  async function dispatch(f: F) {
    const result = await dispatchOutbox(
      new PostgresOutbox(db).ports(f.owner, { worldId: f.worldId, eventId: f.committed.eventId }),
    );
    assert.equal(result.submitted, 1);
    return (await queue.claimForOwner(result.taskIds[0]!, f.owner, ['media']))!;
  }
  async function complete(f: F, deliverToChat = true) {
    const lease = await dispatch(f),
      assetId = randomUUID();
    const pipeline: Partial<MediaPipelineService> = {
      async executeImagePipeline() {
        return {
          assetId,
          storageKey: 'synthetic/' + assetId,
          mimeType: 'image/webp',
          byteLength: 128,
          width: 8,
          height: 8,
          referenceAssetIds: [],
          prompt: 'Synthetic adapter only',
          providerTaskId: 'synthetic-provider',
          deliveryDecision: { approved: deliverToChat, deliverToChat, deliverToAlbum: true },
        };
      },
    };
    await createMediaPipelineHandler(queue, pipeline as MediaPipelineService)(lease);
    return { lease, assetId };
  }

  async function snapshot(f: F, actorId = 'a') {
    const world = (await worlds.get({ userId: f.owner }, f.worldId))!;
    const state = (await attempts.read(f.owner, { worldId: f.worldId, actorId }))!;
    return (await readPrivateAgentSnapshot(db, f.owner, world, actorId, null, world.time, state))
      .snapshot;
  }
  await t.test(
    'queued has no completion source; actual ready is visible without world version advance or state mutation',
    async () => {
      const f = await fixture();
      const queued = await snapshot(f);
      assert.equal(
        queued.sources.some((s) => s.id.startsWith('media-result:')),
        false,
      );
      const before = await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' });
      const { assetId } = await complete(f);
      const current = await snapshot(f);
      assert.equal(current.worldVersion, queued.worldVersion);
      const source = current.sources.find((s) => s.id.startsWith('media-result:'))!;
      assert.ok(source);
      assert.equal(source.kind, 'action_result');
      assert.equal(source.recordId, f.requestId);
      assert.equal(source.usage, 'private_strategy');
      assert.equal(
        source.at,
        f.world.time,
        'source timestamp remains original lineage, not a false completion time',
      );
      const observation = current.observations.find((o) => o.sourceId === source.id)!;
      assert.equal(observation.kind, 'result');
      const content = JSON.parse(observation.text);
      assert.equal(content.phase, 'completed');
      assert.equal(content.asset.id, assetId);
      assert.equal(content.observedAtStory, current.storyAt);
      assert.notEqual(content.completedAtReal, content.sourceStoryAt);
      assert.equal(content.chatProjection, 'eligible');
      assert.equal('prompt' in content, false);
      assert.equal('provenance' in content, false);
      assert.equal(
        current.viewState.goals[0]?.status,
        'active',
        'media reader must not fulfil goals',
      );
      assert.deepEqual(await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' }), before);
      assert.equal(
        (await snapshot(f, 'b')).sources.some((s) => s.id.startsWith('media-result:')),
        false,
      );
      await db.transaction(f.owner, (sql) =>
        validateActorMediaResultContextInTransaction(sql, f.owner, current),
      );
      const basis = await db.transaction(f.owner, (sql) =>
        readActorStrategyBasis(sql, f.owner, current.state, current.worldVersion, current.storyAt),
      );
      assert.deepEqual(
        basis.find((s) => s.id === source.id),
        source,
        'new own work need not first be copied into model-authored knowledge',
      );
      const groupContext = await attachAgentWorldContext(db, f.owner, {
        ...current,
        channel: { ...current.channel, kind: 'group', threadId: 'synthetic-context-only' },
        sources: current.sources.filter((s) => !s.id.startsWith('media-result:')),
        observations: [],
      });
      assert.equal(groupContext.sources.find((s) => s.id === source.id)?.usage, 'private_strategy');
      assert.equal(
        JSON.parse(groupContext.observations.find((o) => o.sourceId === source.id)!.text).asset.id,
        assetId,
      );
      const malformed = structuredClone(current);
      malformed.observations.find((o) => o.sourceId === source.id)!.text =
        'The user read the image.';
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          validateActorMediaResultContextInTransaction(sql, f.owner, malformed),
        ),
        { code: 'MEDIA_RESULT_SOURCE_CONFLICT' },
      );
    },
  );
  await t.test(
    'asset revision revocation during a model call invalidates selected source despite unchanged world version',
    async () => {
      const f = await fixture();
      const { assetId } = await complete(f);
      const current = await snapshot(f);
      await admin.query('UPDATE parallel_life.assets SET revision=revision+1 WHERE id=$1', [
        assetId,
      ]);
      assert.equal(
        (await worlds.get({ userId: f.owner }, f.worldId))!.version,
        current.worldVersion,
      );
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          validateActorMediaResultContextInTransaction(sql, f.owner, current),
        ),
        { code: 'MEDIA_RESULT_SOURCE_CONFLICT' },
      );
      assert.equal(
        (await snapshot(f)).sources.some((s) => s.id.startsWith('media-result:')),
        false,
      );
    },
  );
  await t.test(
    'unknown media and forged cross-actor metadata cannot become completed context',
    async () => {
      const f = await fixture();
      const lease = await dispatch(f);
      await admin.query("UPDATE parallel_life.tasks SET status='unknown' WHERE id=$1", [lease.id]);
      const current = await snapshot(f);
      assert.equal(
        current.sources.some((s) => s.id.startsWith('media-result:')),
        false,
      );
      const fake = structuredClone(current);
      fake.sources.push({
        id: 'media-result:' + 'a'.repeat(64),
        kind: 'action_result',
        recordId: f.requestId,
        worldVersion: 1,
        at: f.world.time,
        contentHash: 'a'.repeat(64),
        usage: 'private_strategy',
      });
      fake.observations.push({ sourceId: fake.sources.at(-1)!.id, kind: 'result', text: '{}' });
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          validateActorMediaResultContextInTransaction(sql, f.owner, fake),
        ),
        { code: 'MEDIA_RESULT_SOURCE_CONFLICT' },
      );
      const b = await snapshot(f, 'b');
      assert.deepEqual(
        await db.transaction(f.owner, (sql) =>
          readActorMediaCompletionContextInTransaction(sql, f.owner, b),
        ),
        { sources: [], observations: [] },
      );
    },
  );
});
