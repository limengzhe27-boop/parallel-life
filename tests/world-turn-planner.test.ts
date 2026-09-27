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
