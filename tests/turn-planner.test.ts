import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';
const context: ActorContext = {
  worldId: 'world',
  worldVersion: 0,
  time: '2026-10-08T09:00:00.000Z',
  actor: {
    id: 'actor',
    name: '搭档',
    relationship: '我的同级搭档，没有上下级关系',
    persona: '一起经营工作室',
  },
  facts: [],
  messages: [],
  appointments: [],
};
test('later friend replies reject explicit superior claims in structured and plain responses', async () => {
  for (const raw of [
    '我是你老板，你必须服从我',
    JSON.stringify({
      schemaVersion: 1,
      effects: [
        {
          type: 'message.received',
          id: 'reply',
          actorId: 'actor',
          text: '我是你老板，你必须服从我',
        },
      ],
    }),
  ])
    await assert.rejects(
      new WorldTurnPlanner({
        async complete() {
          return raw;
        },
      }).propose({ context, userText: '初稿你看了吗？' }),
      /MODEL_OUTPUT_NOT_DIALOGUE/,
    );
});
test('later friend replies preserve ordinary cooperation and negated hierarchy', async () => {
  for (const text of ['不是你的直属上司，我们一起讨论吧。', '我来负责剪辑，你来决定拍摄的方向？']) {
    const result = (await new WorldTurnPlanner({
      async complete(messages) {
        assert.match(messages[0]!.content, /actor.relationship/);
        return text;
      },
    }).propose({ context, userText: '影展怎么分工？' })) as { effects: { text: string }[] };
    assert.equal(result.effects[0]!.text, text);
  }
});

test('return planning requests an evidence-anchored step without changing ordinary user chat prompts', async () => {
  const facts = [
    {
      id: 'limit',
      text: '试做两种配方后选择菜单',
      visibility: { kind: 'world' as const },
      sourceEventId: 'seed',
    },
  ];
  for (const origin of [undefined, 'director'] as const) {
    let calls = 0;
    await new WorldTurnPlanner({
      async complete(messages) {
        calls++;
        const input = JSON.parse(messages[1]!.content);
        if (origin === 'director') {
          assert.deepEqual(input.returnFocus.knownSituation, ['试做两种配方后选择菜单']);
          assert.match(messages[0]!.content, /本轮交付要求/);
          assert.match(input.returnFocus.requirement, /用户尚未报告完成/);
        } else {
          assert.equal(input.returnFocus, undefined);
          assert(!messages[0]!.content.includes('本轮交付要求'));
        }
        return '两种配方可以分别试一小盘，我帮你记用料，你先选哪种？';
      },
    }).propose({ context: { ...context, facts, turnOrigin: origin }, userText: '先试做两种配方' });
    assert.equal(calls, 1);
  }
});

test('invalid optional goal evidence cannot replace a valid reply or partially advance a goal', async () => {
  const reply = {
    type: 'message.received',
    id: 'reply',
    actorId: 'actor',
    text: '知道了，我自己安排。',
  };
  const goalKey = 'publication:test_event';
  const scoped = { ...context, turnOrigin: 'director' as const, introducingEventGoalKey: goalKey };
  const valid = {
    goalKey,
    target: 'npc',
    kind: 'closure',
    quote: reply.text,
    closure: 'alternative',
  };
  for (const annotations of [
    [{ ...valid, quote: '改写的、并不存在的原话' }],
    [{ ...valid, goalKey: 'publication:other_event' }],
    [{ ...valid, target: 'user', kind: 'declined' }],
    [{ ...valid, complete: true }],
    [valid, { ...valid, quote: '另一条不在消息中的原话' }],
    [valid, valid],
    { kind: 'closure' },
  ]) {
    const result = await new WorldTurnPlanner({
      async complete() {
        return JSON.stringify({
          schemaVersion: 1,
          effects: [reply],
          eventGoalAssessments: annotations,
        });
      },
    }).propose({ context: scoped, userText: '导演安排' });
    assert.deepEqual(result, { schemaVersion: 1, effects: [reply], eventGoalAssessments: [] });
  }
  const result = await new WorldTurnPlanner({
    async complete() {
      return JSON.stringify({ schemaVersion: 1, effects: [reply], eventGoalAssessments: [valid] });
    },
  }).propose({ context: scoped, userText: '导演安排' });
  assert.deepEqual(result, { schemaVersion: 1, effects: [reply], eventGoalAssessments: [valid] });
});

test('source binding retains refusal and real reply; ambiguous or foreign reply cannot supply evidence', async () => {
  const goalKey = 'publication:test_event';
  const goal = {
    goalKey,
    actorId: 'actor',
    source: {
      kind: 'director_event' as const,
      sourceEventId: 'opening',
      sourceRecordId: 'message',
    },
    want: '核对海报日期',
    stance: '平等协作',
    boundaries: [],
    phase: 'introduced' as const,
    status: 'active' as const,
    participation: 'unknown' as const,
    refusalScope: 'current_player_request' as const,
    mayPursueOwnGoalWithoutPlayer: true as const,
    actualMovesRequireRuntimeAuthorization: true as const,
    pace: 'extended' as const,
    productiveBeats: 1,
    segmentIndex: 0,
    nextMove: 'wait' as const,
  };
  const ownReply = {
    type: 'message.received',
    id: 'reply',
    actorId: 'actor',
    text: '这次先不找你帮忙了。',
  };
  const userText = '我这次不参加了，别再问我。';
  for (const director of [false, true]) {
    const result = await new WorldTurnPlanner({
      async complete(messages) {
        assert.match(messages[0]!.content, /source=current_user/);
        assert.match(messages[0]!.content, /不再复述上一句/);
        return JSON.stringify({
          schemaVersion: 1,
          effects: [ownReply],
          eventGoalAssessments: [
            { goalKey, target: 'user', kind: 'declined', source: 'current_user' },
            {
              goalKey,
              target: 'npc',
              kind: 'closure',
              source: 'current_reply',
              closure: 'withdrawn',
            },
          ],
        });
      },
    }).propose({
      context: {
        ...context,
        eventGoals: [goal],
        ...(director ? { turnOrigin: 'director' as const } : {}),
      },
      userText,
    });
    assert.deepEqual(
      (result as any).eventGoalAssessments,
      director
        ? []
        : [
            { goalKey, target: 'user', kind: 'declined', quote: userText },
            { goalKey, target: 'npc', kind: 'closure', quote: ownReply.text, closure: 'withdrawn' },
          ],
    );
    assert.deepEqual((result as any).effects, [ownReply]);
  }
  for (const effects of [
    [{ ...ownReply, actorId: 'other' }],
    [ownReply, { ...ownReply, id: 'reply2' }],
  ]) {
    const result = await new WorldTurnPlanner({
      async complete() {
        return JSON.stringify({
          schemaVersion: 1,
          effects,
          eventGoalAssessments: [
            {
              goalKey,
              target: 'npc',
              kind: 'closure',
              source: 'current_reply',
              closure: 'withdrawn',
            },
          ],
        });
      },
    }).propose({ context: { ...context, eventGoals: [goal] }, userText });
    assert.deepEqual((result as any).eventGoalAssessments, []);
  }
});
