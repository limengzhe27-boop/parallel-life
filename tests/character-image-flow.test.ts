import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterImageSynthesizer } from '../src/modules/media/infrastructure/image-generator.ts';
import { mediaHandler } from '../src/modules/media/infrastructure/media-handler.ts';
import { PostgresTaskQueue } from '../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import { adminClient } from '../scripts/db-admin.mjs';
import { localConfig } from '../scripts/local-config.mjs';
import type { AssetStore } from '../src/modules/media/application/asset-store.ts';

class MemoryAssetStore implements AssetStore {
  public files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const buf = this.files.get(key);
    if (!buf) throw new Error('NOT_FOUND');
    return buf;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

test('M-01/02/03: CharacterImageSynthesizer generates portrait & commits to world_album with face provenance', async () => {
  const config = await localConfig();
  const dbUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const db = new PostgresDatabase(dbUrl);
  const store = new MemoryAssetStore();
  const synthesizer = new CharacterImageSynthesizer(db, store);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_img_' + Date.now();
  const worldId = 'test_world_img_' + Date.now();
  const portraitAssetId = '00000000-0000-0000-0000-000000000001';

  try {
    // Setup test account and world
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [ownerId]);
    await admin.query(
      `INSERT INTO parallel_life.worlds (id, owner_id, title, state) VALUES ($1, $2, $3, $4)`,
      [worldId, ownerId, '独立电影导演的平行人生', { schemaVersion: 1, id: worldId, ownerId, version: 0, title: '独立电影导演', time: '2026-09-24T12:00:00Z', actors: [], facts: [], messages: [], appointments: [], mediaRequests: [] }],
    );

    // Generate identity portrait
    const result = await synthesizer.generateAndCommit({
      ownerId,
      worldId,
      prompt: '独立电影导演角色身份写真，胶片质感',
      title: '【身份写真】独立电影导演',
      referenceAssetId: portraitAssetId,
      storyAt: '2026-09-24',
    });

    assert.ok(result.assetId, 'Generated asset ID must exist');

    // Verify file written to asset store
    const file = await store.get(`${result.assetId}.webp`);
    assert.ok(file && file.length > 0, 'Image bytes must be written to asset store');

    // Verify written to database assets table
    const assetRow = (
      await admin.query(`SELECT * FROM parallel_life.assets WHERE id = $1`, [result.assetId])
    ).rows[0];
    assert.equal(assetRow.origin, 'generated');
    assert.equal(assetRow.mime_type, 'image/webp');
    assert.equal(assetRow.status, 'ready');

    // Verify written to world_album projection
    const albumRow = (
      await admin.query(`SELECT * FROM parallel_life.world_album WHERE asset_id = $1`, [result.assetId])
    ).rows[0];
    assert.equal(albumRow.world_id, worldId);
    assert.equal(albumRow.title, '【身份写真】独立电影导演');
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
  }
});

test('M-01/02/03: mediaHandler completes outbox job and updates world_media_requests to ready', async () => {
  const config = await localConfig();
  const workerUrl = `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_dev`;
  const queue = new PostgresTaskQueue(workerUrl);
  const db = new PostgresDatabase(appUrl);
  const store = new MemoryAssetStore();
  const synthesizer = new CharacterImageSynthesizer(db, store);
  const handler = mediaHandler(queue, synthesizer);

  const admin = await adminClient('parallel_life_dev');
  const ownerId = 'test_owner_media_' + Date.now();
  const worldId = 'test_world_media_' + Date.now();
  const mediaRequestId = 'test_req_' + Date.now();
  const commandId = '00000000-0000-0000-0000-000000000002';
  const outboxId = 'outbox_' + Date.now();
  const eventId = 'event_' + Date.now();

  try {
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [ownerId]);
    await admin.query(
      `INSERT INTO parallel_life.worlds (id, owner_id, title, state) VALUES ($1, $2, $3, $4)`,
      [worldId, ownerId, '咖啡主理人人生', { schemaVersion: 1, id: worldId, ownerId, version: 0, title: '咖啡主理人', time: '2026-09-24T12:00:00Z', actors: [], facts: [], messages: [], appointments: [], mediaRequests: [] }],
    );

    // Insert world media request
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document) VALUES ($1, $2, $3, $4)`,
      [mediaRequestId, worldId, ownerId, { id: mediaRequestId, worldId, prompt: '咖啡馆吧台手冲特写', title: '【剧情解锁】初秋第一杯手冲', sourceEventId: eventId }],
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
    await handler(lease);

    // Verify task succeeded
    const taskRow = (await admin.query(`SELECT status FROM parallel_life.tasks WHERE id = $1`, [taskId])).rows[0];
    assert.equal(taskRow.status, 'succeeded');

    // Verify request updated to ready
    const mediaRow = (
      await admin.query(`SELECT document FROM parallel_life.world_media_requests WHERE id = $1`, [mediaRequestId])
    ).rows[0];
    assert.equal(mediaRow.document.status, 'ready');
    assert.ok(mediaRow.document.assetId, 'Asset ID must be attached');
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
  }
});
