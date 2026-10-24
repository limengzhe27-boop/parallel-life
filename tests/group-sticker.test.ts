import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planGroupTurn } from '../src/modules/world/application/group-turn.ts';
import { stickerMessageContent } from '../src/features/phone/apps/sticker-content.ts';
import { groupPreview } from '../src/features/phone/groups/state.ts';
import { groupReplyEvent } from '../src/modules/world/infrastructure/group-repository.ts';
import { reduceGroupEvent } from '../src/modules/world/domain/group-runtime.ts';
import { WorldGroupPlanner } from '../src/modules/world/infrastructure/group-planner.ts';
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

test('NPC group reply text and sticker become two independent messages', () => {
  const event = groupReplyEvent(
    'u',
    read.world,
    'task',
    'g',
    [{ actorId: 'a', text: '好啊', stickerId: 'zan' }],
    '2026-10-24T01:00:00.000Z',
  );
  if (event.type !== 'group.turn_resolved') throw Error('expected group turn');
  const context = {
    world: { ...read.world, version: event.version },
    events: [...read.context.events, event],
  };
  assert.ok(event.data.replies[0]!.stickerMessageId);
  const reduced = reduceGroupEvent(context, read.group, event);
  assert.deepEqual(
    reduced.messages.map((m) => m.text),
    ['好啊', marker],
  );
  assert.notEqual(reduced.messages[0]!.id, reduced.messages[1]!.id);
});

test('NPC can send a pure group sticker and unknown stickers are rejected', () => {
  const pure = groupReplyEvent(
    'u',
    read.world,
    'task',
    'g',
    [{ actorId: 'a', text: '', stickerId: 'zan' }],
    '2026-10-24T01:00:00.000Z',
  );
  if (pure.type !== 'group.turn_resolved') throw Error('expected group turn');
  const context = {
    world: { ...read.world, version: pure.version },
    events: [...read.context.events, pure],
  };
  const reduced = reduceGroupEvent(context, read.group, pure);
  assert.equal(reduced.messages.length, 1);
  assert.equal(reduced.messages[0]!.text, marker);
  assert.equal(pure.data.replies[0]!.stickerMessageId, undefined);

  const unknown = groupReplyEvent(
    'u',
    read.world,
    'task',
    'g',
    [{ actorId: 'a', text: '哈', stickerId: 'not-a-sticker' }],
    '2026-10-24T01:00:00.000Z',
  );
  if (unknown.type !== 'group.turn_resolved') throw Error('expected group turn');
  assert.throws(
    () =>
      reduceGroupEvent(
        {
          world: { ...read.world, version: unknown.version },
          events: [...read.context.events, unknown],
        },
        read.group,
        unknown,
      ),
    (error: any) => error.code === 'INVALID_COMMAND',
  );
});

test('group planner accepts a sticker id from the visible catalog only', async () => {
  let seen: any;
  const input = {
    actor: read.world.actors[0]!,
    worldTitle: '群聊',
    storyAt: read.world.time,
    publicFacts: [],
    groupTitle: '群聊',
    members: [],
    messages: [],
  };
  const planner = new WorldGroupPlanner({
    async complete(messages) {
      seen = JSON.parse(messages[1]!.content as string);
      return JSON.stringify({ text: '', stickerId: 'zan' });
    },
  });
  const reply = await planner.propose(input);
  assert.equal(reply.text, '');
  assert.equal(reply.stickerId, 'zan');
  assert.ok(seen.stickerCatalog.some((sticker: any) => sticker.id === 'zan'));

  const invalid = new WorldGroupPlanner({
    async complete() {
      return JSON.stringify({ text: '', stickerId: 'not-a-sticker' });
    },
  });
  await assert.rejects(
    () => invalid.propose(input),
    (error: any) => error.code === 'INVALID_RESPONSE',
  );
});
