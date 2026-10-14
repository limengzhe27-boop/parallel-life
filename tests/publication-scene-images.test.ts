import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicationSceneImageUrl,
  trialSceneImageUrl,
} from '../src/modules/settings/domain/publication-scene-images.ts';

const worldId = '43abfecd-ed59-465e-913b-7b91c15c3dc7';
const assetId = 'c566bbdc-d497-442b-811e-447628d90bd4';
const trialId = '835d9af5-e08a-442c-a45a-38162382a8e0';

test('scene picture paths are private-world URLs and only the exact trial may remap them', () => {
  const url = publicationSceneImageUrl(worldId, assetId);
  assert.equal(url, `/api/v1/worlds/${worldId}/media/${assetId}`);
  assert.equal(
    trialSceneImageUrl(url, worldId, trialId),
    `/api/v1/publisher/trials/${trialId}/world/media/${assetId}`,
  );
  assert.equal(
    trialSceneImageUrl(
      `/api/v1/worlds/49e88e8b-845a-4ac8-8bcd-8fbd5c739715/media/${assetId}`,
      worldId,
      trialId,
    ),
    `/api/v1/worlds/49e88e8b-845a-4ac8-8bcd-8fbd5c739715/media/${assetId}`,
  );
  assert.equal(trialSceneImageUrl(url + '/extra', worldId, trialId), url + '/extra');
  assert.throws(
    () => publicationSceneImageUrl(worldId, '../other'),
    /INVALID_SCENE_IMAGE_REFERENCE/,
  );
});
