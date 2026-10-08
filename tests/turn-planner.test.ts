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
