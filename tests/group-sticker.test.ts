import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGroupTurn } from '../src/modules/world/application/group-turn.ts';
import { stickerMessageContent } from '../src/features/phone/apps/sticker-content.ts';
import { groupPreview } from '../src/features/phone/groups/state.ts';
import type { GroupRead } from '../src/modules/world/application/group-ports.ts';
import type { GroupMessage } from '../src/modules/world/domain/experience-rules.ts';

const marker = '[[sticker:zan]]';
const message: GroupMessage = {
  id: 'm1',
  ownerId: 'u',
  worldId: 'w',
  sourceEventId: 'e1',
  sourceVersion: 1,
  conversationId: 'g',
  sender: { kind: 'player' },
  text: marker,
  media: [],
};
const read: GroupRead = {
  world: {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'u',
    version: 1,
    title: '群聊',
    time: '2026-10-24T00:00:00.000Z',
    actors: [{ id: 'a', name: '阿一', persona: '朋友' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  },
  context: {
    world: {
      id: 'w',
      ownerId: 'u',
      version: 1,
      actors: [{ id: 'a', name: '阿一', persona: '朋友' }],
    },
    events: [{ id: 'e1', ownerId: 'u', worldId: 'w', version: 1 }],
  },
  group: {
    id: 'g',
    ownerId: 'u',
    worldId: 'w',
    title: '群聊',
    sourceEventId: 'e1',
    sourceVersion: 1,
    memberships: [
      { participant: { kind: 'player' }, joinedVersion: 1, sourceEventId: 'e1', sourceVersion: 1 },
      {
        participant: { kind: 'actor', actorId: 'a' },
        joinedVersion: 1,
        sourceEventId: 'e1',
        sourceVersion: 1,
      },
    ],
  },
  messages: [message],
};

test('group sticker stays a marker in storage and renders as an image for the player', () => {
  const content = stickerMessageContent(marker);
  assert.equal(content.imageOnly, true);
  assert.equal(content.sticker?.id, 'zan');
  assert.equal(content.text, '');
  assert.equal(
    groupPreview({ messages: [message] } as Parameters<typeof groupPreview>[0], []),
    '我：[赞]',
  );
});

test('group model receives a semantic sticker label instead of the raw marker', async () => {
  let seen = '';
  await planGroupTurn(
    read,
    '',
    {
      async propose(input) {
        seen = input.messages.at(-1)!.text;
        return { text: '收到' };
      },
    },
    undefined,
    1,
  );
  assert.match(seen, /\[表情：/);
  assert.match(seen, /赞/);
  assert.doesNotMatch(seen, /\[\[sticker:/);
});
