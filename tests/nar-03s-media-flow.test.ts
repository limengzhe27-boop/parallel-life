import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unsupportedReturnClaim } from '../src/modules/world/domain/return-message-policy.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import { routeUserIntent } from '../src/modules/world/application/intent-router.ts';
import {
  checkMediaQuota,
  DEFAULT_MEDIA_BUDGET,
} from '../src/modules/media/domain/consistency-guard.ts';
import { resolveCharacterReference } from '../src/modules/media/domain/character-reference-resolver.ts';
import { createMediaPipelineHandler } from '../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { MediaPipelineService } from '../src/modules/media/infrastructure/media-pipeline-service.ts';
import { albumPhotos } from '../src/modules/media/infrastructure/album-projection.ts';
import { BuildRepository } from '../src/modules/world/infrastructure/build-repository.ts';

function createMockWorldState(): WorldState {
  return {
    schemaVersion: 1,
    id: 'world-nar03s-1',
    ownerId: 'owner-nar03s',
    version: 1,
    title: '测试世界',
    time: '2026-10-17T02:00:00.000Z',
    actors: [
      { id: 'actor-laozhou', name: '老周', persona: '修车师傅', relationship: '老邻居' },
      { id: 'actor-xiaofang', name: '小芳', persona: '摄影爱好者', relationship: '朋友' },
    ],
    facts: [],
    messages: [
      {
        id: 'msg-1',
        actorId: 'actor-laozhou',
        role: 'assistant',
        text: '修车铺今天开门了。',
        at: '2026-10-17T01:00:00.000Z',
        sourceEventId: 'ev-1',
      },
    ],
    appointments: [
      {
        id: 'apt-1',
        title: '修车铺碰面',
        at: '2026-10-17T01:30:00.000Z',
        participantIds: ['actor-laozhou'],
        sourceEventId: 'ev-apt-1',
        status: 'attended',
      },
    ],
    mediaRequests: [],
  };
}

test('1. Return message policy guards: false photo claims rejected, honest references allowed', () => {
  const state = createMockWorldState();

  // (A) Without any ready media, claiming photo is ready/sent is rejected
  assert.equal(unsupportedReturnClaim(state, 'actor-laozhou', '照片已经拍好了'), true);
  assert.equal(unsupportedReturnClaim(state, 'actor-laozhou', '刚拍的照片发你看看'), true);
  assert.equal(unsupportedReturnClaim(state, 'actor-laozhou', '合影发给你了'), true);

  // Normal conversation not claiming photos is allowed
  assert.equal(
    unsupportedReturnClaim(state, 'actor-laozhou', '今天修车铺零件到了，你随时可以过来'),
    false,
  );

  // (B) When a ready media exists for direct turn message
  state.mediaRequests.push({
    id: 'req-photo-1',
    prompt: '修车铺工作照',
    title: '【事件记录】修车铺留影',
    status: 'ready',
    assetId: randomUUID(),
    sourceEventId: 'ev-1', // Matches msg-1 from actor-laozhou
    mediaType: 'image',
  });

  // Now honest reference to the photo is supported!
  assert.equal(unsupportedReturnClaim(state, 'actor-laozhou', '照片已经拍好了'), false);
  assert.equal(unsupportedReturnClaim(state, 'actor-laozhou', '刚才的照片发给你了'), false);

  // But another actor without ready media is still blocked
  assert.equal(unsupportedReturnClaim(state, 'actor-xiaofang', '照片拍好了'), true);
});

test('2. Intent routing & character reference: on-demand photo requests route properly and never steal player portrait', () => {
  // Explicit photo request routes to image mode
  const explicitImage = routeUserIntent({ text: '能发张你那里的照片给我看看吗？' });
  assert.equal(explicitImage.turnMode, 'image');

  // Regular dialogue stays chat mode (never spams media)
  const regularChat = routeUserIntent({ text: '好的，我明天下午过去找你。' });
  assert.equal(regularChat.turnMode, 'chat');

  // Character reference resolver: NPC without bound portrait never steals player portrait
  const playerPortraitId = randomUUID();
  const resolutionWithoutBinding = resolveCharacterReference({
    intent: {
      purpose: 'portrait',
      sceneDescription: '老周在修车',
      targetActorId: 'actor-laozhou',
    },
    callerActorId: 'actor-laozhou',
    isCallerPlayer: false,
    targetAnchor: {
      actorId: 'actor-laozhou',
      name: '老周',
      isPlayer: false,
      authorizedForWorld: true,
      clothingStyle: '深蓝色工装',
      referenceAssetId: undefined, // No photo uploaded for him
    },
    playerPortraitAssetId: playerPortraitId, // Player HAS a photo
  });

  assert.equal(resolutionWithoutBinding.allowed, true);
  assert.equal(resolutionWithoutBinding.mode, 'text_anchored_only');
  // Must NOT steal player portrait!
  assert.notEqual((resolutionWithoutBinding as any).referenceAssetId, playerPortraitId);
  assert.equal((resolutionWithoutBinding as any).referenceAssetId, undefined);
  assert(resolutionWithoutBinding.characterPromptSnippet?.includes('深蓝色工装'));
});

test('3. Hard media budget quota: enforces 12 images limit and rejects gracefully', () => {
  const budget = DEFAULT_MEDIA_BUDGET;
  assert.equal(budget.maxImagesPerWorld, 12);

  // 11 images: allowed
  const check11 = checkMediaQuota(11, budget, 'image');
  assert.equal(check11.allowed, true);

  // 12 images: strictly blocked
  const check12 = checkMediaQuota(12, budget, 'image');
  assert.equal(check12.allowed, false);
  assert(check12.reason?.includes('EXCEEDED_WORLD_MEDIA_QUOTA'));
});

test('4. End-to-end PostgreSQL integration: static media creation, idempotency, failure handling, and album-chat consistency', async () => {
  let admin: any;
  let db: any;
  try {
    const { localConfig } = await import('../scripts/local-config.mjs');
    const { adminClient } = await import('../scripts/db-admin.mjs');
    const { migrate } = await import('../scripts/migrate.mjs');
    const { PostgresDatabase } = await import('../src/modules/storage/infrastructure/postgres.ts');

    admin = await adminClient('parallel_life_test');
    await migrate(admin);
    const config = await localConfig();
    const appUrl = `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`;
    db = new PostgresDatabase(appUrl);
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      console.warn('PostgreSQL database not available for integration test, skipping real-db test');
      return;
    }
    throw err;
  }

  const { PostgresWorldRepository } =
    await import('../src/modules/world/infrastructure/postgres-world-repository.ts');
  const ownerId = 'test_owner_nar03s_' + Date.now();
  const worldId = randomUUID();
  const actorId = randomUUID();
  const event1 = randomUUID();
  const cmd1 = randomUUID();
  const requestId = randomUUID();
  const assetId = randomUUID();
  const msg1Id = randomUUID();

  const profileId = randomUUID();
  const seedId = randomUUID();
  const seedCmdId = randomUUID();
  const directionId = randomUUID();

  try {
    // Insert seed profile and account
    await admin.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      ownerId,
    ]);
    await admin.query(
      `INSERT INTO parallel_life.profiles (id, owner_id, version, document) VALUES ($1, $2, 0, $3)`,
      [profileId, ownerId, { id: profileId, version: 0, facts: [], events: [], people: [] }],
    );

    const seed = {
      id: seedId,
      createdAt: new Date().toISOString(),
      profileVersion: 0,
      discoveryVersion: 1,
      directionId,
      story: {
        title: '静态媒体联动测试',
        premise: '故事开端',
        opening: '老周修车铺',
        tradeoff: '成本控制',
      },
      facts: [],
      people: [],
      portraitAssetId: null,
      assets: [],
    };

    await admin.query(
      `INSERT INTO parallel_life.approved_seeds (id, owner_id, profile_id, command_id, request_hash, document)
       VALUES ($1, $2, $3, $4, 'hash_seed_nar03s', $5)`,
      [seedId, ownerId, profileId, seedCmdId, JSON.stringify(seed)],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_builds (seed_id, owner_id, world_id, opening)
       VALUES ($1, $2, $3, $4)`,
      [seedId, ownerId, worldId, JSON.stringify({ identity: '修车学徒', setting: '县城修车铺' })],
    );

    const worldRepo = new PostgresWorldRepository(db);
    await worldRepo.initialize(
      { userId: ownerId },
      {
        schemaVersion: 1,
        id: worldId,
        ownerId,
        version: 0,
        title: '静态媒体联动测试世界',
        time: '2026-10-17T02:00:00.000Z',
        actors: [{ id: actorId, name: '老周', persona: '修车师傅', relationship: '老邻居' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );

    // 1. Setup Turn 1 event + pending media request
    await admin.query('BEGIN');
    await admin.query(
      `INSERT INTO parallel_life.commands (id, world_id, owner_id, expected_version, request_hash, request_payload, status, result_event_id, result_state)
       VALUES ($1, $2, $3, 0, 'hash_nar03s_1', '{}', 'succeeded', $4, '{}')`,
      [cmd1, worldId, ownerId, event1],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
       VALUES ($1, $2, $3, 1, $4, $5::jsonb, now())`,
      [
        event1,
        worldId,
        ownerId,
        cmd1,
        JSON.stringify({
          id: event1,
          worldId,
          version: 1,
          storyAt: '2026-10-17T02:00:00.000Z',
          data: { actorId },
        }),
      ],
    );
    await admin.query('COMMIT');
    await admin.query('UPDATE parallel_life.worlds SET version = 1 WHERE id = $1', [worldId]);

    await admin.query(
      `INSERT INTO parallel_life.world_messages (id, world_id, owner_id, actor_id, document)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        msg1Id,
        worldId,
        ownerId,
        actorId,
        JSON.stringify({
          id: msg1Id,
          actorId,
          role: 'assistant',
          text: '我把刚才拍的照片发你了。',
          at: '2026-10-17T02:00:00.000Z',
          sourceEventId: event1,
        }),
      ],
    );

    await admin.query(
      `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        requestId,
        worldId,
        ownerId,
        JSON.stringify({
          id: requestId,
          worldId,
          prompt: '老周在修车铺检修摩托车',
          title: '【现场留影】修车铺',
          status: 'pending',
          sourceEventId: event1,
          mediaType: 'image',
          targetActorId: actorId,
        }),
      ],
    );

    await admin.query(
      `INSERT INTO parallel_life.outbox_jobs (id, world_id, owner_id, event_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        `job_${requestId}`,
        worldId,
        ownerId,
        event1,
        JSON.stringify({ type: 'image.generate', requestId, prompt: '老周在修车铺检修摩托车' }),
      ],
    );

    // 2. Check BuildRepository.phone before pipeline execution: message shows pending generating state
    const buildRepo = new BuildRepository(db);
    const phoneBefore = await buildRepo.phone(ownerId, worldId);
    const msgBefore = phoneBefore.messages.find((m) => m.id === msg1Id);
    assert.ok(msgBefore);
    assert.equal(msgBefore.mediaStatus, 'pending');
    assert.equal(msgBefore.photoId, undefined);

    // 3. Mock Pipeline Service returning a generated JPEG
    const mockAdapter = {
      submitImage: async () => ({
        status: 'succeeded' as const,
        providerTaskId: 'mock-task-1',
        outputUrls: ['https://storage.example.com/generated-photo.jpg'],
      }),
      queryImage: async () => ({ status: 'succeeded' as const }),
      cancelImage: async () => true,
      submitVideo: async () => ({ status: 'succeeded' as const, providerTaskId: 'task-v' }),
      queryVideo: async () => ({ status: 'succeeded' as const }),
      cancelVideo: async () => true,
    };

    const mockAssetStore = {
      put: async () => {},
      get: async () => Buffer.from([]),
      remove: async () => {},
    };

    const mockAnchorRepo = {
      findActorVisualAnchor: async () => ({
        actorId,
        name: '老周',
        isPlayer: false,
        authorizedForWorld: true,
        appearanceSnippet: '中年修车工',
      }),
      findPlayerVisualAnchor: async () => null,
    };

    const { default: sharp } = await import('sharp');
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 100, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const pipelineService = new MediaPipelineService({
      providerAdapter: mockAdapter as any,
      assetStore: mockAssetStore as any,
      visualAnchorRepo: mockAnchorRepo as any,
      fetchFn: async () =>
        ({
          ok: true,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: async () =>
            pngBuffer.buffer.slice(
              pngBuffer.byteOffset,
              pngBuffer.byteOffset + pngBuffer.byteLength,
            ),
        }) as any,
    });

    const mockQueue = {
      read: async (_lease: any, fn: (sql: any) => Promise<any>) => {
        return db.transaction(ownerId, async (sql: any) => fn(sql));
      },
      commit: async (_lease: any, fn: (sql: any) => Promise<any>) => {
        return db.transaction(ownerId, async (sql: any) => fn(sql));
      },
    };

    const handler = createMediaPipelineHandler(mockQueue as any, pipelineService);

    // 4. Execute the pipeline handler
    await handler({
      id: 'lease-1',
      ownerId,
      scopeId: requestId,
      kind: 'media',
    } as any);

    // 5. Verify database state after execution
    let generatedAssetId: string = '';
    await db.transaction(ownerId, async (sql: any) => {
      // (A) Media request updated to ready
      const reqRow = (
        await sql.query(`SELECT document FROM parallel_life.world_media_requests WHERE id = $1`, [
          requestId,
        ])
      ).rows[0];
      assert.equal(reqRow.document.status, 'ready');
      generatedAssetId = reqRow.document.assetId;
      assert.ok(generatedAssetId);

      // (B) Asset inserted in parallel_life.assets
      const assetRow = (
        await sql.query(`SELECT * FROM parallel_life.assets WHERE id = $1`, [generatedAssetId])
      ).rows[0];
      assert.ok(assetRow);
      assert.equal(assetRow.origin, 'generated');
      assert.equal(assetRow.status, 'ready');
      assert.equal(assetRow.mime_type, 'image/png');

      // (C) Outbox job marked succeeded
      const outboxRow = (
        await sql.query(`SELECT status FROM parallel_life.outbox_jobs WHERE id = $1`, [
          `job_${requestId}`,
        ])
      ).rows[0];
      assert.equal(outboxRow.status, 'succeeded');

      // (D) Album projection includes the generated photo with same assetId!
      const photos = await albumPhotos(sql, worldId);
      const generatedPhoto = photos.find((p) => p.id === generatedAssetId);
      assert.ok(generatedPhoto, 'Generated asset must appear in album projection');
      assert.equal(generatedPhoto.kind, 'generated');
      assert.equal(generatedPhoto.title, '【现场留影】修车铺');
    });

    // 6. Verify BuildRepository.phone projection: message attaches the photoId!
    // Update world snapshot in db
    await db.transaction(ownerId, async (sql: any) => {
      const updatedReq = (
        await sql.query(`SELECT document FROM parallel_life.world_media_requests WHERE id = $1`, [
          requestId,
        ])
      ).rows[0].document;

      await sql.query(
        `UPDATE parallel_life.worlds
         SET state = jsonb_set(
           state,
           '{mediaRequests}',
           to_jsonb(ARRAY[$1::jsonb])
         )
         WHERE id = $2`,
        [JSON.stringify(updatedReq), worldId],
      );
    });

    const phoneAfter = await buildRepo.phone(ownerId, worldId);
    const msgAfter = phoneAfter.messages.find((m) => m.photoId === generatedAssetId);
    assert.equal(phoneAfter.messages.find((m) => m.id === msg1Id)?.photoId, undefined);
    assert.equal(msgAfter?.text, '');
    assert.ok(msgAfter);
    assert.equal(msgAfter.photoId, generatedAssetId);
    assert.equal(msgAfter.mediaStatus, 'ready');
    assert.equal(msgAfter.mediaTitle, '【现场留影】修车铺');
    assert.equal(msgAfter.mediaType, 'image');

    // 7. Verify Idempotent Replay: running handler again does not call provider or duplicate assets
    let providerCalls = 0;
    const countingAdapter = {
      ...mockAdapter,
      submitImage: async () => {
        providerCalls++;
        return mockAdapter.submitImage();
      },
    };
    const handlerReplay = createMediaPipelineHandler(
      mockQueue as any,
      new MediaPipelineService({
        providerAdapter: countingAdapter as any,
        assetStore: mockAssetStore as any,
        visualAnchorRepo: mockAnchorRepo as any,
      }),
    );

    await handlerReplay({
      id: 'lease-replay',
      ownerId,
      scopeId: requestId,
      kind: 'media',
    } as any);

    assert.equal(providerCalls, 0, 'Replay of completed request must not call provider');

    // 8. Verify Failure handling: when pipeline service fails (e.g. quota exceeded),
    // world_media_requests is updated to failed and outbox job is finished with error
    const failedReqId = randomUUID();
    await db.transaction(ownerId, async (sql: any) => {
      await sql.query(
        `INSERT INTO parallel_life.world_media_requests (id, world_id, owner_id, document)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          failedReqId,
          worldId,
          ownerId,
          JSON.stringify({
            id: failedReqId,
            worldId,
            prompt: '超额测试',
            status: 'pending',
            mediaType: 'image',
            sourceEventId: event1,
          }),
        ],
      );
      await sql.query(
        `INSERT INTO parallel_life.outbox_jobs (id, world_id, owner_id, event_id, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          `job_${failedReqId}`,
          worldId,
          ownerId,
          event1,
          JSON.stringify({ type: 'image.generate', requestId: failedReqId }),
        ],
      );
    });

    const failingService = {
      executeImagePipeline: async () => {
        throw Object.assign(new Error('QUOTA_EXCEEDED: 超额测试'), { code: 'QUOTA_EXCEEDED' });
      },
      executeVideoPipeline: async () => {},
    };

    const handlerFailure = createMediaPipelineHandler(mockQueue as any, failingService as any);
    await assert.rejects(
      () =>
        handlerFailure({
          id: 'lease-fail',
          ownerId,
          scopeId: failedReqId,
          kind: 'media',
        } as any),
      /QUOTA_EXCEEDED/,
    );

    // Verify request updated to failed in database
    await db.transaction(ownerId, async (sql: any) => {
      const failedRow = (
        await sql.query(`SELECT document FROM parallel_life.world_media_requests WHERE id = $1`, [
          failedReqId,
        ])
      ).rows[0];
      assert.equal(failedRow.document.status, 'failed');
      assert.equal(failedRow.document.errorCode, 'QUOTA_EXCEEDED');

      const failedJob = (
        await sql.query(`SELECT status, last_error FROM parallel_life.outbox_jobs WHERE id = $1`, [
          `job_${failedReqId}`,
        ])
      ).rows[0];
      assert.equal(failedJob.status, 'failed');
      assert(failedJob.last_error.includes('QUOTA_EXCEEDED'));
    });
  } finally {
    try {
      if (db) await db.close();
    } catch {}
    try {
      if (admin) await admin.end();
    } catch {}
  }
});
