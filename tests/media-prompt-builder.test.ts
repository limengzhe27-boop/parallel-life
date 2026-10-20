import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MediaPromptBuilder,
  MEDIA_PROMPT_RULE_VERSION,
} from '../src/modules/media/domain/prompt-builder.ts';
import type {
  ImageGenerationIntent,
  VideoGenerationIntent,
} from '../src/modules/media/domain/types.ts';

test('MediaPromptBuilder: builds structured image prompt adhering to photography standards', () => {
  const builder = new MediaPromptBuilder();
  assert.equal(builder.ruleVersion, MEDIA_PROMPT_RULE_VERSION);

  const intent: ImageGenerationIntent = {
    purpose: 'portrait',
    sceneDescription: 'sitting near the window of a sunlit French bistro',
    style: 'film_photo',
    aspectRatio: '9:16',
    lighting: 'natural_sunlight',
    composition: 'medium_shot',
  };

  const characterSnippet =
    'A young architect, 28 years old with short dark hair and round wire-rim glasses';

  const built = builder.buildImagePrompt({
    intent,
    characterSnippet,
    hasReferenceImage: true,
    referenceAssetId: 'asset-ref-1',
    targetModel: 'flux-1.1-pro',
  });

  assert.equal(built.ruleVersion, MEDIA_PROMPT_RULE_VERSION);
  assert.equal(built.targetModel, 'flux-1.1-pro');
  assert.equal(built.aspectRatio, '9:16');
  assert.equal(built.outputFormat, 'webp');
  assert.equal(built.hasReferenceImage, true);
  assert.equal(built.referenceAssetId, 'asset-ref-1');

  // Must contain descriptive photography language and character features
  assert.ok(built.prompt.includes('A young architect'));
  assert.ok(built.prompt.includes('sunlit French bistro'));
  assert.ok(built.prompt.includes('Kodak Portra 400'));
  assert.ok(built.prompt.includes('natural morning sunlight'));
  assert.ok(built.prompt.includes('medium shot'));
  assert.ok(built.prompt.includes('50mm portrait lens'));
  assert.ok(built.prompt.includes('Carefully preserving facial likeness'));

  // Ensure no comma-stuffed tags like ", , ,"
  assert.equal(built.prompt.includes(', ,'), false);
});

test('MediaPromptBuilder: builds video prompt with 7-layer scene and 4-layer audio structure', () => {
  const builder = new MediaPromptBuilder();

  const intent: VideoGenerationIntent = {
    purpose: 'character_action',
    actionDescription: 'walking through an autumn park and turning back to look at the camera',
    cameraMotion: 'tracking',
    durationSeconds: 6,
    audioLayers: {
      dialogue: 'We finally made it here.',
      ambient: 'gentle breeze rustling golden autumn leaves and distant birds',
      sfx: 'soft footsteps crunching on gravel pathway',
      music: 'gentle acoustic guitar melody in a contemplative mood',
    },
  };

  const characterSnippet = 'A woman in a navy trench coat';

  const built = builder.buildVideoPrompt({
    intent,
    characterSnippet,
    hasFirstFrameImage: true,
    targetModel: 'minimax-video-01',
  });

  assert.equal(built.ruleVersion, MEDIA_PROMPT_RULE_VERSION);
  assert.equal(built.targetModel, 'minimax-video-01');
  assert.equal(built.durationSeconds, 6);
  assert.equal(built.hasFirstFrameImage, true);
  assert.equal(built.cameraMotion, 'tracking');

  // Verify anti-subtitle directive
  assert.ok(built.prompt.includes('(no subtitles, no captions, no on-screen text)'));

  // Verify colon dialogue syntax
  assert.ok(built.prompt.includes('The character says: We finally made it here.'));

  // Verify audio layers
  assert.ok(built.prompt.includes('Ambient soundscape of gentle breeze'));
  assert.ok(built.prompt.includes('Clear sound effects of soft footsteps'));
  assert.ok(built.prompt.includes('Subtle background musical score: gentle acoustic guitar'));

  // Verify camera motion preset
  assert.ok(built.prompt.includes('Dynamic tracking shot maintaining a stable parallel view'));

  // Verify seamless first frame hint
  assert.ok(built.prompt.includes('Beginning smoothly from the initial reference frame'));
});

test('MediaPromptBuilder: selfie uses the subject’s front camera instead of an external portrait lens', () => {
  const built = new MediaPromptBuilder().buildImagePrompt({
    intent: {
      purpose: 'portrait',
      sceneDescription: '坐在沙发上，穿着白色上衣，给朋友拍一张日常自拍',
      composition: 'wide_shot',
    },
    characterSnippet: 'A woman with shoulder-length brown hair',
    hasReferenceImage: true,
  });
  assert.match(built.prompt, /front-camera smartphone selfie/);
  assert.match(built.prompt, /outstretched hand at arm’s length/);
  assert.match(built.prompt, /identity only/);
  assert.match(built.prompt, /白色上衣/);
  assert.doesNotMatch(built.prompt, /50mm portrait lens|wide establishing shot|Kodak Portra/);
});

test('MediaPromptBuilder: mirror selfie preserves visible phone/reflection rather than front-camera geometry', () => {
  const built = new MediaPromptBuilder().buildImagePrompt({
    intent: {
      purpose: 'portrait',
      sceneDescription: '站在卧室镜子前自拍，展示今天的穿搭',
      composition: 'medium_shot',
    },
  });
  assert.match(built.prompt, /mirror selfie/);
  assert.match(built.prompt, /visibly holds a smartphone/);
  assert.match(built.prompt, /medium shot/);
  assert.doesNotMatch(built.prompt, /phone itself is outside|50mm portrait lens/);
});

test('MediaPromptBuilder: portrait and explicitly non-selfie requests keep external-camera framing', () => {
  for (const sceneDescription of [
    'a portrait by the window',
    '朋友为她拍照，不是自拍',
    'a photograph, not a selfie',
  ]) {
    const built = new MediaPromptBuilder().buildImagePrompt({
      intent: { purpose: 'portrait', sceneDescription },
    });
    assert.match(built.prompt, /50mm portrait lens/);
    assert.doesNotMatch(built.prompt, /front-camera smartphone selfie|An authentic mirror selfie/);
  }
});

test('MediaPromptBuilder: explicit capture mode overrides ambiguous legacy prose', () => {
  const builder = new MediaPromptBuilder();
  const selfie = builder.buildImagePrompt({
    intent: {
      purpose: 'portrait',
      sceneDescription: 'relaxed at home',
      captureMode: 'front_camera_selfie',
    },
  });
  assert.match(selfie.prompt, /front-camera smartphone selfie/);
  const portrait = builder.buildImagePrompt({
    intent: {
      purpose: 'portrait',
      sceneDescription: 'standing near a selfie booth',
      captureMode: 'external_camera',
    },
  });
  assert.match(portrait.prompt, /50mm portrait lens/);
  assert.doesNotMatch(portrait.prompt, /front-camera smartphone selfie/);
});
