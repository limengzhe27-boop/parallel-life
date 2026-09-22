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
