import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCharacterReference } from '../src/modules/media/domain/character-reference-resolver.ts';
import type { CharacterVisualAnchor, ImageGenerationIntent } from '../src/modules/media/domain/types.ts';

test('resolveCharacterReference: pure scene requests do not attach character references', () => {
  const intent: ImageGenerationIntent = {
    purpose: 'scene',
    sceneDescription: '巨鹿路秋天梧桐树落叶的街景',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-director',
    isCallerPlayer: false,
    playerPortraitAssetId: 'asset-player-portrait-1',
  });

  assert.equal(outcome.allowed, true);
  if (outcome.allowed) {
    assert.equal(outcome.mode, 'pure_scene');
    assert.equal(outcome.referenceAssetId, undefined);
    assert.equal(outcome.characterPromptSnippet, '');
  }
});

test('resolveCharacterReference: pure scene explicitly rejects attaching player portrait', () => {
  const intent: ImageGenerationIntent = {
    purpose: 'scene',
    sceneDescription: '巨鹿路街景',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-director',
    isCallerPlayer: false,
    playerPortraitAssetId: 'asset-player-portrait-1',
    explicitReferenceAssetId: 'asset-player-portrait-1', // Attempted leak
  });

  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.code, 'FORBIDDEN_PLAYER_PORTRAIT_LEAK');
  }
});

test('resolveCharacterReference: NPC request strictly forbids fallback to player portrait', () => {
  const npcAnchor: CharacterVisualAnchor = {
    actorId: 'actor-npc-lin',
    name: '林白语',
    gender: 'female',
    age: 26,
    hairStyle: 'long',
    hairColor: 'black',
    distinctiveFeatures: ['silver hairpin'],
    clothingStyle: 'modern beige trenchcoat',
    referenceAssetId: undefined, // NPC has NO portrait uploaded
    referenceAssetRevision: undefined,
    isPlayer: false,
    authorizedForWorld: true,
  };

  const intent: ImageGenerationIntent = {
    purpose: 'portrait',
    targetActorId: 'actor-npc-lin',
    sceneDescription: '站在咖啡馆门前微笑',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-npc-lin',
    isCallerPlayer: false,
    targetAnchor: npcAnchor,
    playerPortraitAssetId: 'asset-player-portrait-1', // Player portrait exists in world
  });

  assert.equal(outcome.allowed, true);
  if (outcome.allowed) {
    // Mode must be text_anchored_only, NOT reference_guided!
    assert.equal(outcome.mode, 'text_anchored_only');
    assert.equal(outcome.referenceAssetId, undefined);
    assert.ok(outcome.characterPromptSnippet.includes('林白语'));
    assert.ok(outcome.characterPromptSnippet.includes('silver hairpin'));
    assert.ok(outcome.characterPromptSnippet.includes('beige trenchcoat'));
  }
});

test('resolveCharacterReference: NPC request with forged player portrait reference is strictly rejected', () => {
  const npcAnchor: CharacterVisualAnchor = {
    actorId: 'actor-npc-lin',
    name: '林白语',
    gender: 'female',
    referenceAssetId: undefined,
    referenceAssetRevision: undefined,
    isPlayer: false,
    authorizedForWorld: true,
  };

  const intent: ImageGenerationIntent = {
    purpose: 'portrait',
    targetActorId: 'actor-npc-lin',
    sceneDescription: '在书店翻看相册',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-npc-lin',
    isCallerPlayer: false,
    targetAnchor: npcAnchor,
    playerPortraitAssetId: 'asset-player-portrait-1',
    explicitReferenceAssetId: 'asset-player-portrait-1', // Malicious attempt to use player face
  });

  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.code, 'FORBIDDEN_PLAYER_PORTRAIT_LEAK');
  }
});

test('resolveCharacterReference: NPC request with authorized bound asset succeeds with reference_guided', () => {
  const npcAnchor: CharacterVisualAnchor = {
    actorId: 'actor-npc-lin',
    name: '林白语',
    gender: 'female',
    age: 26,
    referenceAssetId: 'asset-lin-portrait-2',
    referenceAssetRevision: 1,
    isPlayer: false,
    authorizedForWorld: true,
  };

  const intent: ImageGenerationIntent = {
    purpose: 'portrait',
    targetActorId: 'actor-npc-lin',
    sceneDescription: '在美术馆长椅上看画展',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-npc-lin',
    isCallerPlayer: false,
    targetAnchor: npcAnchor,
    playerPortraitAssetId: 'asset-player-portrait-1',
  });

  assert.equal(outcome.allowed, true);
  if (outcome.allowed) {
    assert.equal(outcome.mode, 'reference_guided');
    assert.equal(outcome.referenceAssetId, 'asset-lin-portrait-2');
    assert.equal(outcome.referenceAssetRevision, 1);
  }
});

test('resolveCharacterReference: rejects unauthorized or non-admitted characters', () => {
  const intent: ImageGenerationIntent = {
    purpose: 'portrait',
    targetActorId: 'actor-unknown-ghost',
    sceneDescription: '在老洋房院落里',
  };

  const outcome = resolveCharacterReference({
    intent,
    callerActorId: 'actor-player',
    isCallerPlayer: true,
    targetAnchor: undefined,
  });

  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.code, 'CHARACTER_NOT_AUTHORIZED_IN_WORLD');
  }
});
