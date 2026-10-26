import test from 'node:test';
import assert from 'node:assert/strict';
import { actorRetrievalQueries } from '../src/modules/world/application/actor-retrieval-queries.ts';
import {
  actorContext,
  ACTOR_CONTEXT_LIMIT,
} from '../src/modules/world/application/actor-context.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { Message, WorldState } from '../src/modules/world/domain/types.ts';

function fixture() {
  const at = '2026-10-27T08:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'a' }, 'definition', 0);
  state.questions = Array.from({ length: 9 }, (_, i) => ({
    id: `q${i}`,
    channel: 'private' as const,
    threadId: 'a',
    sourceId: `message:q${i}`,
    text: '你喜欢哪种照片风格？',
    askedAt: at,
    status: 'open' as const,
  }));
  const narrative = [
    {
      sourceId: 'narrative:opening',
      evidenceKind: 'authored_context',
      text: JSON.stringify({
        text: JSON.stringify({
          type: 'received_opening_information',
          assertion: 'report',
          content: '林白语邀请他周末见自己的父亲',
          executionEvidence: false,
        }),
      }),
    },
  ];
  const msg = (id: string, text: string, actorId = 'a'): Message => ({
    id,
    text,
    actorId,
    role: 'assistant',
    at,
    sourceEventId: `event:${id}`,
  });
  const world: WorldState = {
    schemaVersion: 1,
    id: 'world',
    ownerId: 'owner',
    title: '原世界',
    time: at,
    version: 50,
    actors: [
      { id: 'a', name: '林白语', persona: '有自己的立场' },
      { id: 'b', name: '另一人', persona: '独立' },
    ],
    facts: [],
    appointments: [],
    mediaRequests: [],
    messages: [
      msg('initial', '我周末可以带你去见我爸爸。'),
      msg('old', '周末那个见爸爸的计划，先准备点好吃的。'),
      msg('other-secret', '周末见爸爸的私人秘密', 'b'),
      ...Array.from({ length: 30 }, (_, i) => msg(`photo${i}`, '你喜欢这种照片风格吗？')),
    ],
  };
  world.messages[0]!.sourceEventId = 'publication-genesis:world';
  const scope = {
    origin: 'wake',
    state,
    actorId: 'a',
    threadId: 'a',
    narrative,
    blockedSources: new Set<string>(),
  };
  return { world, state, scope };
}
test('autonomous personal topic recalls already sent opening and follow-up inside original history budget', () => {
  const { world, scope } = fixture();
  const before = structuredClone(world);
  const trigger = JSON.stringify({
    type: 'npc_agenda_review',
    basisSourceIds: ['definition:actor'],
  });
  const old = actorContext(world, 'a', trigger);
  assert.ok(!old.messages.some((m) => m.id === 'initial'));
  const hints = actorRetrievalQueries(scope);
  const context = actorContext(world, 'a', trigger, [], scope.blockedSources, hints);
  assert.ok(context.messages.some((m) => m.id === 'initial'));
  assert.ok(context.messages.some((m) => m.id === 'old'));
  assert.ok(!context.messages.some((m) => m.actorId === 'b'));
  assert.ok(context.messages.length <= 12 + 8);
  assert.ok(JSON.stringify(context).length <= ACTOR_CONTEXT_LIMIT);
  assert.deepEqual(
    context.messages.find((m) => m.id === 'initial'),
    world.messages[0],
  );
  assert.equal(context.messages.find((m) => m.id === 'old')!.sourceEventId, 'event:old');
  assert.deepEqual(world, before);
  assert.deepEqual(scope.state.decisions, []);
});
test('ordinary player selection is unchanged and blocked sources cannot influence hints or returned history', () => {
  const { world, scope } = fixture();
  const query = '照片风格';
  assert.deepEqual(actorRetrievalQueries({ ...scope, origin: 'player' }), []);
  assert.deepEqual(
    actorContext(world, 'a', query),
    actorContext(
      world,
      'a',
      query,
      [],
      new Set(),
      actorRetrievalQueries({ ...scope, origin: 'player' }),
    ),
  );
  const blocked = new Set([
    'narrative:opening',
    'initial',
    'event:old',
    ...scope.state.questions!.map((q) => q.sourceId),
  ]);
  assert.deepEqual(actorRetrievalQueries({ ...scope, blockedSources: blocked }), []);
  const result = actorContext(world, 'a', '周末见爸爸', [], blocked, ['周末见爸爸']);
  assert.ok(!result.messages.some((m) => ['initial', 'old', 'other-secret'].includes(m.id)));
});
test('only live own plans and current-channel open questions provide bounded independent queries', () => {
  const { scope, state } = fixture();
  state.goals = [
    {
      id: 'goal',
      summary: '核对校园聚会安排',
      status: 'active',
      sourceIds: ['known'],
      resultIds: [],
    },
    { id: 'done', summary: '终态秘密', status: 'fulfilled', sourceIds: ['known'], resultIds: [] },
  ];
  state.plans = [
    {
      id: 'plan',
      goalId: 'goal',
      summary: '询问聚会时间',
      status: 'waiting',
      sourceIds: ['known'],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['时间待定'],
    },
  ];
  state.questions!.push({
    ...state.questions![0]!,
    id: 'foreign-thread',
    threadId: 'b',
    text: '别人的私聊主题',
  });
  const result = actorRetrievalQueries(scope);
  assert.ok(result.includes('核对校园聚会安排'));
  assert.ok(result.includes('询问聚会时间'));
  assert.ok(!result.includes('终态秘密'));
  assert.ok(!result.includes('别人的私聊主题'));
  assert.ok(result.length <= 16);
  assert.ok(result.every((q) => q.length <= 600));
  assert.ok(
    !actorRetrievalQueries({ ...scope, blockedSources: new Set(['known']) }).includes(
      '核对校园聚会安排',
    ),
  );
});
