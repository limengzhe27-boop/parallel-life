import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplicateMediaProviderAdapter } from '../src/modules/media/infrastructure/replicate-provider-adapter.ts';
import type { BuiltImagePrompt, BuiltVideoPrompt } from '../src/modules/media/domain/prompt-builder.ts';

test('ReplicateMediaProviderAdapter: rejects requests when apiToken is missing', async () => {
  const adapter = new ReplicateMediaProviderAdapter({ apiToken: '' });

  const builtPrompt: BuiltImagePrompt = {
    ruleVersion: '1.0.0',
    targetModel: 'flux-schnell',
    prompt: 'A sunny day in the city',
    aspectRatio: '1:1',
    outputFormat: 'webp',
    hasReferenceImage: false,
  };

  await assert.rejects(
    adapter.submitImage({
      deduplicationKey: 'dedup-1',
      builtPrompt,
    }),
    { code: 'UNAVAILABLE' },
  );
});

test('ReplicateMediaProviderAdapter: submitImage sends valid payload and returns receipt', async () => {
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: 'pred_image_12345',
        status: 'starting',
        urls: {
          get: 'https://api.replicate.com/v1/predictions/pred_image_12345',
          cancel: 'https://api.replicate.com/v1/predictions/pred_image_12345/cancel',
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const adapter = new ReplicateMediaProviderAdapter({
    apiToken: 'test-token',
    fetchFn: mockFetch,
  });

  const builtPrompt: BuiltImagePrompt = {
    ruleVersion: '1.0.0',
    targetModel: 'flux-schnell',
    prompt: 'A candid portrait of a girl',
    aspectRatio: '9:16',
    outputFormat: 'webp',
    hasReferenceImage: true,
    referenceAssetId: 'asset-1',
  };

  const referenceBytes = Buffer.from('mock-image-bytes');

  const receipt = await adapter.submitImage({
    deduplicationKey: 'dedup-img-1',
    builtPrompt,
    referenceImageBytes: referenceBytes,
    referenceImageMimeType: 'image/jpeg',
    webhookUrl: 'https://test.app/api/webhook',
  });

  assert.equal(receipt.providerTaskId, 'pred_image_12345');
  assert.equal(receipt.status, 'running');
  assert.equal(receipt.provider, 'replicate');
  assert.ok(capturedUrl.includes('black-forest-labs/flux-schnell'));
  assert.equal(capturedBody.input.prompt, 'A candid portrait of a girl');
  assert.equal(capturedBody.input.aspect_ratio, '9:16');
  assert.ok(capturedBody.input.image.startsWith('data:image/jpeg;base64,'));
  assert.equal(capturedBody.webhook, 'https://test.app/api/webhook');
});

test('ReplicateMediaProviderAdapter: timeout during submitImage throws STATUS_UNKNOWN without retry', async () => {
  const mockTimeoutFetch = async (): Promise<Response> => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };

  const adapter = new ReplicateMediaProviderAdapter({
    apiToken: 'test-token',
    fetchFn: mockTimeoutFetch,
    timeoutMs: 10,
  });

  const builtPrompt: BuiltImagePrompt = {
    ruleVersion: '1.0.0',
    targetModel: 'flux-schnell',
    prompt: 'A prompt',
    aspectRatio: '1:1',
    outputFormat: 'webp',
    hasReferenceImage: false,
  };

  await assert.rejects(
    adapter.submitImage({
      deduplicationKey: 'dedup-timeout',
      builtPrompt,
    }),
    { code: 'STATUS_UNKNOWN' },
  );
});

test('ReplicateMediaProviderAdapter: submitVideo targets minimax-video-01 endpoint', async () => {
  let capturedUrl = '';
  let capturedBody: any = null;

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        id: 'pred_video_67890',
        status: 'starting',
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const adapter = new ReplicateMediaProviderAdapter({
    apiToken: 'test-token',
    fetchFn: mockFetch,
  });

  const builtPrompt: BuiltVideoPrompt = {
    ruleVersion: '1.0.0',
    targetModel: 'minimax-video-01',
    prompt: 'A character walks forward in slow motion',
    durationSeconds: 6,
    hasFirstFrameImage: true,
  };

  const receipt = await adapter.submitVideo({
    deduplicationKey: 'dedup-vid-1',
    builtPrompt,
    firstFrameImageUrl: 'https://storage.test/signed-frame.webp',
  });

  assert.equal(receipt.providerTaskId, 'pred_video_67890');
  assert.ok(capturedUrl.includes('minimax/video-01'));
  assert.equal(capturedBody.input.first_frame_image, 'https://storage.test/signed-frame.webp');
});

test('ReplicateMediaProviderAdapter: queryStatus maps statuses and extracts output URLs', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        id: 'pred_123',
        status: 'succeeded',
        output: ['https://replicate.delivery/pred_123/out-0.webp'],
        completed_at: '2026-10-16T10:00:00Z',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const adapter = new ReplicateMediaProviderAdapter({
    apiToken: 'test-token',
    fetchFn: mockFetch,
  });

  const status = await adapter.queryStatus('pred_123');
  assert.equal(status.providerTaskId, 'pred_123');
  assert.equal(status.status, 'succeeded');
  assert.deepEqual(status.outputUrls, ['https://replicate.delivery/pred_123/out-0.webp']);
  assert.equal(status.completedAt, '2026-10-16T10:00:00Z');
});

test('ReplicateMediaProviderAdapter: cancel sends POST request to cancel endpoint', async () => {
  let cancelCalled = false;
  const mockFetch = async (url: string | URL | Request): Promise<Response> => {
    if (String(url).endsWith('/predictions/pred_123/cancel')) {
      cancelCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  };

  const adapter = new ReplicateMediaProviderAdapter({
    apiToken: 'test-token',
    fetchFn: mockFetch,
  });

  const success = await adapter.cancel('pred_123');
  assert.equal(success, true);
  assert.equal(cancelCalled, true);
});
