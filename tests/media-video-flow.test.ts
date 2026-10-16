import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { routeUserIntent } from '../src/modules/world/application/intent-router.ts';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import { checkMediaQuota, DEFAULT_MEDIA_BUDGET } from '../src/modules/media/domain/consistency-guard.ts';
import { isValidMediaMagicBytes } from '../src/modules/media/domain/magic-bytes.ts';
import { createMediaPipelineHandler } from '../src/modules/media/infrastructure/media-pipeline-handler.ts';
import type { TaskLease } from '../src/modules/tasks/domain/types.ts';
import type { WorldState, WorldEvent, WorldEffect } from '../src/modules/world/domain/types.ts';

// ---------------------------------------------------------------------------
// 1. Intent Router: Video Intent Detection & Non-blocking Invariants
// ---------------------------------------------------------------------------

test('routeUserIntent - Explicit natural language requests for video route to video mode', () => {
  const videoInputs = [
    '发段视频看看现场',
    '发个小视频过来',
    '拍段视频给我看',
    '拍个视频记录一下',
    '录段视频发来看看',
    '录个视频',
    '看看现场动态小视频',
  ];

  for (const input of videoInputs) {
    const result = routeUserIntent({ text: input });
    assert.equal(
      result.turnMode,
      'video',
      `Input "${input}" should resolve to turnMode: 'video'`,
    );
    assert.equal(result.isAction, false);
    assert.ok(result.videoPrompt, `Input "${input}" should have videoPrompt`);
  }
});

test('routeUserIntent - Explicit videoRequest parameter routes to video mode', () => {
  const result = routeUserIntent({
    text: '现场好热闹',
    videoRequest: '舞台中央的乐队演奏片段',
  });
  assert.equal(result.turnMode, 'video');
  assert.equal(result.videoPrompt, '舞台中央的乐队演奏片段');
  assert.equal(result.isAction, false);
});

test('routeUserIntent - Normal conversation NEVER defaults to video or image generation', () => {
  const normalInputs = [
    '今天过得怎么样？',
    '我刚到公司，先去忙了。',
    '晚上要不要一起吃晚饭？',
    '收到，好的。',
    '哈哈太有意思了！',
    '明天上午十点见。',
  ];

  for (const input of normalInputs) {
    const result = routeUserIntent({ text: input });
    assert.equal(
      result.turnMode,
      'chat',
      `Normal input "${input}" must strictly default to 'chat' without media generation`,
    );
    assert.equal(result.imagePrompt, undefined);
    assert.equal(result.videoPrompt, undefined);
    assert.equal(result.isAction, false);
  }
});

// ---------------------------------------------------------------------------
// 2. Domain Reducer: media.requested with video mediaType
// ---------------------------------------------------------------------------

test('applyEvent - media.requested with video mediaType generates video outbox job and mediaRequest', () => {
  const worldId = randomUUID();
  const eventId = randomUUID();
  const mediaEffectId = `${eventId}_media`;

  const state: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: randomUUID(),
    version: 1,
    title: '测试世界',
    time: '2026-10-16T12:00:00.000Z',
    actors: [
      {
        id: 'npc_1',
        name: '小安',
        relationship: '摄影师朋友',
        persona: '热心细致',
      },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const effects: WorldEffect[] = [
    {
      type: 'message.received',
      id: `${eventId}_msg`,
      actorId: 'npc_1',
      text: '刚拍了一段演出现场的视频给你看！',
    },
    {
      type: 'media.requested',
      id: mediaEffectId,
      prompt: '演出现场灯光闪烁，观众欢呼的动态片段',
      mediaType: 'video',
    },
  ];

  const event: WorldEvent = {
    schemaVersion: 1,
    id: eventId,
    worldId,
    version: 2,
    commandId: randomUUID(),
    occurredAt: '2026-10-16T12:01:00.000Z',
    type: 'turn.resolved',
    data: {
      actorId: 'npc_1',
      userText: '发段演出的视频看看',
      effects,
    },
  };

  const { state: newState, jobs } = applyEvent(state, event);

  // Verify mediaRequests in state
  assert.equal(newState.mediaRequests.length, 1);
  const req = newState.mediaRequests[0]!;
  assert.equal(req.id, mediaEffectId);
  assert.equal(req.status, 'pending');
  assert.equal(req.mediaType, 'video');
  assert.equal(req.prompt, '演出现场灯光闪烁，观众欢呼的动态片段');

  // Verify outbox job
  assert.equal(jobs.length, 1);
  const job = jobs[0]!;
  assert.equal(job.type, 'video.generate');
  assert.equal(job.mediaType, 'video');
  assert.equal(job.requestId, mediaEffectId);
  assert.equal(job.prompt, '演出现场灯光闪烁，观众欢呼的动态片段');
});

// ---------------------------------------------------------------------------
// 3. Quota and Budget Enforcement for Videos
// ---------------------------------------------------------------------------

test('checkMediaQuota - Video generation enforces strict per-world video quota limit', () => {
  const budget = {
    ...DEFAULT_MEDIA_BUDGET,
    maxVideosPerWorld: 2,
  };

  // Under limit: 0 or 1 video -> allowed
  assert.deepEqual(checkMediaQuota(0, budget, 'video'), { allowed: true });
  assert.deepEqual(checkMediaQuota(1, budget, 'video'), { allowed: true });

  // At limit: 2 videos -> blocked
  const atLimit = checkMediaQuota(2, budget, 'video');
  assert.equal(atLimit.allowed, false);
  assert.match(atLimit.reason ?? '', /EXCEEDED_WORLD_MEDIA_QUOTA/);
  assert.match(atLimit.reason ?? '', /limit of 2 videos/);

  // Above limit: 3 videos -> blocked
  const aboveLimit = checkMediaQuota(3, budget, 'video');
  assert.equal(aboveLimit.allowed, false);
});

// ---------------------------------------------------------------------------
// 4. Magic Bytes Validation for MP4 Video Container
// ---------------------------------------------------------------------------

test('isValidMediaMagicBytes - Correctly validates MP4 binary signature and rejects invalid files', () => {
  // Valid MP4 container (starts with ftyp box at offset 4)
  const validMp4 = Buffer.from([
    0x00, 0x00, 0x00, 0x20, // size: 32
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00,
  ]);
  const checkMp4 = isValidMediaMagicBytes(validMp4);
  assert.equal(checkMp4.valid, true);
  assert.equal(checkMp4.type, 'video');
  assert.equal(checkMp4.mimeType, 'video/mp4');

  // Corrupted or plain text pretending to be MP4
  const fakeVideo = Buffer.from('NOT_A_REAL_VIDEO_STREAM');
  const checkFake = isValidMediaMagicBytes(fakeVideo);
  assert.equal(checkFake.valid, false);
});

// ---------------------------------------------------------------------------
// 5. Media Pipeline Handler: Video Generation Execution & Persistence
// ---------------------------------------------------------------------------

test('createMediaPipelineHandler - Video request invokes executeVideoPipeline and commits MP4 asset', async () => {
  const requestId = randomUUID();
  const worldId = randomUUID();
  const ownerId = randomUUID();
  const generatedAssetId = randomUUID();

  // Create a minimal fake task queue
  let committedState: any = null;
  const mockQueue: any = {
    read: async (_lease: TaskLease, fn: any) => {
      const mockSql = {
        query: async (text: string) => {
          if (text.includes('FROM parallel_life.world_media_requests')) {
            return {
              rows: [
                {
                  world_id: worldId,
                  outbox_id: 'outbox_video_job_1',
                  document: {
                    id: requestId,
                    mediaType: 'video',
                    prompt: '落日余晖中海浪翻滚的动态镜头',
                    targetActorId: 'player',
                    sourceEventId: 'event_123',
                  },
                },
              ],
            };
          }
          if (text.includes('SELECT count(*)::int as count FROM parallel_life.assets')) {
            return { rows: [{ count: 0 }] };
          }
          if (text.includes('SELECT state->>\'status\' AS status FROM parallel_life.worlds')) {
            return { rows: [{ status: 'active' }] };
          }
          return { rows: [] };
        },
      };
      return await fn(mockSql);
    },
    commit: async (_lease: TaskLease, fn: any) => {
      const insertedAssets: any[] = [];
      const updatedMediaRequests: any[] = [];
      const finishedJobs: any[] = [];

      const mockSql = {
        query: async (text: string, params: any[]) => {
          if (text.includes('INSERT INTO parallel_life.assets')) {
            insertedAssets.push(params);
            return { rowCount: 1 };
          }
          if (text.includes('UPDATE parallel_life.world_media_requests')) {
            updatedMediaRequests.push(params);
            return { rowCount: 1 };
          }
          if (text.includes('finish_outbox_job')) {
            finishedJobs.push(params);
            return { rowCount: 1 };
          }
          return { rows: [] };
        },
      };
      committedState = { insertedAssets, updatedMediaRequests, finishedJobs };
      return await fn(mockSql);
    },
  };

  let videoPipelineCalledWith: any = null;
  const mockPipelineService: any = {
    executeVideoPipeline: async (params: any) => {
      videoPipelineCalledWith = params;
      return {
        assetId: generatedAssetId,
        storageKey: `worlds/${worldId}/generated/${generatedAssetId}.mp4`,
        mimeType: 'video/mp4',
        byteLength: 1048576,
        width: 1280,
        height: 720,
        referenceAssetIds: [],
        prompt: '落日余晖中海浪翻滚的动态镜头',
        providerTaskId: 'replicate-video-task-1',
        deliveryDecision: {
          channel: 'chat',
          approved: true,
        },
      };
    },
    executeImagePipeline: async () => {
      throw new Error('Should not call executeImagePipeline for video request');
    },
  };

  const handler = createMediaPipelineHandler(mockQueue, mockPipelineService);
  const lease: TaskLease = {
    id: 'task_video_1',
    scopeId: requestId,
    ownerId,
    kind: 'media',
    input: {},
    token: 'token_1',
  };

  await handler(lease);

  // 1. Verify executeVideoPipeline was called with correct intent
  assert.ok(videoPipelineCalledWith, 'executeVideoPipeline must be called');
  assert.equal(videoPipelineCalledWith.intent.purpose, 'character_action');
  assert.equal(videoPipelineCalledWith.intent.actionDescription, '落日余晖中海浪翻滚的动态镜头');

  // 2. Verify committed asset has MP4 mime_type
  assert.ok(committedState, 'Commit must take place');
  assert.equal(committedState.insertedAssets.length, 1);
  const assetParams = committedState.insertedAssets[0];
  assert.equal(assetParams[0], generatedAssetId);
  assert.equal(assetParams[1], ownerId);
  assert.equal(assetParams[2], worldId);
  assert.equal(assetParams[4], 'video/mp4'); // mimeType

  // 3. Verify world_media_requests was updated to ready
  assert.equal(committedState.updatedMediaRequests.length, 1);
  assert.equal(committedState.updatedMediaRequests[0][0], requestId);
  assert.equal(committedState.updatedMediaRequests[0][1], generatedAssetId);

  // 4. Verify outbox job was finished
  assert.equal(committedState.finishedJobs.length, 1);
  assert.equal(committedState.finishedJobs[0][0], 'outbox_video_job_1');
  assert.equal(committedState.finishedJobs[0][1], generatedAssetId);
});

// ---------------------------------------------------------------------------
// 6. Application resolveTurn: Non-blocking text dialogue with video request
// ---------------------------------------------------------------------------

test('resolveTurn - Asking for video commits video media.requested while returning text reply immediately', async () => {
  const { MemoryWorldRepository } = await import('../src/modules/world/infrastructure/memory-world-repository.ts');
  const { resolveTurn } = await import('../src/modules/world/application/resolve-turn.ts');

  const testTime = '2026-10-16T12:00:00.000Z';
  const worldSeed: WorldState = {
    schemaVersion: 1,
    id: 'world-video-turn-1',
    ownerId: 'user-turn-1',
    version: 0,
    title: '视频意图测试',
    time: testTime,
    actors: [{ id: 'friend_1', name: '小安', persona: '摄影搭档' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const worlds = new MemoryWorldRepository([worldSeed]);
  let plannerInvoked = false;

  const result = await resolveTurn(
    {
      worlds,
      planner: {
        propose: async () => {
          plannerInvoked = true;
          return {
            schemaVersion: 1 as const,
            effects: [
              {
                type: 'message.received' as const,
                id: 'reply-1',
                actorId: 'friend_1',
                text: '好啊，我刚好录了一小段现场的演奏，发你看看！',
              },
            ],
          };
        },
      },
      now: () => testTime,
      newId: () => 'event-video-turn-1',
    },
    { userId: 'user-turn-1' },
    {
      id: 'cmd-video-1',
      worldId: 'world-video-turn-1',
      actorId: 'friend_1',
      text: '发段视频看看现场',
      expectedVersion: 0,
    },
  );

  // 1. Text dialogue was generated and returned without blocking
  assert.equal(plannerInvoked, true);
  const effects = (result.event.data as { effects: any[] }).effects;
  const replyMessage = effects.find((e) => e.type === 'message.received');
  assert.ok(replyMessage, 'Character reply message must be returned');
  assert.equal(replyMessage.text, '好啊，我刚好录了一小段现场的演奏，发你看看！');

  // 2. Video media request was generated with mediaType: 'video'
  const mediaReq = effects.find((e) => e.type === 'media.requested');
  assert.ok(mediaReq, 'media.requested effect must be generated');
  assert.equal(mediaReq.mediaType, 'video');
  assert.equal(mediaReq.prompt, '发段视频看看现场');
});

// ---------------------------------------------------------------------------
// 7. Full PostgreSQL Integration: Video Projection in Messages and Album
// ---------------------------------------------------------------------------

test('PostgreSQL integration - Video media request projections to phone messages and album', async () => {
  const { localConfig } = await import('../scripts/local-config.mjs');
  const { adminClient } = await import('../scripts/db-admin.mjs');
  const { migrate } = await import('../scripts/migrate.mjs');
  const { PostgresDatabase } = await import('../src/modules/storage/infrastructure/postgres.ts');
  const { BuildRepository } = await import('../src/modules/world/infrastructure/build-repository.ts');
  const { PostgresWorldRepository } = await import('../src/modules/world/infrastructure/postgres-world-repository.ts');
  const { albumPhotos } = await import('../src/modules/media/infrastructure/album-projection.ts');

  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`;
  const db = new PostgresDatabase(appUrl);

  const ownerId = 'test_owner_video_' + Date.now();
  const worldId = randomUUID();
  const actorId = randomUUID();
  const event1 = randomUUID();
  const event2 = randomUUID();
  const cmd1 = randomUUID();
  const cmd2 = randomUUID();
  const msg1Id = randomUUID();
  const msg2Id = randomUUID();
  const mediaReqId = randomUUID();
  const videoAssetId = randomUUID();

  const profileId = randomUUID();
  const seedId = randomUUID();
  const seedCmdId = randomUUID();
  const directionId = randomUUID();

  const seed = {
    id: seedId,
    createdAt: new Date().toISOString(),
    profileVersion: 0,
    discoveryVersion: 1,
    directionId,
    story: {
      title: '纪录片导演人生',
      premise: '捕捉动态真实',
      opening: '开机录制',
      tradeoff: '胶卷有限',
    },
    facts: [],
    people: [],
    portraitAssetId: null,
    assets: [],
  };

  try {
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [ownerId]);
    await admin.query(
      `INSERT INTO parallel_life.profiles (id, owner_id, version, document) VALUES ($1, $2, 0, $3)`,
      [profileId, ownerId, { id: profileId, version: 0, facts: [], events: [], people: [] }],
    );
    await admin.query(
      `INSERT INTO parallel_life.approved_seeds (id, owner_id, profile_id, command_id, request_hash, document)
       VALUES ($1, $2, $3, $4, 'hash_video_seed', $5)`,
      [seedId, ownerId, profileId, seedCmdId, JSON.stringify(seed)],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_builds (seed_id, owner_id, world_id, opening)
       VALUES ($1, $2, $3, $4)`,
      [
        seedId,
        ownerId,
        worldId,
        JSON.stringify({ identity: '纪录片导演', setting: '拍摄现场' }),
      ],
    );

    const worldRepo = new PostgresWorldRepository(db);
    await worldRepo.initialize(
      { userId: ownerId },
      {
        schemaVersion: 1,
        id: worldId,
        ownerId,
        version: 0,
        title: '纪录片导演人生',
        time: '2026-10-16T12:00:00.000Z',
        actors: [{ id: actorId, name: '林导', persona: '专注严谨', relationship: '导演伙伴' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );

    // Insert events and commands wrapped in BEGIN ... COMMIT
    await admin.query(`
      BEGIN;
      INSERT INTO parallel_life.commands (id, world_id, owner_id, expected_version, request_hash, request_payload, status, result_event_id, result_state)
      VALUES
        ('${cmd1}', '${worldId}', '${ownerId}', 0, 'hash_cmd_1', '{}', 'succeeded', '${event1}', '{}'),
        ('${cmd2}', '${worldId}', '${ownerId}', 1, 'hash_cmd_2', '{}', 'succeeded', '${event2}', '{}');

      INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
      VALUES
        ('${event1}', '${worldId}', '${ownerId}', 1, '${cmd1}', '{"origin":"character"}', '2026-10-16T12:01:00.000Z'),
        ('${event2}', '${worldId}', '${ownerId}', 2, '${cmd2}', '{"origin":"character"}', '2026-10-16T12:05:00.000Z');

      INSERT INTO parallel_life.world_messages (id, world_id, owner_id, actor_id, document)
      VALUES
        ('${msg1Id}', '${worldId}', '${ownerId}', '${actorId}', jsonb_build_object(
          'id', '${msg1Id}',
          'actorId', '${actorId}',
          'role', 'assistant',
          'text', '刚拍好的动态样片，发你先过目。',
          'at', '2026-10-16T12:01:05.000Z',
          'sourceEventId', '${event1}'
        )),
        ('${msg2Id}', '${worldId}', '${ownerId}', '${actorId}', jsonb_build_object(
          'id', '${msg2Id}',
          'actorId', '${actorId}',
          'role', 'assistant',
          'text', '好的，下午见。',
          'at', '2026-10-16T12:05:05.000Z',
          'sourceEventId', '${event2}'
        ));

      INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document)
      VALUES
        ('${mediaReqId}', '${worldId}', '${ownerId}', jsonb_build_object(
          'id', '${mediaReqId}',
          'prompt', '现场拍摄样片动态片段',
          'title', '【事件记录】现场动态样片',
          'status', 'pending',
          'mediaType', 'video',
          'sourceEventId', '${event1}'
        ));

      UPDATE parallel_life.worlds SET version = 2 WHERE id = '${worldId}';
      COMMIT;
    `);

    const buildRepo = new BuildRepository(db);

    // 1. Pending state projection: message has mediaStatus: 'pending' and mediaType: 'video'
    const phonePending = await buildRepo.phone(ownerId, worldId);
    const msg1Pending = phonePending.messages.find((m) => m.id === msg1Id);
    assert.ok(msg1Pending);
    assert.equal(msg1Pending.mediaStatus, 'pending');
    assert.equal(msg1Pending.mediaType, 'video');
    assert.equal(msg1Pending.mediaTitle, '【事件记录】现场动态样片');

    // Message 2 has NO media request, text is completely normal
    const msg2 = phonePending.messages.find((m) => m.id === msg2Id);
    assert.ok(msg2);
    assert.equal(msg2.mediaStatus, undefined);
    assert.equal(msg2.photoId, undefined);

    // 2. Video completes: insert MP4 asset and mark world_media_requests ready
    await admin.query(`
      BEGIN;
      INSERT INTO parallel_life.assets (id, owner_id, world_id, storage_key, mime_type, byte_length, width, height, origin, status)
      VALUES ('${videoAssetId}', '${ownerId}', '${worldId}', 'worlds/${worldId}/generated/${videoAssetId}.mp4', 'video/mp4', 2097152, 1280, 720, 'generated', 'ready');

      UPDATE parallel_life.world_media_requests
      SET document = document || jsonb_build_object(
        'status', 'ready',
        'assetId', '${videoAssetId}',
        'deliveryDecision', jsonb_build_object('deliverToChat', true, 'deliverToAlbum', true)
      )
      WHERE id = '${mediaReqId}';
      COMMIT;
    `);

    // 3. Ready state projection: message has mediaStatus: 'ready', photoId: videoAssetId, mediaType: 'video'
    const phoneReady = await buildRepo.phone(ownerId, worldId);
    const msg1Ready = phoneReady.messages.find((m) => m.id === msg1Id);
    assert.ok(msg1Ready);
    assert.equal(msg1Ready.mediaStatus, 'ready');
    assert.equal(msg1Ready.photoId, videoAssetId);
    assert.equal(msg1Ready.mediaType, 'video');

    // 4. Album projection: albumPhotos returns the video asset with mimeType: 'video/mp4'
    await db.transaction(ownerId, async (sql) => {
      const photos = await albumPhotos(sql, worldId);
      const videoPhoto = photos.find((p) => p.id === videoAssetId);
      assert.ok(videoPhoto, 'Generated video must appear in album');
      assert.equal(videoPhoto.mimeType, 'video/mp4');
      assert.equal(videoPhoto.kind, 'generated');
      assert.equal(videoPhoto.title, '【事件记录】现场动态样片');
    });
  } finally {
    try {
      await admin.query(`DELETE FROM parallel_life.accounts WHERE id = $1`, [ownerId]);
    } catch {}
    try {
      await admin.end();
    } catch {}
    try {
      await db.close();
    } catch {}
  }
});

