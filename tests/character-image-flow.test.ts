import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaHandler } from '../src/modules/media/infrastructure/media-handler.ts';
import { PostgresTaskQueue } from '../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import { adminClient } from '../scripts/db-admin.mjs';
import { localConfig } from '../scripts/local-config.mjs';
import type { AssetStore } from '../src/modules/media/application/asset-store.ts';

test('unconfigured media generation records failure and creates no album assets', async () => {
  const config = await localConfig();
  const workerUrl = `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const queue = new PostgresTaskQueue(workerUrl);
  const handler = mediaHandler(queue);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_media_' + Date.now();
  const worldId = 'test_world_media_' + Date.now();
  const mediaRequestId = 'test_req_' + Date.now();
  const commandId = '00000000-0000-0000-0000-000000000002';
  const outboxId = 'outbox_' + Date.now();
  const eventId = 'event_' + Date.now();

  try {
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      ownerId,
    ]);
    await admin.query(
      `INSERT INTO parallel_life.worlds (id, owner_id, title, state) VALUES ($1, $2, $3, $4)`,
      [
        worldId,
        ownerId,
        '咖啡主理人人生',
        {
          schemaVersion: 1,
          id: worldId,
          ownerId,
          version: 0,
          title: '咖啡主理人',
          time: '2026-09-24T12:00:00Z',
          actors: [],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      ],
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
          prompt: '咖啡馆吧台手冲特写',
          title: '【剧情解锁】初秋第一杯手冲',
          sourceEventId: eventId,
        },
      ],
    );

    // Enqueue media task directly into tasks table
    const taskId = '00000000-0000-0000-0000-000000000009';
    await admin.query(
      `INSERT INTO parallel_life.tasks (id, owner_id, scope_kind, scope_id, command_id, request_hash, input, status)
       VALUES ($1, $2, 'media', $3, $4, 'hash_media_test', $5, 'queued')`,
      [taskId, ownerId, mediaRequestId, commandId, { requestId: mediaRequestId }],
    );

    const lease = await queue.claim(['media']);
    assert.ok(lease, 'Lease must be claimed');

    // Execute handler
    await assert.rejects(handler(lease), { code: 'UNAVAILABLE' });

    // Verify task succeeded
    const taskRow = (
      await admin.query(`SELECT status FROM parallel_life.tasks WHERE id = $1`, [taskId])
    ).rows[0];
    assert.notEqual(taskRow.status, 'succeeded');

    // Verify request updated to ready
    const mediaRow = (
      await admin.query(`SELECT document FROM parallel_life.world_media_requests WHERE id = $1`, [
        mediaRequestId,
      ])
    ).rows[0];
    assert.equal(mediaRow.document.status, 'failed');
    assert.equal(mediaRow.document.errorCode, 'UNAVAILABLE');
    assert.equal(mediaRow.document.assetId, undefined);
    const count = (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_album WHERE world_id=$1',
        [worldId],
      )
    ).rows[0];
    assert.equal(count.n, 0, 'No template image may be written as a real result');
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
  }
});

test('M-04: ProfileRepository supports multi-photo reference management (add & delete)', async () => {
  const { ProfileRepository } =
    await import('../src/modules/profile/infrastructure/profile-repository.ts');
  const config = await localConfig();
  const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const db = new PostgresDatabase(appUrl);
  const repo = new ProfileRepository(db);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_multi_photo_' + Date.now();
  const profileId = '00000000-0000-4000-8000-000000000088';
  const asset1 = '00000000-0000-4000-8000-000000000071';
  const asset2 = '00000000-0000-4000-8000-000000000072';

  try {
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      ownerId,
    ]);
    await admin.query(
      `INSERT INTO parallel_life.profiles (id, owner_id, version, document) VALUES ($1, $2, 0, $3)`,
      [
        profileId,
        ownerId,
        {
          id: profileId,
          version: 0,
          facts: [],
          events: [],
          people: [],
          portraitAssetId: null,
          referenceAssetIds: [],
          updatedAt: new Date().toISOString(),
        },
      ],
    );

    // Mock ready assets
    await admin.query(
      `INSERT INTO parallel_life.assets (id, owner_id, storage_key, mime_type, byte_length, width, height, origin, status)
       VALUES ($1, $2, 'key1', 'image/jpeg', 100, 100, 100, 'upload', 'ready'),
              ($3, $2, 'key2', 'image/jpeg', 100, 100, 100, 'upload', 'ready')`,
      [asset1, ownerId, asset2],
    );

    // Add first photo -> should also become default portrait
    const p1 = await repo.edit(ownerId, {
      expectedVersion: 0,
      operation: { kind: 'add-reference-photo', assetId: asset1 },
    });
    assert.equal(p1.portraitAssetId, asset1);
    assert.deepEqual(p1.referenceAssetIds, [asset1]);

    // Add second photo
    const p2 = await repo.edit(ownerId, {
      expectedVersion: p1.version,
      operation: { kind: 'add-reference-photo', assetId: asset2 },
    });
    assert.equal(p2.portraitAssetId, asset1);
    assert.deepEqual(p2.referenceAssetIds, [asset1, asset2]);

    // Delete first photo -> portrait falls back to asset2
    const p3 = await repo.edit(ownerId, {
      expectedVersion: p2.version,
      operation: { kind: 'delete-reference-photo', assetId: asset1 },
    });
    assert.equal(p3.portraitAssetId, asset2);
    assert.deepEqual(p3.referenceAssetIds, [asset2]);
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
  }
});

test('legacy photo titles cannot manufacture message attachments', async () => {
  const { worldAppData } = await import('../src/features/phone/world-app-data.ts');
  const world = {
    id: '00000000-0000-0000-0000-000000000001',
    seedId: '00000000-0000-0000-0000-000000000002',
    title: '独立电影导演',
    time: '2026-09-24T12:00:00Z',
    identity: '独立电影导演',
    setting: '上海巨鹿路',
    actors: [{ id: '00000000-0000-0000-0000-000000000003', name: '沈棠', relationship: '制片人' }],
    messages: [
      {
        id: 'msg-1',
        actorId: '00000000-0000-0000-0000-000000000003',
        text: '我刚在整理相册，找到了《【事件纪念】双年展现场布展》那张照片，太有感觉了！',
        at: '2026-09-24T12:05:00Z',
      },
    ],
    notes: [],
    photos: [
      {
        id: '00000000-0000-0000-0000-000000000010',
        worldId: '00000000-0000-0000-0000-000000000001',
        title: '【身份写真】独立电影导演 · 肖像',
        date: '2026-09-24T12:00:00Z',
        createdAt: '2026-09-24T12:00:00Z',
        kind: 'generated' as const,
        width: 1024,
        height: 1024,
        revision: 1,
      },
      {
        id: '00000000-0000-0000-0000-000000000011',
        worldId: '00000000-0000-0000-0000-000000000001',
        title: '【事件纪念】双年展现场布展',
        date: '2026-09-24T12:05:00Z',
        createdAt: '2026-09-24T12:05:00Z',
        kind: 'generated' as const,
        width: 1024,
        height: 1024,
        revision: 1,
      },
    ],
  };

  const appData = worldAppData(world as any);
  assert.equal(appData.photos.length, 2);
  assert.equal(appData.photos[0]?.tag, 'identity');
  assert.equal(appData.photos[1]?.tag, 'event');

  assert.equal(appData.messages[0]?.photo, undefined, 'A title mention is not an attachment');
  assert.equal(appData.photos[0]?.description, '历史素材 · 生成来源待核验');
});
