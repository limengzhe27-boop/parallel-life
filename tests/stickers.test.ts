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
import { WorldPhoneSchema } from '../src/contracts/world-build.ts';
test('world phone contract accepts a real semantic sticker id, not a UUID placeholder', () => {
  const parsed = WorldPhoneSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    seedId: '00000000-0000-4000-8000-000000000002',
    title: '测试',
    time: '2026-10-20T00:00:00.000Z',
    identity: '测试',
    setting: '测试',
    actors: [],
    messages: [
      {
        id: 'm1',
        actorId: '00000000-0000-4000-8000-000000000003',
        text: '',
        stickerId: 'xswl',
        at: '2026-10-20T00:00:00.000Z',
      },
    ],
    notes: [],
    invitations: [],
  });
  assert.equal(parsed.messages[0]?.stickerId, 'xswl');
});
