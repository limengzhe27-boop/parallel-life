import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
const world = {
  id: 'world-a',
  seedId: 'seed-a',
  title: '测试',
  identity: '私密背景不用于联系人',
  setting: '设定',
  time: '2026-09-22T00:30:00Z',
  actors: [{ id: 'actor-a', name: '甲', relationship: '同事' }],
  messages: [{ id: 'm1', actorId: 'actor-a', text: '明天来吗？', at: '2026-09-22T00:30:00Z' }],
  notes: [{ title: '记事', text: '私人便签' }],
};
test('opening adapter does not turn an invitation in chat into an accepted event or fabricated media', () => {
  const data = worldAppData(world);
  assert.deepEqual(data.invitations, []);
  assert.deepEqual(data.photos, []);
  assert.equal(data.messages[0]?.text, '明天来吗？');
  assert.equal(data.contacts[0]?.unread, 1);
  assert.equal('identity' in data.contacts[0]!, false);
});
test('viewed messages do not suppress later notifications and opening note ids are world scoped', () => {
  const viewed = new Set(['m1']);
  assert.equal(worldAppData(world, viewed).contacts[0]?.unread, 0);
  assert.equal(
    worldAppData(
      { ...world, messages: [...world.messages, { ...world.messages[0]!, id: 'm2' }] },
      viewed,
    ).contacts[0]?.unread,
    1,
  );
  assert.notEqual(
    worldAppData(world).notes[0]?.id,
    worldAppData({ ...world, id: 'world-b' }).notes[0]?.id,
  );
});
test('calendar uses persisted versions and own messages are not unread incoming messages', () => {
  const data = worldAppData({
    ...world,
    version: 7,
    messages: [...world.messages, { ...world.messages[0]!, id: 'mine', role: 'user' }],
    invitations: [
      {
        id: 'invite',
        title: '见面',
        at: world.time,
        participantIds: ['actor-a'],
        status: 'confirmed',
      },
    ],
  });
  assert.equal(data.messages[1]?.role, 'user');
  assert.equal(data.contacts[0]?.unread, 1);
  assert.equal(data.invitations[0]?.version, 7);
  assert.equal(data.invitations[0]?.status, 'confirmed');
});
test('album projection retains provenance and builds only private local image URLs', () => {
  const data = worldAppData({
    ...world,
    photos: [
      {
        id: 'photo-1',
        worldId: world.id,
        title: '我的照片',
        date: world.time,
        createdAt: world.time,
        kind: 'upload',
        revision: 2,
        width: 300,
        height: 400,
      },
    ],
  });
  assert.equal(data.photos[0]?.url, '/api/v1/assets/photo-1?revision=2');
  assert.equal(data.photos[0]?.description, '你上传的照片');
  assert.equal(data.photos[0]?.status, 'ready');
});
test('only server-confirmed messages count as sent; local ones keep their real state', () => {
  const data = worldAppData(world);
  assert.equal(data.messages[0]?.status, 'sent');
  /* 服务端已按错峰保存时间，前端不再二次偏移 */
  assert.equal(data.messages[0]?.at, world.messages[0]!.at);
  const local = [
    {
      id: 'local-failed',
      actorId: 'actor-a',
      role: 'user' as const,
      text: '这句没发出去',
      at: '2026-09-22T00:31:00Z',
      status: 'failed' as const,
    },
    {
      id: 'local-pending',
      actorId: 'actor-a',
      role: 'user' as const,
      text: '正在发送',
      at: '2026-09-22T00:32:00Z',
      status: 'pending' as const,
    },
  ];
  const merged = worldAppData(world, new Set(), local);
  assert.deepEqual(
    merged.messages.map((message) => [message.id, message.status]),
    [
      ['m1', 'sent'],
      ['local-failed', 'failed'],
      ['local-pending', 'pending'],
    ],
  );
  /* 在途消息不会把未读数算成别人的新消息 */
  assert.equal(merged.contacts[0]?.unread, 1);
});

