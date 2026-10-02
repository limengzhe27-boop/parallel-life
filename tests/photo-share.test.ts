import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFailure } from '../src/features/api/client.ts';
import { ensureInterviewPhotoSaved } from '../src/features/interview/photo-share.ts';

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
