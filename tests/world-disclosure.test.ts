import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent } from '../src/modules/world/domain/reducer.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import { isExplicitlyConfidential } from '../src/modules/world/domain/validation.ts';
import type { WorldEvent, WorldState } from '../src/modules/world/domain/types.ts';

const t0 = '2026-09-24T08:00:00.000Z';
const t1 = '2026-09-25T08:00:00.000Z';
function world(line = '我想明年转去拍纪录片'): WorldState {
  return {
    schemaVersion: 1,
    id: 'world_1',
    ownerId: 'owner_1',
    version: 1,
    title: '导演人生',
    time: t0,
    actors: [
      { id: 'sister', name: '姐姐', persona: '会在家庭里斟酌说话', relationship: '姐姐' },
      { id: 'mother', name: '妈妈', persona: '关心孩子', relationship: '妈妈' },
      { id: 'friend', name: '朋友', persona: '独立', relationship: '朋友' },
    ],
    actorTies: [
      { fromActorId: 'sister', toActorId: 'mother', relationship: '同住家人', mayShare: true },
      { fromActorId: 'sister', toActorId: 'friend', relationship: '互不熟悉', mayShare: false },
    ],
    facts: [],
    messages: [
      {
        id: 'msg_user',
        actorId: 'sister',
        role: 'user',
        text: line,
        at: t0,
        sourceEventId: 'previous',
        sourceVersion: 1,
      },
      {
        id: 'msg_reply',
        actorId: 'sister',
        role: 'assistant',
        text: '我知道了',
        at: t0,
        sourceEventId: 'previous',
        sourceVersion: 1,
      },
    ],
    appointments: [],
    mediaRequests: [],
  };
}
function share(
  quote = '明年转去拍纪录片',
  recipientActorId = 'mother',
  sourceMessageId = 'msg_user',
): WorldEvent {
  return {
    schemaVersion: 1,
    id: 'event_share',
    worldId: 'world_1',
    version: 2,
    commandId: 'command_share',
    occurredAt: t1,
    storyAt: t1,
    type: 'turn.resolved',
    data: {
      actorId: 'sister',
      origin: 'director',
      disclosurePolicyVersion: 2,
      userText: '（导演节拍：用户没有开口。）',
      effects: [
        { type: 'message.received', id: 'reply', actorId: 'sister', text: '那事我会再想想' },
        { type: 'information.shared', id: 'share', recipientActorId, sourceMessageId, quote },
      ],
    },
  };
}

test('a director disclosure has a real user source and only its recipient can know it', () => {
  const after = applyEvent(world(), share()).state;
  const fact = after.facts[0]!;
  assert.equal(fact.kind, 'belief');
  assert.equal(fact.disclosure?.sourceMessageId, 'msg_user');
  assert.equal(fact.believedByActorId, 'mother');
  assert.equal(
    actorContext(after, 'mother').facts.some((item) => item.id === fact.id),
    true,
  );
  assert.equal(
    actorContext(after, 'friend').facts.some((item) => item.id === fact.id),
    false,
  );
  assert.equal(
    actorContext(after, 'sister').facts.some((item) => item.id === fact.id),
    false,
  );
  assert.equal(
    buildAgenda(after).some(
      (item) => item.kind === 'disclosure_followup' && item.actorId === 'mother',
    ),
    true,
  );
  assert.equal(
    after.messages.filter((item) => item.role === 'user').length,
    1,
    'director never impersonates the player',
  );
});

test('a user turn, a made-up source and explicit confidence cannot disclose to another NPC', () => {
  const normalTurn = share();
  delete normalTurn.data.origin;
  assert.throws(() => applyEvent(world(), normalTurn), /Only a director beat/);
  assert.throws(
    () => applyEvent(world(), share('明年转去拍纪录片', 'mother', 'missing')),
    /shareable source/,
  );
  assert.throws(
    () => applyEvent(world('我想明年转去拍纪录片，这件事别告诉妈妈'), share()),
    /shareable source/,
  );
  assert.throws(() => applyEvent(world(), share('不存在的原话')), /shareable source/);
});

test('a disclosed quote cannot be sent to the same recipient twice', () => {
  const once = applyEvent(world(), share()).state;
  const replay = share();
  replay.id = 'event_again';
  replay.commandId = 'command_again';
  replay.version = 3;
  replay.storyAt = '2026-09-26T08:00:00.000Z';
  replay.occurredAt = replay.storyAt;
  replay.data.effects = [
    { type: 'message.received', id: 'reply_again', actorId: 'sister', text: '又想起这件事' },
    {
      type: 'information.shared',
      id: 'share_again',
      recipientActorId: 'mother',
      sourceMessageId: 'msg_user',
      quote: '明年转去拍纪录片',
    },
  ];
  assert.throws(() => applyEvent(once, replay), /shareable source/);
});

test('new disclosures require an explicit directed and shareable NPC tie', () => {
  assert.throws(() => applyEvent(world(), share('明年转去拍纪录片', 'friend')), /shareable source/);
  const old = world();
  delete old.actorTies;
  assert.throws(() => applyEvent(old, share()), /shareable source/);
  const blocked = world();
  blocked.actorTies![0]!.mayShare = false;
  assert.throws(() => applyEvent(blocked, share()), /shareable source/);
  const historical = share();
  delete historical.data.disclosurePolicyVersion;
  assert.equal(applyEvent(old, historical).state.facts.length, 1);
});

test('a confidence request is recognized without treating every secret as an absolute ban', () => {
  for (const line of ['这事别跟妈妈说', '只告诉你，别让朋友知道', "please don't tell anyone"])
    assert.equal(isExplicitlyConfidential(line), true);
  assert.equal(isExplicitlyConfidential('我有个秘密，想明年去拍纪录片'), false);
});
