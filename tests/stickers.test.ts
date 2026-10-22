import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStickerText } from '../src/features/phone/stickers.ts';
test('sticker marker parses only known ids', () => {
  assert.deepEqual(parseStickerText('[[sticker:cat]]'), {
    id: 'cat',
    label: '猫',
    src: '/stickers/cat.svg',
  });
  assert.equal(parseStickerText('[[sticker:nope]]'), null);
  assert.equal(parseStickerText('你好 [[sticker:cat]]'), null);
});
