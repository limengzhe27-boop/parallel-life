import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFailure } from '../src/features/api/client.ts';
import {
  confirmInterviewPhotoMessage,
  ensureInterviewPhotoSaved,
  hasInterviewPhotoMessage,
  parseInterviewPhotoMessage,
} from '../src/features/interview/photo-share.ts';

const assetId = '00000000-0000-4000-8000-000000000001';

test('a photo is not shared before its asset is saved to the real profile', async () => {
  const writes: number[] = [];
  const result = await ensureInterviewPhotoSaved(
    {
      async workspace() {
        return { profile: { version: 3, referenceAssetIds: [] } };
      },
      async editProfile(input) {
        writes.push(input.expectedVersion);
        assert.deepEqual(input.operation, { kind: 'add-reference-photo', assetId });
        return { version: 4, referenceAssetIds: [assetId] };
      },
    },
    assetId,
  );
  assert.deepEqual(writes, [3]);
  assert.deepEqual(result.referenceAssetIds, [assetId]);
});

test('a concurrent profile write is reread before reusing the uploaded asset', async () => {
  let reads = 0;
  const writes: number[] = [];
  const result = await ensureInterviewPhotoSaved(
    {
      async workspace() {
        reads++;
        return { profile: { version: reads === 1 ? 3 : 4, referenceAssetIds: [] } };
      },
      async editProfile(input) {
        writes.push(input.expectedVersion);
        if (input.expectedVersion === 3) throw new ApiFailure('VERSION_CONFLICT', '资料刚更新');
        return { version: 5, referenceAssetIds: [assetId] };
      },
    },
    assetId,
  );
  assert.deepEqual(writes, [3, 4]);
  assert.deepEqual(result.referenceAssetIds, [assetId]);
});

test('a lost save response is recognized on reread, without another write', async () => {
  let writes = 0;
  const result = await ensureInterviewPhotoSaved(
    {
      async workspace() {
        return { profile: { version: 7, referenceAssetIds: [assetId] } };
      },
      async editProfile() {
        writes++;
        throw Error('should not save twice');
      },
    },
    assetId,
  );
  assert.equal(writes, 0);
  assert.equal(result.version, 7);
});

test('a failed profile save does not become a successful photo share', async () => {
  await assert.rejects(
    ensureInterviewPhotoSaved(
      {
        async workspace() {
          return { profile: { version: 3, referenceAssetIds: [] } };
        },
        async editProfile() {
          throw new ApiFailure('UNAVAILABLE', 'temporarily unavailable');
        },
      },
      assetId,
    ),
    { code: 'UNAVAILABLE' },
  );
});

test('a save response without the photo is not treated as success', async () => {
  await assert.rejects(
    ensureInterviewPhotoSaved(
      {
        async workspace() {
          return { profile: { version: 3, referenceAssetIds: [] } };
        },
        async editProfile() {
          return { version: 4, referenceAssetIds: [] };
        },
      },
      assetId,
    ),
    { code: 'UNAVAILABLE' },
  );
});

test('only an exact local user photo marker is rendered as a photo', () => {
  assert.deepEqual(
    parseInterviewPhotoMessage({
      role: 'user',
      text: `[照片:/api/v1/assets/${assetId}]\n我在海边拍的。`,
    }),
    { assetId, caption: '我在海边拍的。' },
  );
  assert.equal(
    parseInterviewPhotoMessage({ role: 'user', text: '[照片:https://example.com/pixel.png]' }),
    null,
  );
  assert.equal(
    parseInterviewPhotoMessage({ role: 'assistant', text: `[照片:/api/v1/assets/${assetId}]` }),
    null,
  );
  assert.equal(
    parseInterviewPhotoMessage({ role: 'user', text: `你看 [照片:/api/v1/assets/${assetId}]` }),
    null,
  );
});

test('a saved user photo is found on recovery, but an optimistic bubble is not', () => {
  const text = `[照片:/api/v1/assets/${assetId}]\n我分享了一张生活照片。`;
  assert.equal(
    hasInterviewPhotoMessage([{ id: 'temp-command', role: 'user', text }], assetId),
    false,
  );
  assert.equal(
    hasInterviewPhotoMessage([{ id: crypto.randomUUID(), role: 'user', text }], assetId),
    true,
  );
});

test('a lost stream result does not resend a photo already saved in the interview', async () => {
  const stored = {
    interview: {
      messages: [{ id: crypto.randomUUID(), role: 'user' as const, text: `[照片:/api/v1/assets/${assetId}]` }],
    },
  };
  let sends = 0;
  const result = await confirmInterviewPhotoMessage(
    async () => stored,
    stored,
    assetId,
    async () => { sends++; },
  );
  assert.equal(sends, 0);
  assert.equal(result, stored);
});

test('a photo remains pending when sending returns but the message is not stored', async () => {
  const empty = { interview: { messages: [] } };
  let sends = 0;
  await assert.rejects(
    confirmInterviewPhotoMessage(async () => empty, empty, assetId, async () => { sends++; }),
    { code: 'UNAVAILABLE' },
  );
  assert.equal(sends, 1);
});

test('a committed photo message is confirmed after an interrupted model stream', async () => {
  const empty = { interview: { messages: [] as Array<{ id: string; role: 'user'; text: string }> } };
  const saved = {
    interview: {
      messages: [{ id: crypto.randomUUID(), role: 'user' as const, text: `[照片:/api/v1/assets/${assetId}]` }],
    },
  };
  const result = await confirmInterviewPhotoMessage(async () => saved, empty, assetId, async () => {});
  assert.equal(result, saved);
});
