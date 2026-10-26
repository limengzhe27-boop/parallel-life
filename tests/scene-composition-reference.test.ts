import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { composeSceneReference } from '../src/modules/media/infrastructure/scene-composition-reference.ts';
test('scene reference is one bounded contact sheet with separate people and actual place/time, never a finished scene', async () => {
  const make = async (color: string) =>
    sharp({ create: { width: 64, height: 96, channels: 3, background: color } })
      .png()
      .toBuffer();
  const people = await Promise.all(
    ['#f00', '#00f'].map(async (color, i) => ({
      actorId: 'actor-' + i,
      name: '人物' + i,
      assetId: 'ref-' + i,
      mimeType: 'image/png',
      bytes: await make(color),
    })),
  );
  const result = await composeSceneReference({
    place: { assetId: 'place', mimeType: 'image/png', bytes: await make('#0f0') },
    people,
    placeName: '西餐厅',
    storyAt: '2026-10-26T10:30:00.000Z',
  });
  assert(result);
  assert.deepEqual(result.referenceAssetIds, ['place', 'ref-0', 'ref-1']);
  assert.equal(result.mimeType, 'image/png');
  const info = await sharp(result.bytes).metadata();
  assert.equal(info.width, 1200);
  assert.equal(info.height, 1370);
  assert.match(result.compositionPrompt, /西餐厅/);
  assert.match(result.compositionPrompt, /18:30/);
  assert.match(result.compositionPrompt, /NOT the desired output/);
  assert.match(result.compositionPrompt, /exactly 2 different/);
  assert.match(result.compositionPrompt, /unified lighting/);
  assert.equal(await composeSceneReference({ place: null, people: [] }), null);
  await assert.rejects(
    composeSceneReference({ place: null, people: [...people, ...people, ...people, ...people] }),
    { code: 'INVALID_INPUT', responseOutcome: 'not_sent' },
  );
});
