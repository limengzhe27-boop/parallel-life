import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MediaPipelineService } from '../src/modules/media/infrastructure/media-pipeline-service.ts';
import type {
  MediaProviderAdapter,
  CharacterVisualAnchorRepository,
} from '../src/modules/media/application/provider-ports.ts';
import type { AssetStore } from '../src/modules/media/application/asset-store.ts';
import type {
  CharacterVisualAnchor,
  ProviderTaskReceipt,
  ProviderTaskStatus,
} from '../src/modules/media/domain/types.ts';

// Helper to create a valid test PNG image buffer
async function createTestPngBuffer(width = 100, height = 100): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 100, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

// Helper to create a minimal MP4 buffer with ftyp header
function createTestMp4Buffer(): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0); // box size
  buf.write('ftyp', 4, 'ascii'); // major brand box
  buf.write('mp42', 8, 'ascii'); // compatible brand
  return buf;
}

function createInMemoryAssetStore(): { store: AssetStore; assets: Record<string, Buffer> } {
  const assets: Record<string, Buffer> = {};
  const store: AssetStore = {
    async put(key: string, data: Buffer): Promise<void> {
      assets[key] = data;
    },
    async get(key: string): Promise<Buffer> {
      const data = assets[key];
      if (!data) throw new Error(`Asset not found: ${key}`);
      return data;
    },
    async remove(key: string): Promise<void> {
      delete assets[key];
    },
  };
  return { store, assets };
}

test('pipeline passes cancellation through submission and poll; accepted work becomes unknown', async () => {
  const controller = new AbortController();
  let submits = 0;
  let polls = 0;
  const service = new MediaPipelineService({
    providerAdapter: {
      providerName: 'test',
      async submitImage(params) {
        submits++;
        assert.equal(params.signal, controller.signal);
        return {
          providerTaskId: 'accepted-image',
          status: 'submitted',
          provider: 'test',
          model: 'test',
        };
      },
      async submitVideo() {
        throw Error('unexpected video');
      },
      async queryStatus(_id, signal) {
        polls++;
        assert.equal(signal, controller.signal);
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
      async cancel() {
        return false;
      },
    },
    assetStore: createInMemoryAssetStore().store,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
    pollIntervalMs: 0,
  });
  await assert.rejects(
    service.executeImagePipeline({
      ownerId: 'owner',
      worldId: 'world',
      intent: { purpose: 'scene', sceneDescription: '窗边' },
      currentAssetCount: 0,
      callerActorId: 'actor',
      isCallerPlayer: false,
      signal: controller.signal,
    }),
    { code: 'STATUS_UNKNOWN', providerTaskId: 'accepted-image' },
  );
  assert.equal(submits, 1);
  assert.equal(polls, 1);
});

test('pre-submit cancellation makes no image or video provider request', async () => {
  const controller = new AbortController();
  controller.abort();
  let submissions = 0;
  const service = new MediaPipelineService({
    providerAdapter: {
      providerName: 'test',
      async submitImage() {
        submissions++;
        throw Error('unexpected image');
      },
      async submitVideo() {
        submissions++;
        throw Error('unexpected video');
      },
      async queryStatus() {
        throw Error('unexpected poll');
      },
      async cancel() {
        return false;
      },
    },
    assetStore: createInMemoryAssetStore().store,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
  });
  const common = {
    ownerId: 'owner',
    worldId: 'world',
    currentAssetCount: 0,
    callerActorId: 'actor',
    isCallerPlayer: false,
    signal: controller.signal,
  };
  await assert.rejects(
    service.executeImagePipeline({
      ...common,
      intent: { purpose: 'scene', sceneDescription: '窗边' },
    }),
    { code: 'CANCELLED' },
  );
  await assert.rejects(
    service.executeVideoPipeline({
      ...common,
      intent: { purpose: 'scene_moment', actionDescription: '雨停了' },
    }),
    { code: 'CANCELLED' },
  );
  assert.equal(submissions, 0);
});

test('video submission and polling receive the worker signal', async () => {
  const controller = new AbortController();
  let submitted = false;
  const service = new MediaPipelineService({
    providerAdapter: {
      providerName: 'test',
      async submitImage() {
        throw Error('unexpected image');
      },
      async submitVideo(params) {
        submitted = true;
        assert.equal(params.signal, controller.signal);
        return {
          providerTaskId: 'accepted-video',
          status: 'submitted',
          provider: 'test',
          model: 'test',
        };
      },
      async queryStatus(_id, signal) {
        assert.equal(signal, controller.signal);
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
      async cancel() {
        return false;
      },
    },
    assetStore: createInMemoryAssetStore().store,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
    pollIntervalMs: 0,
  });
  await assert.rejects(
    service.executeVideoPipeline({
      ownerId: 'owner',
      worldId: 'world',
      intent: { purpose: 'scene_moment', actionDescription: '街景' },
      currentAssetCount: 0,
      callerActorId: 'actor',
      isCallerPlayer: false,
      signal: controller.signal,
    }),
    { code: 'STATUS_UNKNOWN', providerTaskId: 'accepted-video' },
  );
  assert.equal(submitted, true);
});

test('download abort after accepted image stays unknown and does not store an asset', async () => {
  const controller = new AbortController();
  const { store, assets } = createInMemoryAssetStore();
  const service = new MediaPipelineService({
    providerAdapter: {
      providerName: 'test',
      async submitImage() {
        return {
          providerTaskId: 'accepted-download',
          status: 'succeeded',
          outputUrls: ['https://assets.example/image.png'],
          provider: 'test',
          model: 'test',
        };
      },
      async submitVideo() {
        throw Error('unexpected video');
      },
      async queryStatus() {
        throw Error('unexpected poll');
      },
      async cancel() {
        return false;
      },
    },
    assetStore: store,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
    fetchFn: async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    },
  });
  await assert.rejects(
    service.executeImagePipeline({
      ownerId: 'owner',
      worldId: 'world',
      intent: { purpose: 'scene', sceneDescription: '街景' },
      currentAssetCount: 0,
      callerActorId: 'actor',
      isCallerPlayer: false,
      signal: controller.signal,
    }),
    { code: 'STATUS_UNKNOWN', providerTaskId: 'accepted-download' },
  );
  assert.deepEqual(assets, {});
});

test('MediaPipelineService - Quota check rejects when asset count reaches budget limit', async () => {
  const mockRepo: CharacterVisualAnchorRepository = {
    async findPlayerVisualAnchor() {
      return null;
    },
    async findActorVisualAnchor() {
      return null;
    },
  };

  const service = new MediaPipelineService({
    providerAdapter: {} as any,
    assetStore: {} as any,
    visualAnchorRepo: mockRepo,
    budget: {
      maxImagesPerWorld: 5,
      maxPendingRequests: 2,
      estimatedCostUsdPerImage: 0.01,
      maxVideosPerWorld: 1,
      estimatedCostUsdPerVideo: 0.5,
    },
  });

  await assert.rejects(
    service.executeImagePipeline({
      ownerId: 'owner_1',
      worldId: 'world_1',
      intent: {
        purpose: 'scene',
        sceneDescription: '测试场景',
      },
      currentAssetCount: 5,
      callerActorId: 'player',
      isCallerPlayer: true,
    }),
    { code: 'QUOTA_EXCEEDED' },
  );
});

test('MediaPipelineService - Image pipeline executes end-to-end with character anchor and private storage', async () => {
  const pngBuffer = await createTestPngBuffer(200, 200);

  const mockProvider: MediaProviderAdapter = {
    providerName: 'mock_replicate',
    async submitImage(params): Promise<ProviderTaskReceipt> {
      return {
        providerTaskId: 'mock_task_001',
        provider: 'mock_replicate',
        status: 'submitted',
        model: params.builtPrompt.targetModel,
      };
    },
    async submitVideo(): Promise<ProviderTaskReceipt> {
      throw new Error('Not implemented');
    },
    async queryStatus(taskId: string): Promise<ProviderTaskStatus> {
      return {
        providerTaskId: taskId,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputUrls: ['https://storage.provider.mock/test.png'],
      };
    },
    async cancel(): Promise<boolean> {
      return true;
    },
  };

  const { store, assets } = createInMemoryAssetStore();

  const playerAnchor: CharacterVisualAnchor = {
    actorId: 'player',
    name: '顾先生',
    gender: 'male',
    clothingStyle: 'vintage linen shirt',
    distinctiveFeatures: ['rimless titanium glasses'],
    referenceAssetId: 'asset_player_portrait',
    referenceAssetRevision: 1,
    isPlayer: true,
    authorizedForWorld: true,
  };

  const mockRepo: CharacterVisualAnchorRepository = {
    async findPlayerVisualAnchor(): Promise<CharacterVisualAnchor | null> {
      return playerAnchor;
    },
    async findActorVisualAnchor() {
      return null;
    },
  };

  const mockFetch = async () =>
    new Response(new Uint8Array(pngBuffer), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });

  const service = new MediaPipelineService({
    providerAdapter: mockProvider,
    assetStore: store,
    visualAnchorRepo: mockRepo,
    fetchFn: mockFetch as any,
    pollIntervalMs: 5,
  });

  const result = await service.executeImagePipeline({
    ownerId: 'owner_1',
    worldId: 'world_1',
    intent: {
      purpose: 'portrait',
      sceneDescription: '坐在午后咖啡馆木桌旁翻阅剧本',
      targetActorId: 'player',
      deliveryIntent: {
        channel: 'album',
      },
    },
    currentAssetCount: 2,
    callerActorId: 'player',
    isCallerPlayer: true,
    worldIsCancelled: false,
  });

  assert.ok(result.assetId, 'Generated asset must have an ID');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.width, 200);
  assert.equal(result.height, 200);
  assert.deepEqual(result.referenceAssetIds, ['asset_player_portrait']);
  assert.ok(result.prompt.includes('顾先生') || result.prompt.includes('rimless titanium glasses'));
  assert.equal(result.deliveryDecision.approved, true);
  assert.equal(result.deliveryDecision.channel, 'album');

  // Verify stored in private asset store
  assert.ok(assets[result.storageKey]);
  assert.equal(assets[result.storageKey]?.length, pngBuffer.length);
});

test('MediaPipelineService - Video pipeline generates MP4 and validates magic bytes', async () => {
  const mp4Buffer = createTestMp4Buffer();

  const mockProvider: MediaProviderAdapter = {
    providerName: 'mock_replicate',
    async submitImage(): Promise<ProviderTaskReceipt> {
      throw new Error('Not implemented');
    },
    async submitVideo(params): Promise<ProviderTaskReceipt> {
      return {
        providerTaskId: 'mock_video_task',
        provider: 'mock_replicate',
        status: 'submitted',
        model: params.builtPrompt.targetModel,
      };
    },
    async queryStatus(taskId: string): Promise<ProviderTaskStatus> {
      return {
        providerTaskId: taskId,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputUrls: ['https://storage.provider.mock/clip.mp4'],
      };
    },
    async cancel(): Promise<boolean> {
      return true;
    },
  };

  const { store, assets } = createInMemoryAssetStore();

  const playerAnchor: CharacterVisualAnchor = {
    actorId: 'player',
    name: '顾先生',
    isPlayer: true,
    authorizedForWorld: true,
  };

  const mockRepo: CharacterVisualAnchorRepository = {
    async findPlayerVisualAnchor() {
      return playerAnchor;
    },
    async findActorVisualAnchor() {
      return null;
    },
  };

  const mockFetch = async () =>
    new Response(new Uint8Array(mp4Buffer), {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });

  const service = new MediaPipelineService({
    providerAdapter: mockProvider,
    assetStore: store,
    visualAnchorRepo: mockRepo,
    fetchFn: mockFetch as any,
    pollIntervalMs: 5,
  });

  const result = await service.executeVideoPipeline({
    ownerId: 'owner_1',
    worldId: 'world_1',
    intent: {
      purpose: 'character_action',
      actionDescription: '推开木门走进昏暗的放映厅，侧光勾勒出轮廓',
      targetActorId: 'player',
      cameraMotion: 'dolly_in',
      audioLayers: {
        dialogue: '放映机还在转。',
        ambient: 'old projector mechanical whirring, faint dusk rain on window',
      },
      deliveryIntent: {
        channel: 'album',
      },
    },
    currentAssetCount: 0,
    callerActorId: 'player',
    isCallerPlayer: true,
  });

  assert.ok(result.assetId);
  assert.equal(result.mimeType, 'video/mp4');
  assert.equal(result.byteLength, 32);
  assert.ok(result.prompt.includes('performing the following action:'));
  assert.ok(result.prompt.includes('no subtitles'));
  assert.ok(assets[result.storageKey]);
});

test('MediaPipelineService - Rejects corrupted or fake media stream with invalid magic bytes', async () => {
  const fakeHtmlBuffer = Buffer.from('<html><body>404 Not Found from CDN</body></html>');

  const mockProvider: MediaProviderAdapter = {
    providerName: 'mock_replicate',
    async submitImage(params): Promise<ProviderTaskReceipt> {
      return {
        providerTaskId: 'mock_fake_task',
        provider: 'mock_replicate',
        status: 'submitted',
        model: params.builtPrompt.targetModel,
      };
    },
    async submitVideo(): Promise<ProviderTaskReceipt> {
      throw new Error('Not implemented');
    },
    async queryStatus(taskId: string): Promise<ProviderTaskStatus> {
      return {
        providerTaskId: taskId,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputUrls: ['https://storage.provider.mock/corrupt.png'],
      };
    },
    async cancel(): Promise<boolean> {
      return true;
    },
  };

  const service = new MediaPipelineService({
    providerAdapter: mockProvider,
    assetStore: {} as any,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
    fetchFn: (async () => new Response(new Uint8Array(fakeHtmlBuffer))) as any,
    pollIntervalMs: 5,
  });

  await assert.rejects(
    service.executeImagePipeline({
      ownerId: 'owner_1',
      worldId: 'world_1',
      intent: {
        purpose: 'scene',
        sceneDescription: '雨中弄堂',
      },
      currentAssetCount: 0,
      callerActorId: 'player',
      isCallerPlayer: true,
    }),
    { code: 'INVALID_MEDIA_FORMAT' },
  );
});

test('MediaPipelineService - Pre-delivery check disallows delivery if world is cancelled', async () => {
  const pngBuffer = await createTestPngBuffer(50, 50);

  const mockProvider: MediaProviderAdapter = {
    providerName: 'mock_replicate',
    async submitImage(params): Promise<ProviderTaskReceipt> {
      return {
        providerTaskId: 'mock_task_cancelled',
        provider: 'mock_replicate',
        status: 'submitted',
        model: params.builtPrompt.targetModel,
      };
    },
    async submitVideo(): Promise<ProviderTaskReceipt> {
      throw new Error('Not implemented');
    },
    async queryStatus(taskId: string): Promise<ProviderTaskStatus> {
      return {
        providerTaskId: taskId,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        outputUrls: ['https://storage.provider.mock/test.png'],
      };
    },
    async cancel(): Promise<boolean> {
      return true;
    },
  };

  const { store } = createInMemoryAssetStore();

  const service = new MediaPipelineService({
    providerAdapter: mockProvider,
    assetStore: store,
    visualAnchorRepo: {
      async findPlayerVisualAnchor() {
        return null;
      },
      async findActorVisualAnchor() {
        return null;
      },
    },
    fetchFn: (async () => new Response(new Uint8Array(pngBuffer))) as any,
    pollIntervalMs: 5,
  });

  const result = await service.executeImagePipeline({
    ownerId: 'owner_1',
    worldId: 'world_1',
    intent: {
      purpose: 'scene',
      sceneDescription: '落日余晖',
      deliveryIntent: {
        channel: 'album',
      },
    },
    currentAssetCount: 0,
    callerActorId: 'player',
    isCallerPlayer: true,
    worldIsCancelled: true, // World is cancelled!
  });

  // Generation succeeded and saved, but delivery rejected
  assert.equal(result.deliveryDecision.approved, false);
  assert.equal(result.deliveryDecision.reason, 'WORLD_CANCELLED_LATE_DELIVERY_PREVENTED');
});
