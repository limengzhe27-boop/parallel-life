import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaPipelineHandler } from '../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { PostgresTaskQueue } from '../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { adminClient } from '../scripts/db-admin.mjs';
import { localConfig } from '../scripts/local-config.mjs';
import type { MediaPipelineService } from '../src/modules/media/infrastructure/media-pipeline-service.ts';

async function setupWorldAndCommand(
  admin: any,
  ownerId: string,
  worldId: string,
  commandId: string,
  eventId: string,
) {
  await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [ownerId]);
  await admin.query(
    `INSERT INTO parallel_life.worlds (id, owner_id, title, state) VALUES ($1, $2, $3, $4)`,
    [worldId, ownerId, '测试世界', { id: worldId, ownerId, status: 'active' }],
  );
  await admin.query(
    `INSERT INTO parallel_life.commands(id, world_id, owner_id, expected_version, request_hash, request_payload, status)
     VALUES ($1, $2, $3, 0, $4, '{}', 'queued')`,
    [commandId, worldId, ownerId, 'hash_' + commandId],
  );
  await admin.query(
    `INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
     VALUES ($1, $2, $3, 1, $4, '{}', now())`,
    [eventId, worldId, ownerId, commandId],
  );
}

test('createMediaPipelineHandler - Unconfigured pipeline records UNAVAILABLE honestly in database and outbox', async () => {
  const config = await localConfig();
  const workerUrl = `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const queue = new PostgresTaskQueue(workerUrl);
  const handler = createMediaPipelineHandler(queue);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_mph_unavail_' + Date.now();
  const worldId = 'test_world_mph_unavail_' + Date.now();
  const mediaRequestId = 'test_req_mph_' + Date.now();
  const commandId = '00000000-0000-0000-0000-000000000010';
  const outboxId = 'outbox_mph_' + Date.now();
  const eventId = 'event_mph_' + Date.now();

  try {
    await setupWorldAndCommand(admin, ownerId, worldId, commandId, eventId);

    // Create outbox job
    await admin.query(
      `INSERT INTO parallel_life.outbox_jobs (id, owner_id, world_id, event_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [outboxId, ownerId, worldId, eventId, { requestId: mediaRequestId }],
    );

    // Insert world media request
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document) VALUES ($1, $2, $3, $4)`,
      [
        mediaRequestId,
        worldId,
        ownerId,
        {
          id: mediaRequestId,
          worldId,
          prompt: '胶片摄影抓拍',
          title: '【剧情记录】午后街角',
          sourceEventId: eventId,
        },
      ],
    );

    // Enqueue task
    const taskId = '00000000-0000-0000-0000-000000000011';
    await admin.query(
      `INSERT INTO parallel_life.tasks (id, owner_id, scope_kind, scope_id, command_id, request_hash, input, status)
       VALUES ($1, $2, 'media', $3, $4, 'hash_mph_test', $5, 'queued')`,
      [taskId, ownerId, mediaRequestId, commandId, { requestId: mediaRequestId }],
    );

    const lease = await queue.claim(['media']);
    assert.ok(lease, 'Lease must be claimed');

    await assert.rejects(handler(lease), { code: 'UNAVAILABLE' });

    // Verify media request updated with failed status
    const reqRes = await admin.query(
      `SELECT document FROM parallel_life.world_media_requests WHERE id = $1`,
      [mediaRequestId],
    );
    assert.equal(reqRes.rows[0].document.status, 'failed');
    assert.equal(reqRes.rows[0].document.errorCode, 'UNAVAILABLE');

    // Verify outbox job finished as failed
    const outboxRes = await admin.query(
      `SELECT status, last_error FROM parallel_life.outbox_jobs WHERE id = $1`,
      [outboxId],
    );
    assert.equal(outboxRes.rows[0].status, 'failed');
    assert.equal(outboxRes.rows[0].last_error, 'UNAVAILABLE:media-adapter');
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
    await queue.close();
  }
});

test('createMediaPipelineHandler - Replay idempotency returns existing asset without re-generating', async () => {
  const config = await localConfig();
  const workerUrl = `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const queue = new PostgresTaskQueue(workerUrl);

  let pipelineCalled = false;
  const mockService: Partial<MediaPipelineService> = {
    async executeImagePipeline() {
      pipelineCalled = true;
      throw new Error('Should not be called on idempotent replay');
    },
  };

  const handler = createMediaPipelineHandler(queue, mockService as any);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_mph_idem_' + Date.now();
  const worldId = 'test_world_mph_idem_' + Date.now();
  const mediaRequestId = 'test_req_mph_idem_' + Date.now();
  const existingAssetId = '00000000-0000-4000-8000-000000000099';
  const commandId = '00000000-0000-0000-0000-000000000020';
  const outboxId = 'outbox_mph_idem_' + Date.now();
  const eventId = 'event_mph_idem_' + Date.now();

  try {
    await setupWorldAndCommand(admin, ownerId, worldId, commandId, eventId);

    // Outbox job pending
    await admin.query(
      `INSERT INTO parallel_life.outbox_jobs (id, owner_id, world_id, event_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [outboxId, ownerId, worldId, eventId, { requestId: mediaRequestId }],
    );

    // Existing completed media request
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document) VALUES ($1, $2, $3, $4)`,
      [
        mediaRequestId,
        worldId,
        ownerId,
        {
          id: mediaRequestId,
          worldId,
          status: 'ready',
          assetId: existingAssetId,
          sourceEventId: eventId,
        },
      ],
    );

    // Enqueue task
    const taskId = '00000000-0000-0000-0000-000000000021';
    await admin.query(
      `INSERT INTO parallel_life.tasks (id, owner_id, scope_kind, scope_id, command_id, request_hash, input, status)
       VALUES ($1, $2, 'media', $3, $4, 'hash_mph_idem_test', $5, 'queued')`,
      [taskId, ownerId, mediaRequestId, commandId, { requestId: mediaRequestId }],
    );

    const lease = await queue.claim(['media']);
    assert.ok(lease, 'Lease must be claimed');

    await handler(lease);
    assert.equal(pipelineCalled, false, 'Pipeline service must not be invoked on replay');

    // Verify outbox job finished as succeeded
    const outboxRes = await admin.query(
      `SELECT status, provider_task_id FROM parallel_life.outbox_jobs WHERE id = $1`,
      [outboxId],
    );
    assert.equal(outboxRes.rows[0].status, 'succeeded');
    assert.equal(outboxRes.rows[0].provider_task_id, existingAssetId);
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
    await queue.close();
  }
});

test('createMediaPipelineHandler - Successful generation commits asset and projects to album', async () => {
  const config = await localConfig();
  const workerUrl = `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const queue = new PostgresTaskQueue(workerUrl);

  const newAssetId = '00000000-0000-4000-8000-000000000101';
  const mockService: Partial<MediaPipelineService> = {
    async executeImagePipeline() {
      return {
        assetId: newAssetId,
        storageKey: `media/test_world/${newAssetId}.webp`,
        mimeType: 'image/webp',
        byteLength: 45000,
        width: 1024,
        height: 1024,
        referenceAssetIds: [],
        prompt: '【平行人生留影】午后阳光洒在长椅上',
        providerTaskId: 'replicate_task_101',
        deliveryDecision: {
          channel: 'album',
          approved: true,
        },
      };
    },
  };

  const handler = createMediaPipelineHandler(queue, mockService as any);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_mph_success_' + Date.now();
  const worldId = 'test_world_mph_success_' + Date.now();
  const mediaRequestId = 'test_req_mph_succ_' + Date.now();
  const commandId = '00000000-0000-0000-0000-000000000030';
  const outboxId = 'outbox_mph_succ_' + Date.now();
  const eventId = 'event_mph_succ_' + Date.now();

  try {
    await setupWorldAndCommand(admin, ownerId, worldId, commandId, eventId);

    // Outbox job pending
    await admin.query(
      `INSERT INTO parallel_life.outbox_jobs (id, owner_id, world_id, event_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [outboxId, ownerId, worldId, eventId, { requestId: mediaRequestId }],
    );

    // Media request
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document) VALUES ($1, $2, $3, $4)`,
      [
        mediaRequestId,
        worldId,
        ownerId,
        {
          id: mediaRequestId,
          worldId,
          prompt: '午后阳光洒在长椅上',
          title: '【相册】初秋记忆',
          sourceEventId: eventId,
          deliveryIntent: {
            channel: 'album',
            storyAt: '2026-10-16T12:00:00Z',
          },
        },
      ],
    );

    // Enqueue task
    const taskId = '00000000-0000-0000-0000-000000000031';
    await admin.query(
      `INSERT INTO parallel_life.tasks (id, owner_id, scope_kind, scope_id, command_id, request_hash, input, status)
       VALUES ($1, $2, 'media', $3, $4, 'hash_mph_succ_test', $5, 'queued')`,
      [taskId, ownerId, mediaRequestId, commandId, { requestId: mediaRequestId }],
    );

    const lease = await queue.claim(['media']);
    assert.ok(lease, 'Lease must be claimed');

    await handler(lease);

    // 1. Verify asset in parallel_life.assets
    const assetRes = await admin.query(
      `SELECT id, mime_type, width, height, status FROM parallel_life.assets WHERE id = $1`,
      [newAssetId],
    );
    assert.equal(assetRes.rows.length, 1);
    assert.equal(assetRes.rows[0].status, 'ready');
    assert.equal(assetRes.rows[0].mime_type, 'image/webp');
    assert.equal(assetRes.rows[0].width, 1024);

    // 2. Verify world_media_requests updated to ready with assetId and deliveryDecision
    const reqRes = await admin.query(
      `SELECT document FROM parallel_life.world_media_requests WHERE id = $1`,
      [mediaRequestId],
    );
    assert.equal(reqRes.rows[0].document.status, 'ready');
    assert.equal(reqRes.rows[0].document.assetId, newAssetId);
    assert.equal(reqRes.rows[0].document.deliveryDecision.approved, true);

    // 3. Verify outbox job finished as succeeded
    const outboxRes = await admin.query(
      `SELECT status, provider_task_id FROM parallel_life.outbox_jobs WHERE id = $1`,
      [outboxId],
    );
    assert.equal(outboxRes.rows[0].status, 'succeeded');
    assert.equal(outboxRes.rows[0].provider_task_id, newAssetId);
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
    await queue.close();
  }
});
