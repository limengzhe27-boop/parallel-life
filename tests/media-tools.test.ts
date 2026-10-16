import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGenerateImageToolInput,
  validateGenerateVideoToolInput,
  validateMediaShareToolInput,
} from '../src/modules/media/domain/media-tools.ts';

test('media-tools: validateGenerateImageToolInput validates valid payload', () => {
  const result = validateGenerateImageToolInput({
    purpose: 'portrait',
    sceneDescription: '在老洋房露台喝红茶',
    style: 'film_photo',
    aspectRatio: '9:16',
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.purpose, 'portrait');
    assert.equal(result.data.sceneDescription, '在老洋房露台喝红茶');
    assert.equal(result.data.aspectRatio, '9:16');
  }
});

test('media-tools: validateGenerateImageToolInput rejects unsupported aspect ratio', () => {
  const result = validateGenerateImageToolInput({
    purpose: 'scene',
    sceneDescription: '外滩夜景',
    aspectRatio: '2:1', // Unsupported
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.errorCode, 'UNSUPPORTED_ASPECT_RATIO');
  }
});

test('media-tools: validateGenerateVideoToolInput validates valid 6-second video request', () => {
  const result = validateGenerateVideoToolInput({
    purpose: 'scene_moment',
    actionDescription: '微风吹过窗帘，桌上的书页轻轻翻动',
    cameraMotion: 'dolly_in',
    durationSeconds: 6,
    audioLayers: {
      ambient: 'wind blowing softly',
    },
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.durationSeconds, 6);
    assert.equal(result.data.cameraMotion, 'dolly_in');
  }
});

test('media-tools: validateGenerateVideoToolInput rejects unsupported duration', () => {
  const result = validateGenerateVideoToolInput({
    purpose: 'character_action',
    actionDescription: '奔跑',
    durationSeconds: 15, // Only 5 or 6 supported
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.errorCode, 'UNSUPPORTED_DURATION');
  }
});

test('media-tools: validateMediaShareToolInput requires assetId and target recipient', () => {
  const bad = validateMediaShareToolInput({
    assetId: '',
    targetRecipientActorId: 'actor-2',
  });
  assert.equal(bad.success, false);

  const good = validateMediaShareToolInput({
    assetId: 'asset-123',
    targetRecipientActorId: 'actor-2',
    caption: '给你看看昨天拍的照片',
  });
  assert.equal(good.success, true);
});
