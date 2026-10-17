import test from 'node:test';
import assert from 'node:assert/strict';
import { findRelatedInvitation, mergeIncomingDraft } from '../src/features/phone/apps/appointment-link.ts';
import type { PhoneInvitation, PhonePhoto } from '../src/features/phone/apps/types.ts';
import { projectStoryTime } from '../src/modules/world/domain/clock.ts';
import { worldAppData } from '../src/features/phone/world-app-data.ts';

test('findRelatedInvitation prioritizes active confirmed/proposed appointments over old cancelled ones', () => {
  const invitations: PhoneInvitation[] = [
    {
      id: 'old-cancelled',
      title: '旧的咖啡约定',
      at: '2026-10-15T10:00:00.000Z',
      participantIds: ['actor-1'],
      status: 'cancelled',
      version: 1,
    },
    {
      id: 'new-confirmed',
      title: '新确认的晚餐约定',
      at: '2026-10-18T18:00:00.000Z',
      participantIds: ['actor-1'],
      status: 'confirmed',
      version: 2,
    },
    {
      id: 'proposed-later',
      title: '下周的展览邀约',
      at: '2026-10-22T14:00:00.000Z',
      participantIds: ['actor-1'],
      status: 'proposed',
      version: 3,
    },
  ];

  const selected = findRelatedInvitation(
    invitations,
    'actor-1',
    '2026-10-17T12:00:00.000Z',
  );

  assert.ok(selected);
  assert.equal(selected.id, 'new-confirmed');
  assert.equal(selected.title, '新确认的晚餐约定');
  assert.equal(selected.status, 'confirmed');
});

test('findRelatedInvitation falls back to most recent terminal appointment when no active ones exist', () => {
  const invitations: PhoneInvitation[] = [
    {
      id: 'old-cancelled-1',
      title: '最早取消的约定',
      at: '2026-10-10T10:00:00.000Z',
      participantIds: ['actor-2'],
      status: 'cancelled',
      version: 1,
    },
    {
      id: 'recent-attended',
      title: '最近已赴约的饭局',
      at: '2026-10-16T12:00:00.000Z',
      participantIds: ['actor-2'],
      status: 'attended',
      version: 2,
    },
  ];

  const selected = findRelatedInvitation(invitations, 'actor-2', '2026-10-17T12:00:00.000Z');
  assert.ok(selected);
  assert.equal(selected.id, 'recent-attended');
  assert.equal(selected.status, 'attended');
});

test('findRelatedInvitation returns null when no appointments match the actor', () => {
  const invitations: PhoneInvitation[] = [
    {
      id: 'other-actor-inv',
      title: '其他人的约定',
      at: '2026-10-18T18:00:00.000Z',
      participantIds: ['actor-999'],
      status: 'confirmed',
      version: 1,
    },
  ];

  const selected = findRelatedInvitation(invitations, 'actor-1');
  assert.equal(selected, null);
});

test('cross-app draft mergeIncomingDraft preserves existing message drafts without overwriting', () => {
  // Case 1: Empty draft receives incoming text directly
  const state1 = mergeIncomingDraft(undefined, '想约你明天一起吃饭');
  assert.equal(state1, '想约你明天一起吃饭');

  // Case 2: Existing draft is preserved, incoming text appended on a newline
  const state2 = mergeIncomingDraft(
    '这是我之前写到一半的话，不要删掉',
    '想约你明天一起吃饭',
  );
  assert.equal(
    state2,
    '这是我之前写到一半的话，不要删掉\n想约你明天一起吃饭',
  );

  // Case 3: Duplicate incoming text is not appended twice
  const state3 = mergeIncomingDraft(state2, '想约你明天一起吃饭');
  assert.equal(
    state3,
    '这是我之前写到一半的话，不要删掉\n想约你明天一起吃饭',
  );
});

test('album photo upload projected story time advances with world clock', () => {
  const worldStateTime = '2026-10-17T08:00:00.000Z';
  const clock = {
    storyNow: '2026-10-17T08:00:00.000Z',
    speed: 1,
    paused: false,
    lastTickAt: '2026-10-17T00:00:00.000Z',
    missedBeats: 0,
    summary: null,
  };

  // 4 real hours later
  const realNow = '2026-10-17T04:00:00.000Z';
  const projected = projectStoryTime(clock, realNow);

  assert.equal(projected, '2026-10-17T12:00:00.000Z');
  // Projected story time is strictly ahead of the static world state commit time
  assert.ok(Date.parse(projected) > Date.parse(worldStateTime));
});

test('album photos check prevents invalid navigation from non-album chat media attachments', () => {
  const albumPhotos: PhonePhoto[] = [
    {
      id: 'photo-in-album-1',
      date: '2026-10-17',
      title: '生活照1',
      description: '公开相册照片',
      status: 'ready',
    },
  ];

  const chatAttachmentAssetId = 'asset-chat-exclusive-xyz';
  const albumPhotoId = 'photo-in-album-1';

  // Album check
  assert.equal(
    albumPhotos.some((p) => p.id === albumPhotoId),
    true,
    'Album photo exists in album',
  );
  assert.equal(
    albumPhotos.some((p) => p.id === chatAttachmentAssetId),
    false,
    'Chat exclusive attachment must NOT be treated as present in album',
  );
});

test('worldAppData attaches photo card when message shares an album photo title', () => {
  const appData = worldAppData({
    id: 'world-1',
    seedId: 'seed-1',
    title: '测试世界',
    time: '2026-10-17T10:00:00.000Z',
    identity: '玩家',
    setting: '现代都市',
    messages: [
      {
        id: 'msg-share-1',
        actorId: 'actor-1',
        role: 'user',
        text: '[分享了相册照片：《我的工作台》]',
        at: '2026-10-17T10:00:00.000Z',
      },
    ],
    photos: [
      {
        id: 'photo-work-1',
        worldId: 'world-1',
        date: '2026-10-17',
        title: '我的工作台',
        createdAt: '2026-10-17T10:00:00.000Z',
        kind: 'upload',
        width: 800,
        height: 600,
        revision: 1,
      },
    ],
    actors: [{ id: 'actor-1', name: '青青', relationship: '好友' }],
    invitations: [],
    notes: [],
  });

  const msg = appData.messages.find((m: any) => m.id === 'msg-share-1');
  assert.ok(msg);
  assert.ok(msg.photo);
  assert.equal(msg.photo.id, 'photo-work-1');
  assert.equal(msg.photo.title, '我的工作台');
});
