import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorContext,
  ACTOR_CONTEXT_LIMIT,
  ACTOR_INPUT_LIMIT,
} from '../src/modules/world/application/actor-context.ts';
import type { WorldState, Message } from '../src/modules/world/domain/types.ts';
const time = '2026-09-22T08:00:00.000Z';
function world(): WorldState {
  return {
    schemaVersion: 1,
    id: 'world',
    ownerId: 'owner',
    version: 0,
    title: '世界',
    time,
    actors: [
      { id: 'a', name: '甲', persona: '导演' },
      { id: 'b', name: '乙', persona: '摄影师' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
}
function message(id: string, text: string, actorId = 'a'): Message {
  return { id, text, actorId, role: 'user', at: time, sourceEventId: 'event_' + id };
}
test('relevant older messages survive beyond the last thirty with attribution and chronological order', () => {
  const state = world();
  state.messages = [
    message('old', '我们约好在海边摄影棚见面'),
    ...Array.from({ length: 45 }, (_, i) => message('m' + i, '今天的天气不错')),
  ];
  const result = actorContext(state, 'a', '海边摄影棚约在什么时候？');
  assert.equal(result.messages[0]?.id, 'old');
  assert.equal(result.messages[0]?.sourceEventId, 'event_old');
  assert.equal(result.messages.at(-1)?.id, 'm44');
  assert.equal(result.messages.filter((m) => m.id === 'old').length, 1);
});
test('private facts, foreign conversations and appointments neither leak nor influence selection', () => {
  const state = world();
  state.messages = [message('allowed', '海边摄影棚见'), message('secret', '海边摄影棚秘密', 'b')];
  const expected = actorContext(state, 'a', '海边摄影棚');
  state.facts = [
    { id: 'f', text: '海边摄影棚秘密', visibility: { kind: 'owner' }, sourceEventId: 'e' },
    {
      id: 'g',
      text: '海边摄影棚秘密',
      visibility: { kind: 'actors', actorIds: ['b'] },
      sourceEventId: 'e',
    },
  ];
  state.appointments = [
    {
      id: 'appointment',
      title: '海边摄影棚秘密',
      at: time,
      participantIds: ['b'],
      sourceEventId: 'e',
    },
  ];
  assert.deepEqual(actorContext(state, 'a', '海边摄影棚'), expected);
  assert.equal(JSON.stringify(expected).includes('秘密'), false);
});
test('combined payload is bounded even with escape-heavy history and large visible facts', () => {
  const state = world();
  state.messages = Array.from({ length: 200 }, (_, i) => message('m' + i, '"\\\n'.repeat(500)));
  state.facts = Array.from({ length: 500 }, (_, i) => ({
    id: 'f' + i,
    text: '回忆'.repeat(1000),
    visibility: { kind: 'world' as const },
    sourceEventId: 'e',
  }));
  const query = '"'.repeat(4000);
  const context = actorContext(state, 'a', query);
  assert.ok(JSON.stringify(context).length <= ACTOR_CONTEXT_LIMIT);
  assert.ok(JSON.stringify({ context, userText: query }).length <= ACTOR_INPUT_LIMIT);
  assert.equal(context.messages.at(-1)?.id, 'm199');
});
test('bounded facts cannot crowd out a relevant old memory and returned records are detached', () => {
  const state = world();
  state.messages = [
    message('old', '极光计划还没有完成'),
    ...Array.from({ length: 40 }, (_, i) => message('m' + i, '日常对话')),
  ];
  state.facts = Array.from({ length: 100 }, (_, i) => ({
    id: 'f' + i,
    text: '公共资料'.repeat(100),
    visibility: { kind: 'world' as const },
    sourceEventId: 'e',
  }));
  const result = actorContext(state, 'a', '极光计划');
  assert.ok(result.messages.some((m) => m.id === 'old'));
  result.messages[0]!.text = 'changed';
  assert.equal(state.messages[0]!.text, '极光计划还没有完成');
});
test('unknown actor, oversize input and oversize mandatory identity fail closed', () => {
  const state = world();
  assert.throws(() => actorContext(state, 'missing'));
  assert.throws(() => actorContext(state, 'a', '字'.repeat(4001)));
  state.actors[0]!.persona = '字'.repeat(25000);
  assert.throws(() => actorContext(state, 'a'));
});

test('the latest escape-heavy message is retained whole rather than silently dropped by the recent quota', () => {
  const state = world();
  state.messages = [message('latest', '"'.repeat(4000))];
  const result = actorContext(state, 'a', '你好');
  assert.equal(result.messages[0]?.text, state.messages[0]?.text);
});

test('memory scopes and forgotten sources are enforced before they can reach the NPC model', () => {
  const state = world();
  state.messages = [message('remember', '留下这句'), message('forget', '这句已经被遗忘')];
  state.facts = [
    {
      id: 'forgotten-fact',
      text: '遗忘事件事实',
      visibility: { kind: 'world' },
      sourceEventId: 'event_forget',
    },
  ];
  const shared = {
    id: 'good',
    ownerId: state.ownerId,
    scopeType: 'character' as const,
    scopeId: 'a',
    branchId: state.id,
    kind: 'belief' as const,
    text: '记得他喜欢这组照片',
    sourceType: 'agent_inference' as const,
    sourceIds: ['remember'],
    status: 'active' as const,
    importance: 5,
    createdAt: time,
  };
  const records = [
    shared,
    { ...shared, id: 'other-character', scopeId: 'b' },
    { ...shared, id: 'private', scopeType: 'profile' as const },
    { ...shared, id: 'other-world', branchId: 'foreign' },
    { ...shared, id: 'old', status: 'forgotten' as const },
    { ...shared, id: 'blocked', sourceIds: ['event_forget'] },
  ];
  const result = actorContext(state, 'a', '照片', records, new Set(['event_forget']));
  assert.deepEqual(
    result.retrievedMemories?.map((m) => m.id),
    ['good'],
  );
  assert.deepEqual(
    result.messages.map((m) => m.id),
    ['remember'],
  );
  assert.deepEqual(result.facts, []);
});
