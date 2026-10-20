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
import { readChatContextWorld } from '../../src/modules/world/infrastructure/chat-context-read-repository.ts';
import { PostgresActorMediaResultContextRepository } from '../../src/modules/world/infrastructure/actor-media-result-context-repository.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

test('44-169 media references reach the original resolver through the bounded snapshot path', async (t) => {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
      `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_test`,
    );
  t.after(async () => {
    await queue.close();
    await db.close();
    await admin.end();
  });
  const worlds = new PostgresWorldRepository(db);
  const attempts = new PostgresAgentRuntimeRepository(db);
  const owner = randomUUID();
  const worldId = randomUUID();
  const time = '2026-10-20T08:00:00.000Z';
  await new IdentityRepository(db).ensureGuest(owner);
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '44-169 media wiring world',
    time,
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

  const receipt = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(worldId).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: time,
      origin: 'player',
      text: 'Can you take a picture?',
    })
  ).receipt;
  const state = (await attempts.read(owner, { worldId, actorId: 'a' }))!;
  const snapshot = (await readPrivateAgentSnapshot(db, owner, world, 'a', receipt, time, state))
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
    statements: [{ text: 'I will try taking a picture.', dependsOnActionIds: ['media:current'] }],
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
  const currentWorld = await worlds.get({ userId: owner }, worldId);
  const newInput = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(`${worldId}:next`).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: currentWorld.version,
      receivedAt: new Date().toISOString(),
      storyAt: currentWorld.time,
      origin: 'player',
      text: 'New chat after the photo request.',
    })
  ).receipt;
  const currentState = (await attempts.read(owner, { worldId, actorId: 'a' }))!;
  const actionsBefore = currentState.actions.length;
  const requestsBefore = (
    await admin.query(
      'SELECT COUNT(*)::int AS count FROM parallel_life.world_media_requests WHERE world_id=$1',
      [worldId],
    )
  ).rows[0].count;

  const boundedPending = await readChatContextWorld(db, owner, { worldId, actorId: 'a' });
  const pendingSnapshot = (
    await readPrivateAgentSnapshot(
      db,
      owner,
      boundedPending.world,
      'a',
      newInput,
      currentWorld.time,
      currentState,
      { referencedSourceIds: [`media-result:pending-${requestId}`] },
    )
  ).snapshot;
  assert.equal(
    pendingSnapshot.sources.some((source) => source.id.startsWith('media-result:')),
    false,
    'queued media is not presented as completed',
  );

  const outbox = new PostgresOutbox(db);
  const dispatched = await dispatchOutbox(
    outbox.ports(owner, { worldId, eventId: committed.eventId }),
  );
  assert.equal(dispatched.submitted, 1);
  const lease = await queue.claimForOwner(dispatched.taskIds[0]!, owner, ['media']);
  assert.ok(lease);
  const assetId = randomUUID();
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
        deliveryDecision: { approved: true, deliverToChat: true, deliverToAlbum: true },
      };
    },
  };
  await createMediaPipelineHandler(queue, pipeline as MediaPipelineService)(lease);

  const worldAfter = await worlds.get({ userId: owner }, worldId);
  const stateAfter = (await attempts.read(owner, { worldId, actorId: 'a' }))!;
  const mediaView = await new PostgresActorMediaResultContextRepository(db).read(owner, {
    worldId,
    actorId: 'a',
    engineEpoch: 2,
    worldVersion: worldAfter.version,
  });
  const mediaSourceId = mediaView.completed[0]!.id;
  const boundedCompleted = await readChatContextWorld(db, owner, { worldId, actorId: 'a' });
  const completedSnapshot = (
    await readPrivateAgentSnapshot(
      db,
      owner,
      boundedCompleted.world,
      'a',
      newInput,
      worldAfter.time,
      stateAfter,
      { referencedSourceIds: [mediaSourceId] },
    )
  ).snapshot;
  const mediaSource = completedSnapshot.sources.find((source) => source.id === mediaSourceId);
  assert.ok(mediaSource);
  assert.equal(mediaSource.kind, 'action_result');
  assert.ok(
    completedSnapshot.observations.some(
      (observation) =>
        observation.sourceId === mediaSourceId &&
        observation.text.includes('own_media_completion') &&
        observation.text.includes(assetId),
    ),
  );
  assert.equal(completedSnapshot.state.actions.length, actionsBefore);
  assert.equal(
    (
      await admin.query(
        'SELECT COUNT(*)::int AS count FROM parallel_life.world_media_requests WHERE world_id=$1',
        [worldId],
      )
    ).rows[0].count,
    requestsBefore,
    'reading an old completion does not create a new media action',
  );

  // A failed media task in an independent world stays pending/failed, never a completed source.
  const failedWorldId = randomUUID();
  const failedWorld: WorldState = {
    ...world,
    id: failedWorldId,
    title: '44-169 failed media wiring world',
    messages: [],
    facts: [],
    appointments: [],
    mediaRequests: [],
  };
  await worlds.initialize({ userId: owner }, failedWorld);
  await db.transaction(owner, async (sql) => {
    for (const actor of failedWorld.actors)
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId: failedWorldId, actorId: actor.id },
          agentDefinitionRef(failedWorld, actor.id),
          0,
        ),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId: failedWorldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  await new PostgresClockStore(db).setClock(owner, failedWorldId, { paused: false, speed: 0 });
  const failedReceipt = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId: failedWorldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(`${failedWorldId}:failed`).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: 0,
      receivedAt: new Date().toISOString(),
      storyAt: time,
      origin: 'player',
      text: 'Please try a photo that will fail.',
    })
  ).receipt;
  const failedState0 = (await attempts.read(owner, { worldId: failedWorldId, actorId: 'a' }))!;
  const failedSnapshot0 = (
    await readPrivateAgentSnapshot(db, owner, failedWorld, 'a', failedReceipt, time, failedState0)
  ).snapshot;
  const failedProposal = {
    ...proposal,
    mediaDecision: { ...proposal.mediaDecision, basisSourceIds: [failedReceipt.id] },
  };
  const failedCommit = await runNpcAgent(
    {
      attempts,
      model: {
        async decide() {
          return JSON.stringify(failedProposal);
        },
      },
      kernel: new PostgresNpcAgentKernel(db, worlds),
    },
    owner,
    {
      id: randomUUID(),
      worldId: failedWorldId,
      actorId: 'a',
      commandId: failedReceipt.commandId,
      inputReceiptId: failedReceipt.id,
      inputHash: failedReceipt.inputHash,
      engineEpoch: 2,
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 240000).toISOString(),
    },
    failedSnapshot0,
  );
  const failedRequestId = failedCommit.results[0]!.outputRefs![0]!.id;
  const failedDispatch = await dispatchOutbox(
    outbox.ports(owner, { worldId: failedWorldId, eventId: failedCommit.eventId }),
  );
  assert.equal(failedDispatch.submitted, 1);
  const failedLease = await queue.claimForOwner(failedDispatch.taskIds[0]!, owner, ['media']);
  assert.ok(failedLease);
  await queue.finish(failedLease, { status: 'failed', errorCode: 'SYNTHETIC_FAILED' });
  const failedWorldAfter = await worlds.get({ userId: owner }, failedWorldId);
  const failedView = await new PostgresActorMediaResultContextRepository(db).read(owner, {
    worldId: failedWorldId,
    actorId: 'a',
    engineEpoch: 2,
    worldVersion: failedWorldAfter.version,
  });
  assert.equal(
    failedView.completed.some((result) => result.source.recordId === failedRequestId),
    false,
  );
  assert.ok(failedView.pending.some((result) => result.requestId === failedRequestId));
  const failedInput = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId: failedWorldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(`${failedWorldId}:after-failed`).digest('hex'),
      channel: 'private',
      threadId: 'a',
      recipientActorId: 'a',
      expectedWorldVersion: failedWorldAfter.version,
      receivedAt: new Date().toISOString(),
      storyAt: failedWorldAfter.time,
      origin: 'player',
      text: 'A new chat after the failed photo.',
    })
  ).receipt;
  const failedState = (await attempts.read(owner, { worldId: failedWorldId, actorId: 'a' }))!;
  const failedBounded = await readChatContextWorld(db, owner, {
    worldId: failedWorldId,
    actorId: 'a',
  });
  const failureSnapshot = (
    await readPrivateAgentSnapshot(
      db,
      owner,
      failedBounded.world,
      'a',
      failedInput,
      failedWorldAfter.time,
      failedState,
      { referencedSourceIds: [`media-result:${failedRequestId}`] },
    )
  ).snapshot;
  assert.equal(
    failureSnapshot.sources.some((source) => source.id.startsWith('media-result:')),
    false,
  );

  // Explicit refs remain actor/world scoped.
  const stateB = (await attempts.read(owner, { worldId, actorId: 'b' }))!;
  const boundedB = await readChatContextWorld(db, owner, { worldId, actorId: 'b' });
  const snapshotB = (
    await readPrivateAgentSnapshot(db, owner, boundedB.world, 'b', null, worldAfter.time, stateB, {
      referencedSourceIds: [mediaSourceId],
    })
  ).snapshot;
  assert.equal(
    snapshotB.sources.some((source) => source.id === mediaSourceId),
    false,
  );

  const missingSnapshot = (
    await readPrivateAgentSnapshot(
      db,
      owner,
      boundedCompleted.world,
      'a',
      newInput,
      worldAfter.time,
      stateAfter,
      { referencedSourceIds: ['media-result:missing-media'] },
    )
  ).snapshot;
  assert.equal(
    missingSnapshot.sources.some((source) => source.id === 'media-result:missing-media'),
    false,
  );

  const otherWorldId = randomUUID();
  const otherWorld: WorldState = {
    ...world,
    id: otherWorldId,
    title: '44-169 other world',
    actors: world.actors,
  };
  await worlds.initialize({ userId: owner }, otherWorld);
  await db.transaction(owner, async (sql) => {
    for (const actor of otherWorld.actors)
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId: otherWorldId, actorId: actor.id },
          agentDefinitionRef(otherWorld, actor.id),
          0,
        ),
      );
    await switchAgentEngineEpochInTransaction(sql, owner, {
      worldId: otherWorldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
  });
  const otherBounded = await readChatContextWorld(db, owner, {
    worldId: otherWorldId,
    actorId: 'a',
  });
  const otherState = (await attempts.read(owner, { worldId: otherWorldId, actorId: 'a' }))!;
  const otherSnapshot = (
    await readPrivateAgentSnapshot(
      db,
      owner,
      otherBounded.world,
      'a',
      null,
      otherWorld.time,
      otherState,
      { referencedSourceIds: [mediaSourceId] },
    )
  ).snapshot;
  assert.equal(
    otherSnapshot.sources.some((source) => source.id === mediaSourceId),
    false,
  );
});
