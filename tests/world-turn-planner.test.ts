import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';

const mockContext: ActorContext = {
  worldId: 'world-123',
  worldVersion: 1,
  worldTitle: '如果成为独立导演',
  time: '2026-09-24T12:00:00.000Z',
  actor: {
    id: 'actor-director-partner',
    name: '林见夏',
    relationship: '制片合伙人',
    persona: '做事干练、严谨负责',
  },
  facts: [
    {
      id: 'f-1',
      text: '【主角身份】独立电影青年导演',
      visibility: { kind: 'world' },
      sourceEventId: 'genesis:123',
    },
  ],
  messages: [],
  appointments: [],
};

test('WorldTurnPlanner normalizes mismatched actorId and placeholder into targetActorId', async () => {
  const planner = new WorldTurnPlanner({
    async complete() {
      return JSON.stringify({
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'raw-reply-1',
            actorId: '角色ID', // 模型生成的占位符
            text: '分镜表我已经审完了，下午三点我们开会碰一下细节。',
          },
        ],
      });
    },
  });

  const result = (await planner.propose({
    context: mockContext,
    userText: '见夏，今天的拍摄准备得怎么样了？',
  })) as { effects: Array<{ type: string; actorId: string; text: string }> };

  assert.equal(result.effects[0]?.actorId, 'actor-director-partner');
  assert.equal(result.effects[0]?.text, '分镜表我已经审完了，下午三点我们开会碰一下细节。');
});

test('optional model choice is kept only when it quotes a real explicit decision', async () => {
  const planner = new WorldTurnPlanner({
    complete: async () =>
      JSON.stringify({
        schemaVersion: 1,
        effects: [
          { type: 'message.received', id: 'reply', actorId: 'wrong', text: '好，等你发来。' },
          { type: 'choice.recorded', id: 'choice', quote: '我决定先剪短片', intent: '先剪片' },
        ],
      }),
  });
  const chosen = (await planner.propose({
    context: mockContext,
    userText: '我决定先剪短片，今晚发给你。',
  })) as { effects: { type: string }[] };
  assert.deepEqual(
    chosen.effects.map((e) => e.type),
    ['message.received', 'choice.recorded'],
  );
  const hypothetical = (await planner.propose({
    context: mockContext,
    userText: '如果我决定先剪短片会怎样？',
  })) as { effects: { type: string }[] };
  assert.deepEqual(
    hypothetical.effects.map((e) => e.type),
    ['message.received'],
  );
});

test('model result reports require an existing visible choice and an explicit matching user statement', async () => {
  const context: ActorContext = {
    ...mockContext,
    choices: [
      {
        id: 'choice_1',
        actorId: mockContext.actor.id,
        quote: '我决定先把短片剪到十五分钟',
        intent: '完成十五分钟短片',
        sourceEventId: 'event_1',
        sourceVersion: 1,
        status: 'followed_up',
      },
    ],
  };
  const planner = new WorldTurnPlanner({
    complete: async () =>
      JSON.stringify({
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'reply',
            actorId: mockContext.actor.id,
            text: '发我看看文件。',
          },
          {
            type: 'choice.result_reported',
            id: 'result',
            choiceId: 'choice_1',
            quote: '我把短片剪完了',
            outcome: 'reported_done',
          },
        ],
      }),
  });
  const accepted = (await planner.propose({ context, userText: '我把短片剪完了，发你了。' })) as {
    effects: { type: string }[];
  };
  assert.deepEqual(
    accepted.effects.map((effect) => effect.type),
    ['message.received', 'choice.result_reported'],
  );
  const uncertain = (await planner.propose({
    context,
    userText: '如果我把短片剪完了会怎样？',
  })) as { effects: { type: string }[] };
  assert.deepEqual(
    uncertain.effects.map((effect) => effect.type),
    ['message.received'],
  );
  const foreign = (await planner.propose({
    context: { ...context, choices: [] },
    userText: '我把短片剪完了。',
  })) as { effects: { type: string }[] };
  assert.deepEqual(
    foreign.effects.map((effect) => effect.type),
    ['message.received'],
  );
});

test('a director next step must quote its own reply for the pending choice', async () => {
  const context: ActorContext = {
    ...mockContext,
    turnOrigin: 'director',
    choices: [
      {
        id: 'choice_1',
        actorId: mockContext.actor.id,
        quote: '我决定先剪短片',
        intent: '剪完短片',
        sourceEventId: 'event_1',
        sourceVersion: 1,
        status: 'pending',
      },
    ],
  };
  const planner = new WorldTurnPlanner({
    complete: async () =>
      JSON.stringify({
        schemaVersion: 1,
        effects: [
          {
            type: 'message.received',
            id: 'reply',
            actorId: 'wrong',
            text: '我留半小时，剪完发我先看开头。',
          },
          { type: 'choice.next_step', id: 'step', choiceId: 'choice_1', quote: '剪完发我先看开头' },
        ],
      }),
  });
  const accepted = (await planner.propose({ context, userText: '[choice:choice_1]导演提示' })) as {
    effects: { type: string }[];
  };
  assert.deepEqual(
    accepted.effects.map((effect) => effect.type),
    ['message.received', 'choice.next_step'],
  );
  const withoutCue = (await planner.propose({ context, userText: '导演提示' })) as {
    effects: { type: string }[];
  };
  assert.deepEqual(
    withoutCue.effects.map((effect) => effect.type),
    ['message.received'],
  );
  const { turnOrigin: _origin, ...userContext } = context;
  const userTurn = (await planner.propose({
    context: userContext,
    userText: '[choice:choice_1]',
  })) as { effects: { type: string }[] };
  assert.deepEqual(
    userTurn.effects.map((effect) => effect.type),
    ['message.received'],
  );
});

test('a concrete director offer in the reply is retained even when the model omits its tag', async () => {
  const context: ActorContext = {
    ...mockContext,
    turnOrigin: 'director',
    choices: [
      {
        id: 'choice_1',
        actorId: mockContext.actor.id,
        quote: '我决定先剪短片',
        intent: '剪完短片',
        sourceEventId: 'event_1',
        sourceVersion: 1,
        status: 'pending',
      },
    ],
  };
  let reply = '我今晚先把混音档期往后挪一天，你专心剪。';
  const planner = new WorldTurnPlanner({
    complete: async () =>
      JSON.stringify({
        schemaVersion: 1,
        effects: [
          { type: 'message.received', id: 'reply', actorId: mockContext.actor.id, text: reply },
        ],
      }),
  });
  const cue = '[choice:choice_1]导演提示';
  const offered = (await planner.propose({ context, userText: cue })) as {
    effects: { type: string; quote?: string }[];
  };
  assert.equal(offered.effects[1]?.type, 'choice.next_step');
  assert.equal(offered.effects[1]?.quote, '我今晚先把混音档期往后挪一天，你专心剪');
  reply = '看到啦。辛苦了，别太晚。';
  const greeting = (await planner.propose({ context, userText: cue })) as {
    effects: { type: string }[];
  };
  assert.deepEqual(
    greeting.effects.map((effect) => effect.type),
    ['message.received'],
  );
});

test('WorldTurnPlanner gracefully wraps plain natural text into valid message.received effect', async () => {
  const planner = new WorldTurnPlanner({
    async complete() {
      return '没问题！今天现场光线很好，我先去安排摄影组走位，随时联系。';
    },
  });

  const result = (await planner.propose({
    context: mockContext,
    userText: '辛苦了，现场见！',
  })) as { effects: Array<{ type: string; actorId: string; text: string }> };

  assert.equal(result.effects[0]?.type, 'message.received');
  assert.equal(result.effects[0]?.actorId, 'actor-director-partner');
  assert.equal(
    result.effects[0]?.text,
    '没问题！今天现场光线很好，我先去安排摄影组走位，随时联系。',
  );
});

test('WorldTurnPlanner intercepts crisis intent with compassionate hotline response', async () => {
  const planner = new WorldTurnPlanner({
    async complete() {
      throw new Error('Should not reach model in crisis');
    },
  });

  const result = (await planner.propose({
    context: mockContext,
    userText: '活着太累了，我想结束这一切',
  })) as { effects: Array<{ type: string; actorId: string; text: string }> };

  assert.equal(result.effects[0]?.type, 'message.received');
  assert.equal(result.effects[0]?.actorId, 'actor-director-partner');
  assert.ok(result.effects[0]?.text.includes('400-161-9995'));
});

test('malformed structured replies and empty output never become NPC dialogue', async () => {
  for (const raw of [
    '',
    '{"schemaVersion":1,"effects":[{"text":"未转义的"引号""}]}',
    '{"schemaVersion":1,"effects":[]}',
    JSON.stringify({
      schemaVersion: 1,
      effects: [{ type: 'message.received', text: '{"effects": []}' }],
    }),
  ]) {
    const planner = new WorldTurnPlanner({ complete: async () => raw });
    await assert.rejects(
      planner.propose({ context: mockContext, userText: '继续聊聊' }),
      /MODEL_OUTPUT_NOT_DIALOGUE/,
    );
  }
});
test('fenced valid JSON and trailing commas still yield genuine dialogue', async () => {
  const planner = new WorldTurnPlanner({
    complete: async () =>
      '```json\n{"schemaVersion":1,"effects":[{"type":"message.received","text":"下午见。",}],}\n```',
  });
  const result = (await planner.propose({ context: mockContext, userText: '下午见' })) as {
    effects: { text: string }[];
  };
  assert.equal(result.effects[0]?.text, '下午见。');
});

test('NPC model receives authorized memories with attribution and a grounded scene direction', async () => {
  let payload: Record<string, any> = {};
  const planner = new WorldTurnPlanner({
    complete: async (messages) => {
      payload = JSON.parse(messages[1]!.content);
      return '还记得，你想把街拍做成一本小册子。';
    },
  });
  const memory = {
    id: 'memory-1',
    ownerId: 'owner',
    scopeType: 'character' as const,
    scopeId: mockContext.actor.id,
    branchId: mockContext.worldId,
    kind: 'belief' as const,
    text: '用户想做街拍小册子',
    sourceType: 'agent_inference' as const,
    sourceIds: ['message-1'],
    status: 'active' as const,
    importance: 4,
    createdAt: mockContext.time,
  };
  await planner.propose({
    context: { ...mockContext, retrievedMemories: [memory] },
    userText: '还记得我想做什么吗？',
  });
  assert.deepEqual(payload.recalledMemories, [
    {
      id: memory.id,
      kind: memory.kind,
      text: memory.text,
      sourceType: memory.sourceType,
      sourceIds: memory.sourceIds,
    },
  ]);
  assert.equal(payload.sceneDirection.move, 'answer');
  assert.equal(payload.turnOrigin, 'user');
  assert.equal(JSON.stringify(payload).includes('ownerId'), false);
  await planner.propose({
    context: { ...mockContext, turnOrigin: 'director' },
    userText: '（用户没有开口）',
  });
  assert.equal(payload.turnOrigin, 'director');
});
