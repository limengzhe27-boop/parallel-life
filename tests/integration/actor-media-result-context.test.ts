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
  PostgresActorMediaResultContextRepository,
  requireActorMediaResultContextInTransaction,
} from '../../src/modules/world/infrastructure/actor-media-result-context-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('actual native enqueue and leased media completion provide isolated source-backed external results', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.ACTOR_MEDIA_RESULTS_TEST_PORT ?? 55630));
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
    attempts = new PostgresAgentRuntimeRepository(db),
    repo = new PostgresActorMediaResultContextRepository(db);
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
  const read = (f: F, actorId = 'a') =>
    repo.read(f.owner, { worldId: f.worldId, actorId, engineEpoch: 2, worldVersion: 1 });
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
  await t.test(
    'enqueue is not completion; actual handler/task/asset success yields stable auditable result without goal mutation',
    async () => {
      const f = await fixture(),
        before = (await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' }))!;
      assert.equal(f.committed.results[0]!.outcome, 'succeeded');
      assert.deepEqual(f.committed.results[0]!.completedGoalIds, []);
      assert.equal((await read(f)).completed.length, 0);
      assert.equal((await read(f)).pending[0]!.phase, 'queued');
      const { assetId, lease } = await complete(f);
      const view = await read(f);
      assert.equal(view.pending.length, 0);
      assert.equal(view.completed.length, 1);
      const c = view.completed[0]!;
      assert.equal(c.asset.id, assetId);
      assert.equal(c.asset.revision, 1);
      assert.equal(c.provenance.taskId, lease.id);
      assert.equal(c.source.sourceWorldVersion, 1);
      assert.equal(c.requestedAtStory, f.world.time);
      assert.ok(Number.isFinite(Date.parse(c.completedAtReal)));
      assert.notEqual(c.completedAtReal, c.requestedAtStory);
      assert.equal(c.chatProjection.status, 'eligible');
      assert.ok(c.chatProjection.messageIds.length > 0);
      assert.deepEqual(await read(f), view);
      assert.deepEqual(
        await attempts.read(f.owner, { worldId: f.worldId, actorId: 'a' }),
        before,
        'reader cannot complete goals or modify plans',
      );
      const valid = await db.transaction(f.owner, (sql) =>
        requireActorMediaResultContextInTransaction(
          sql,
          f.owner,
          { worldId: f.worldId, actorId: 'a', engineEpoch: 2, worldVersion: 1 },
          { id: c.id, contentHash: c.source.contentHash, recordId: c.source.recordId },
        ),
      );
      assert.equal(valid.id, c.id);
      assert.equal(c.source.recordId, f.requestId);
      assert.deepEqual(
        await repo.read(f.owner, {
          worldId: f.worldId,
          actorId: 'a',
          engineEpoch: 2,
          worldVersion: 1,
          requestIds: ['wrong-request'],
        }),
        { completed: [], pending: [] },
      );
      assert.deepEqual(await read(f, 'b'), { completed: [], pending: [] });
      const foreign = randomUUID();
      await new IdentityRepository(db).ensureGuest(foreign);
      await assert.rejects(
        repo.read(foreign, { worldId: f.worldId, actorId: 'a', engineEpoch: 2, worldVersion: 1 }),
        /NOT_FOUND/,
      );
      await assert.rejects(
        repo.read(f.owner, { worldId: f.worldId, actorId: 'a', engineEpoch: 2, worldVersion: 0 }),
        /VERSION_CONFLICT/,
      );
    },
  );
  await t.test(
    'a document claiming ready cannot certify success and unknown tasks stay uncompleted',
    async () => {
      const fake = await fixture();
      await admin.query(
        'UPDATE parallel_life.world_media_requests SET document=document||$2::jsonb WHERE world_id=$1',
        [fake.worldId, JSON.stringify({ status: 'ready', assetId: randomUUID() })],
      );
      assert.equal((await read(fake)).completed.length, 0);
      assert.equal((await read(fake)).pending[0]!.phase, 'unverified_ready');
      const unknown = await fixture(),
        lease = await dispatch(unknown);
      await queue.finish(lease, { status: 'unknown', errorCode: 'SYNTHETIC_UNKNOWN' });
      assert.equal((await read(unknown)).completed.length, 0);
      assert.equal((await read(unknown)).pending[0]!.phase, 'unknown');
    },
  );
  await t.test(
    'task provenance, terminal outbox and exact asset revision are all mandatory',
    async () => {
      const f = await fixture();
      const { lease, assetId } = await complete(f);
      const valid = (await read(f)).completed[0]!;
      const original = (
        await admin.query('SELECT request_hash FROM parallel_life.tasks WHERE id=$1', [lease.id])
      ).rows[0].request_hash;
      await admin.query("UPDATE parallel_life.tasks SET request_hash='tampered' WHERE id=$1", [
        lease.id,
      ]);
      assert.equal((await read(f)).completed.length, 0);
      await admin.query('UPDATE parallel_life.tasks SET request_hash=$2 WHERE id=$1', [
        lease.id,
        original,
      ]);
      await admin.query("UPDATE parallel_life.outbox_jobs SET status='submitted' WHERE id=$1", [
        valid.provenance.outboxId,
      ]);
      assert.equal((await read(f)).completed.length, 0);
      await admin.query("UPDATE parallel_life.outbox_jobs SET status='succeeded' WHERE id=$1", [
        valid.provenance.outboxId,
      ]);
      await admin.query('UPDATE parallel_life.assets SET revision=2 WHERE id=$1', [assetId]);
      assert.equal((await read(f)).completed.length, 0);
      await assert.rejects(
        db.transaction(f.owner, (sql) =>
          requireActorMediaResultContextInTransaction(
            sql,
            f.owner,
            { worldId: f.worldId, actorId: 'a', engineEpoch: 2, worldVersion: 1 },
            { id: valid.id, contentHash: valid.source.contentHash },
          ),
        ),
        /VERSION_CONFLICT/,
      );
    },
  );
  await t.test(
    'generation completion is independent of chat presentation policy or presence of an assistant bubble',
    async () => {
      const suppressed = await fixture();
      await complete(suppressed, false);
      const c = (await read(suppressed)).completed[0]!;
      assert.equal(c.phase, 'completed');
      assert.equal(c.chatProjection.status, 'suppressed');
      assert.deepEqual(c.chatProjection.messageIds, []);
      const noMessage = await fixture(false);
      await complete(noMessage);
      const n = (await read(noMessage)).completed[0]!;
      assert.equal(n.phase, 'completed');
      assert.equal(n.chatProjection.status, 'no_message');
      assert.deepEqual(n.chatProjection.messageIds, []);
    },
  );
});
