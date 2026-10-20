import test from 'node:test';
import assert from 'node:assert/strict';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';

test('IMG-CHAT-01: successful turn-generated media attaches to assistant message and album with same asset', () => {
  const assetId = '00000000-0000-4000-8000-000000000099';
  const worldId = '00000000-0000-4000-8000-000000000001';
  const actorId = '00000000-0000-4000-8000-000000000002';
  const eventId = '00000000-0000-4000-8000-000000000003';

  const world: WorldPhone = {
    id: worldId,
    seedId: '00000000-0000-4000-8000-000000000004',
    title: '海边独立咖啡馆',
    time: '2026-10-16T12:00:00.000Z',
    identity: '咖啡师',
    setting: '阿那亚海边',
    actors: [{ id: actorId, name: '林澈', relationship: '老友' }],
    photos: [
      {
        id: assetId,
        worldId,
        title: '【剧情解锁】黄昏的海边吧台',
        date: '2026-10-16T12:00:00.000Z',
        createdAt: '2026-10-16T12:00:00.000Z',
        kind: 'generated',
        width: 1024,
        height: 1024,
        revision: 1,
      },
    ],
    messages: [
      {
        id: 'msg_user',
        actorId,
        role: 'user',
        text: '给我发张今天吧台的照片吧！',
        at: '2026-10-16T12:00:00.000Z',
      },
      {
        id: 'msg_assistant',
        actorId,
        role: 'assistant',
        text: '刚拍了一张，夕阳正好照在冲煮壶上。',
        at: '2026-10-16T12:00:05.000Z',
        photoId: assetId,
        mediaStatus: 'ready',
        mediaTitle: '【剧情解锁】黄昏的海边吧台',
      },
    ],
    notes: [],
  };

  const appData = worldAppData(world);

  // 1. User message does not receive attachment
  assert.equal(appData.messages[0]?.photo, undefined, 'User message must not receive attachment');

  // 2. Assistant message receives attachment
  const assistantMsg = appData.messages[1];
  assert.ok(assistantMsg?.photo, 'Assistant message must receive attachment');
  assert.equal(assistantMsg.photo?.id, assetId);
  assert.equal(assistantMsg.photo?.status, 'ready');
  assert.equal(assistantMsg.photo?.title, '【剧情解锁】黄昏的海边吧台');
  assert.equal(assistantMsg.photo?.url, `/api/v1/assets/${assetId}?worldId=${worldId}&revision=1`);

  // 3. Album has the exact same asset
  assert.equal(appData.photos.length, 1);
  const albumPhoto = appData.photos[0];
  assert.equal(albumPhoto?.id, assetId);
  assert.equal(albumPhoto?.title, assistantMsg.photo?.title);
  assert.equal(albumPhoto?.url, assistantMsg.photo?.url);
  assert.equal(albumPhoto?.tag, 'event');
});

test('IMG-CHAT-01: pending media displays non-blocking generating status without fake images', () => {
  const worldId = '00000000-0000-4000-8000-000000000001';
  const actorId = '00000000-0000-4000-8000-000000000002';

  const world: WorldPhone = {
    id: worldId,
    seedId: '00000000-0000-4000-8000-000000000004',
    title: '海边独立咖啡馆',
    time: '2026-10-16T12:00:00.000Z',
    identity: '咖啡师',
    setting: '阿那亚海边',
    actors: [{ id: actorId, name: '林澈', relationship: '老友' }],
    photos: [],
    messages: [
      {
        id: 'msg_assistant',
        actorId,
        role: 'assistant',
        text: '稍等，我拿起相机拍一张发你！',
        at: '2026-10-16T12:00:05.000Z',
        mediaStatus: 'pending',
        mediaTitle: '【剧情记录】海风中的咖啡香',
      },
    ],
    notes: [],
  };

  const appData = worldAppData(world);
  const msg = appData.messages[0];

  assert.ok(msg);
  // Text remains completely intact and legible
  assert.equal(msg.text, '稍等，我拿起相机拍一张发你！');
  // Photo status is generating, url is undefined (no fake /art/first-window.webp)
  assert.ok(msg.photo);
  assert.equal(msg.photo?.status, 'generating');
  assert.equal(msg.photo?.title, '【剧情记录】海风中的咖啡香');
  assert.equal(msg.photo?.url, undefined, 'Must not manufacture fake URL while generating');
});

test('IMG-CHAT-01: failed media displays honest failed state without fake fallback', () => {
  const worldId = '00000000-0000-4000-8000-000000000001';
  const actorId = '00000000-0000-4000-8000-000000000002';

  const world: WorldPhone = {
    id: worldId,
    seedId: '00000000-0000-4000-8000-000000000004',
    title: '海边独立咖啡馆',
    time: '2026-10-16T12:00:00.000Z',
    identity: '咖啡师',
    setting: '阿那亚海边',
    actors: [{ id: actorId, name: '林澈', relationship: '老友' }],
    photos: [],
    messages: [
      {
        id: 'msg_assistant',
        actorId,
        role: 'assistant',
        text: '刚才光线太暗了，拍出来模糊没成。',
        at: '2026-10-16T12:00:05.000Z',
        mediaStatus: 'failed',
        mediaTitle: '【拍摄失败】黄昏手冲',
      },
    ],
    notes: [],
  };

  const appData = worldAppData(world);
  const msg = appData.messages[0];

  assert.ok(msg);
  assert.equal(msg.text, '刚才光线太暗了，拍出来模糊没成。');
  assert.ok(msg.photo);
  assert.equal(msg.photo?.status, 'failed');
  assert.equal(msg.photo?.title, '【拍摄失败】黄昏手冲');
  assert.equal(msg.photo?.url, undefined, 'Must not manufacture fake image on failure');
});

test('IMG-CHAT-01: plain text mentioning photo titles never manufactures attachments', () => {
  const worldId = '00000000-0000-4000-8000-000000000001';
  const actorId = '00000000-0000-4000-8000-000000000002';

  const world: WorldPhone = {
    id: worldId,
    seedId: '00000000-0000-4000-8000-000000000004',
    title: '海边独立咖啡馆',
    time: '2026-10-16T12:00:00.000Z',
    identity: '咖啡师',
    setting: '阿那亚海边',
    actors: [{ id: actorId, name: '林澈', relationship: '老友' }],
    photos: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        worldId,
        title: '【事件纪念】咖啡馆开业第一天',
        date: '2026-10-16T12:00:00.000Z',
        createdAt: '2026-10-16T12:00:00.000Z',
        kind: 'generated',
        width: 1024,
        height: 1024,
        revision: 1,
      },
    ],
    messages: [
      {
        id: 'msg_1',
        actorId,
        role: 'assistant',
        text: '想起《【事件纪念】咖啡馆开业第一天》那天，店里坐满了人。',
        at: '2026-10-16T12:00:05.000Z',
      },
    ],
    notes: [],
  };

  const appData = worldAppData(world);
  assert.equal(
    appData.messages[0]?.photo,
    undefined,
    'Text mention without contract must not attach photo',
  );
});

test('IMG-CHAT-01: Postgres integration - buildRepo.phone projects ready/pending/failed media to messages & album', async () => {
  const { localConfig } = await import('../scripts/local-config.mjs');
  const { adminClient } = await import('../scripts/db-admin.mjs');
  const { migrate } = await import('../scripts/migrate.mjs');
  const { PostgresDatabase } = await import('../src/modules/storage/infrastructure/postgres.ts');
  const { BuildRepository } =
    await import('../src/modules/world/infrastructure/build-repository.ts');
  const { PostgresWorldRepository } =
    await import('../src/modules/world/infrastructure/postgres-world-repository.ts');

  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`;
  const db = new PostgresDatabase(appUrl);

  const ownerId = 'test_owner_img_chat_' + Date.now();
  const worldId = '00000000-0000-4000-8000-000000000021';
  const actorId = '00000000-0000-4000-8000-000000000022';
  const event1 = '00000000-0000-4000-8000-000000000031';
  const event2 = '00000000-0000-4000-8000-000000000032';
  const mediaReq1 = '00000000-0000-4000-8000-000000000041';
  const mediaReq2 = '00000000-0000-4000-8000-000000000042';
  const asset1 = '00000000-0000-4000-8000-000000000051';

  const profileId = '00000000-0000-4000-8000-000000000061';
  const seedId = '00000000-0000-4000-8000-000000000062';
  const seedCmdId = '00000000-0000-4000-8000-000000000063';
  const directionId = '00000000-0000-4000-8000-000000000064';

  const seed = {
    id: seedId,
    createdAt: new Date().toISOString(),
    profileVersion: 0,
    discoveryVersion: 1,
    directionId,
    story: {
      title: '胶片摄影师人生',
      premise: '暗房显影',
      opening: '红光微亮',
      tradeoff: '成本高昂',
    },
    facts: [],
    people: [],
    portraitAssetId: null,
    assets: [],
  };

  try {
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      ownerId,
    ]);
    await admin.query(
      `INSERT INTO parallel_life.profiles (id, owner_id, version, document) VALUES ($1, $2, 0, $3)`,
      [profileId, ownerId, { id: profileId, version: 0, facts: [], events: [], people: [] }],
    );
    await admin.query(
      `INSERT INTO parallel_life.approved_seeds (id, owner_id, profile_id, command_id, request_hash, document)
       VALUES ($1, $2, $3, $4, 'hash_seed', $5)`,
      [seedId, ownerId, profileId, seedCmdId, JSON.stringify(seed)],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_builds (seed_id, owner_id, world_id, opening)
       VALUES ($1, $2, $3, $4)`,
      [seedId, ownerId, worldId, JSON.stringify({ identity: '胶片摄影师', setting: '暗房' })],
    );

    const worldRepo = new PostgresWorldRepository(db);
    await worldRepo.initialize(
      { userId: ownerId },
      {
        schemaVersion: 1,
        id: worldId,
        ownerId,
        version: 0,
        title: '胶片摄影师人生',
        time: '2026-10-16T12:00:00.000Z',
        actors: [{ id: actorId, name: '苏离', persona: '资深暗房技师', relationship: '工作搭档' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );

    // Turn 1 event: dialogue + media request 1 (succeeded & ready)
    await admin.query('BEGIN');
    await admin.query(
      `INSERT INTO parallel_life.commands (id, world_id, owner_id, expected_version, request_hash, request_payload, status, result_event_id, result_state)
       VALUES ('cmd_1', $1, $2, 0, 'hash_1', '{}', 'succeeded', $3, '{}')`,
      [worldId, ownerId, event1],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
       VALUES ($1, $2, $3, 1, 'cmd_1', '{"origin":"character"}', '2026-10-16T12:05:00.000Z')`,
      [event1, worldId, ownerId],
    );
    await admin.query('COMMIT');
    await admin.query(
      `INSERT INTO parallel_life.world_messages (id, world_id, owner_id, actor_id, document)
       VALUES ('msg_1', $1, $2, $3, $4)`,
      [
        worldId,
        ownerId,
        actorId,
        JSON.stringify({
          id: 'msg_1',
          actorId,
          role: 'assistant',
          text: '底片刚洗好，看这光影多通透！',
          at: '2026-10-16T12:05:00.000Z',
          sourceEventId: event1,
        }),
      ],
    );
    // Asset in assets table
    await admin.query(
      `INSERT INTO parallel_life.assets (id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status)
       VALUES ($1, $2, $3, 'key_film', 'image/jpeg', 1024, 1024, 1024, 'generated', 'ready')`,
      [asset1, ownerId, worldId],
    );
    // world_media_requests 1
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document)
       VALUES ($1, $2, $3, $4)`,
      [
        mediaReq1,
        worldId,
        ownerId,
        JSON.stringify({
          id: mediaReq1,
          worldId,
          prompt: '暗房红光下正在显影的黑白胶片',
          title: '【暗房记录】显影盘里的光影',
          sourceEventId: event1,
          status: 'ready',
          assetId: asset1,
          deliveryDecision: { deliverToChat: true, deliverToAlbum: true },
        }),
      ],
    );

    // Turn 2 event: dialogue + media request 2 (pending generation)
    await admin.query('BEGIN');
    await admin.query(
      `INSERT INTO parallel_life.commands (id, world_id, owner_id, expected_version, request_hash, request_payload, status, result_event_id, result_state)
       VALUES ('cmd_2', $1, $2, 1, 'hash_2', '{}', 'succeeded', $3, '{}')`,
      [worldId, ownerId, event2],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
       VALUES ($1, $2, $3, 2, 'cmd_2', '{"origin":"character"}', '2026-10-16T12:10:00.000Z')`,
      [event2, worldId, ownerId],
    );
    await admin.query('COMMIT');
    await admin.query(
      `INSERT INTO parallel_life.world_messages (id, world_id, owner_id, actor_id, document)
       VALUES ('msg_2', $1, $2, $3, $4)`,
      [
        worldId,
        ownerId,
        actorId,
        JSON.stringify({
          id: 'msg_2',
          actorId,
          role: 'assistant',
          text: '我正在调配定影液，稍等拍张照。',
          at: '2026-10-16T12:10:00.000Z',
          sourceEventId: event2,
        }),
      ],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document)
       VALUES ($1, $2, $3, $4)`,
      [
        mediaReq2,
        worldId,
        ownerId,
        JSON.stringify({
          id: mediaReq2,
          worldId,
          prompt: '量筒与试剂瓶特写',
          title: '【暗房工作】定影液调配',
          sourceEventId: event2,
          status: 'pending',
        }),
      ],
    );

    // Update world version to 2
    await admin.query(`UPDATE parallel_life.worlds SET version = 2 WHERE id = $1`, [worldId]);

    // Read phone projection via BuildRepository
    const buildRepo = new BuildRepository(db);
    const phone = await buildRepo.phone(ownerId, worldId);

    // 1. Verify phone.messages
    assert.equal(phone.messages.length, 3);
    const text1 = phone.messages.find((m) => m.id === 'msg_1');
    assert.ok(text1?.text);
    assert.equal(text1?.photoId, undefined);
    const m1 = phone.messages.find((m) => m.id === `media_${mediaReq1}`);
    assert.equal(m1?.text, '');
    assert.ok(m1);
    assert.equal(m1.photoId, asset1);
    assert.equal(m1.mediaStatus, 'ready');
    assert.equal(m1.mediaTitle, '【暗房记录】显影盘里的光影');

    const m2 = phone.messages.find((m) => m.id === 'msg_2');
    assert.ok(m2);
    assert.equal(m2.photoId, undefined);
    assert.equal(m2.mediaStatus, 'pending');
    assert.equal(m2.mediaTitle, '【暗房工作】定影液调配');

    // 2. Verify phone.photos contains generated asset
    assert.ok(phone.photos);
    const generatedPhoto = phone.photos.find((p) => p.id === asset1);
    assert.ok(generatedPhoto, 'Generated asset must be projected to album photos');
    assert.equal(generatedPhoto.title, '【暗房记录】显影盘里的光影');
    assert.equal(generatedPhoto.kind, 'generated');
    assert.equal(generatedPhoto.width, 1024);
    assert.equal(generatedPhoto.height, 1024);

    // 3. Verify worldAppData mapping
    const appData = worldAppData(phone);
    const appMsg1 = appData.messages.find((m) => m.id === `media_${mediaReq1}`);
    assert.ok(appMsg1?.photo);
    assert.equal(appMsg1.photo?.id, asset1);
    assert.equal(appMsg1.photo?.status, 'ready');
    assert.equal(appMsg1.photo?.url, `/api/v1/assets/${asset1}?worldId=${worldId}&revision=1`);

    const appMsg2 = appData.messages.find((m) => m.id === 'msg_2');
    assert.ok(appMsg2?.photo);
    assert.equal(appMsg2.photo?.status, 'generating');
    assert.equal(appMsg2.photo?.url, undefined);

    // 4. Test delivery decision suppression: deliverToChat=false and deliverToAlbum=false
    await admin.query(
      `UPDATE parallel_life.world_media_requests
       SET document = document || '{"deliveryDecision":{"deliverToChat":false,"deliverToAlbum":false}}'::jsonb
       WHERE id = $1`,
      [mediaReq1],
    );

    const phoneSuppressed = await buildRepo.phone(ownerId, worldId);
    const m1Suppressed = phoneSuppressed.messages.find((m) => m.id === 'msg_1');
    assert.equal(
      m1Suppressed?.photoId,
      undefined,
      'deliverToChat=false must suppress message attachment',
    );
    assert.equal(m1Suppressed?.mediaStatus, undefined);
    assert.equal(
      phoneSuppressed.messages.some((m) => m.id === `media_${mediaReq1}`),
      false,
    );

    const photoSuppressed = phoneSuppressed.photos?.find((p) => p.id === asset1);
    assert.equal(photoSuppressed, undefined, 'deliverToAlbum=false must suppress album inclusion');
  } finally {
    await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    await admin.end();
    await db.close();
  }
});
