import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStickerText } from '../src/features/phone/stickers.ts';
test('sticker marker parses only known ids', () => {
  assert.deepEqual(parseStickerText('[[sticker:xswl]]'), {
    id: 'xswl',
    label: '笑死我了',
    src: '/stickers/xswl.svg',
  });
  assert.equal(parseStickerText('[[sticker:nope]]'), null);
  assert.equal(parseStickerText('你好 [[sticker:xswl]]'), null);
});
