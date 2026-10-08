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
  notes: [
    {
      id: 'note-1',
      title: '记事',
      text: '私人便签',
      version: 1,
      updatedAt: '2026-09-22T00:30:00Z',
    },
  ],
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
  /* 便签 id 现在由服务端给出（开场便签按世界作用域生成），前端原样透传、不再自己造 id */
  assert.equal(worldAppData(world).notes[0]?.id, 'note-1');
  assert.equal(worldAppData({ ...world, id: 'world-b' }).notes[0]?.id, 'note-1');
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
  assert.equal(data.photos[0]?.url, '/api/v1/assets/photo-1?worldId=world-a&revision=2');
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
test('a sourced choice is a read-only story entry, and a player report is not treated as proof', () => {
  const choiceAt = '2026-09-22T00:31:00Z';
  const resultAt = '2026-09-22T01:42:00Z';
  const data = worldAppData({
    ...world,
    choices: [
      {
        id: 'choice-1',
        actorId: 'actor-a',
        quote: '我决定先把短片剪完',
        intent: '剪完短片',
        at: choiceAt,
        sourceEventId: 'event-1',
        status: 'followed_up',
        nextStep: {
          quote: '发我文件，我留半小时看',
          at: '2026-09-22T01:00:00Z',
          sourceEventId: 'event-step',
          sourceMessageId: 'message-step',
          calendar: {
            id: 'invitation-1',
            title: '一起看初剪',
            at: '2026-09-22T02:00:00Z',
            status: 'confirmed',
          },
        },
        result: {
          kind: 'reported_done',
          quote: '我把短片剪完了',
          at: resultAt,
          sourceEventId: 'event-2',
        },
      },
    ],
  });
  assert.deepEqual(data.choices, [
    {
      id: 'choice-1',
      actorName: '甲',
      quote: '我决定先把短片剪完',
      intent: '剪完短片',
      at: choiceAt,
      status: 'followed_up',
      nextStep: {
        quote: '发我文件，我留半小时看',
        at: '2026-09-22T01:00:00Z',
        calendar: {
          id: 'invitation-1',
          title: '一起看初剪',
          at: '2026-09-22T02:00:00Z',
          status: 'confirmed',
        },
      },
      result: { kind: 'reported_done', quote: '我把短片剪完了', at: resultAt },
    },
  ]);
  assert.equal(data.notes.length, 1, 'system story entries must not become editable user notes');
  assert.deepEqual(data.photos, [], 'a reported result is not evidence of a generated photo');
});

test('a setback can show the actor’s later proposal without becoming the player’s action', () => {
  const data = worldAppData({
    ...world,
    choices: [
      {
        id: 'choice-blocked',
        actorId: 'actor-a',
        quote: '我决定先把短片剪完',
        intent: '剪完短片',
        at: '2026-09-22T00:00:00Z',
        sourceEventId: 'event-choice',
        status: 'followed_up',
        result: {
          kind: 'blocked',
          quote: '我剪到一半卡住了',
          at: '2026-09-22T01:00:00Z',
          sourceEventId: 'event-blocked',
        },
        recoveryStep: {
          quote: '我可以帮你看前三分钟，先找能剪掉的镜头',
          at: '2026-09-22T01:10:00Z',
          sourceEventId: 'event-recovery',
          sourceMessageId: 'message-recovery',
        },
      },
    ],
  });
  assert.equal(data.choices?.[0]?.result?.kind, 'blocked');
  assert.deepEqual(data.choices?.[0]?.recoveryStep, {
    quote: '我可以帮你看前三分钟，先找能剪掉的镜头',
    at: '2026-09-22T01:10:00Z',
  });
  assert.equal(data.notes.length, 1, 'the proposal is a read-only story record');
});

test('uploaded photo names never imply AI generation or a fictional event', () => {
  const photos = ['身份写真', '旅行现场纪念'].map((title, index) => ({
    id: `upload-${index}`,
    worldId: world.id,
    title,
    date: world.time,
    createdAt: world.time,
    kind: 'upload' as const,
    revision: 1,
    width: 30,
    height: 40,
  }));
  for (const photo of worldAppData({ ...world, photos }).photos) {
    assert.equal(photo.tag, 'upload');
    assert.equal(photo.description, '你上传的照片');
  }
});

test('note receipts preserve canonical IDs and versions without depending on a refresh', async () => {
  const { mergeNoteReceipt } = await import('../src/features/phone/world-receipts.ts');
  const note = {
    id: 'server-id',
    title: '新的便签',
    text: '内容',
    version: 1,
    updatedAt: world.time,
  };
  const receipt = {
    status: 'committed' as const,
    commandId: 'cmd',
    worldId: world.id,
    version: 8,
    note,
  };
  const saved = mergeNoteReceipt({ ...world, version: 7 }, receipt)!;
  assert.deepEqual(saved.notes[0], note);
  assert.equal(saved.version, 8);
  assert.equal(mergeNoteReceipt(saved, receipt)!.notes.filter((n) => n.id === note.id).length, 1);
  const updated = mergeNoteReceipt(saved, {
    ...receipt,
    version: 9,
    note: { ...note, version: 2, text: '已编辑' },
  })!;
  assert.equal(mergeNoteReceipt(updated, receipt), updated);
  assert.equal(mergeNoteReceipt(updated, { ...receipt, worldId: 'other' }), updated);
  assert.equal(mergeNoteReceipt(null, receipt), null);
});

test('a selected person uses the same scoped original image for avatar and album', () => {
  const data = worldAppData({
    ...world,
    actors: [
      {
        ...world.actors[0]!,
        sourcePersonId: 'person-a',
        photo: { assetId: 'photo-1', revision: 2 },
      },
    ],
    photos: [
      {
        id: 'photo-1',
        worldId: world.id,
        title: '用户带入的照片',
        date: world.time,
        createdAt: world.time,
        kind: 'upload',
        revision: 2,
        width: 300,
        height: 300,
        sourcePersonId: 'person-a',
      },
    ],
  });
  assert.equal(data.contacts[0]?.avatarUrl, data.photos[0]?.url);
  assert.match(data.photos[0]!.description ?? '', /上传时间/);
  assert.equal(data.photos[0]?.sourcePersonId, 'person-a');
});
