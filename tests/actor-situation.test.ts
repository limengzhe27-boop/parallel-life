import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectActorPersona,
  reserveActorContext,
} from '../src/modules/world/domain/actor-situation.ts';
import { WorldTurnPlanner } from '../src/modules/world/infrastructure/turn-planner.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';
const base: ActorContext = {
  worldId: 'world',
  worldVersion: 2,
  time: '2026-10-15T07:00:00.000Z',
  actor: { id: 'qing', name: '青青', persona: '嘴硬心软，熟悉主角的习惯' },
  facts: [],
  messages: [],
  appointments: [],
};
const situation: NonNullable<ActorContext['actorSituation']> = {
  worldVersion: 2,
  storyAt: base.time,
  eventOutcome: null,
  opening: {
    nodeKey: 'hospital',
    direction: '你在医院照顾母亲，联系玩家来接手，伤情尚不清楚。',
    sourceMessageId: 'm1',
    sourceEventId: 'e1',
    deliveredAt: base.time,
    sourceVersion: 1,
  },
};
test('oversize personality preserves every supplied dimension as intact source units', () => {
  const modules = {
    lifeContext: '青梅竹马，认识多年。\n' + '完整背景句子。\n'.repeat(400),
    traits: '嘴硬心软。\n' + '有分寸地表达关心。\n'.repeat(400),
    drives: '希望被认真对待。\n' + '医院里希望有人接手照护。\n'.repeat(400),
    behavior: '先做事再抱怨。\n' + '询问到医院的时间，不虚构伤情。\n'.repeat(400),
    relationships: '熟悉彼此的习惯。\n' + '遇事会保护主角。\n'.repeat(400),
  };
  const original = structuredClone(modules),
    selected = selectActorPersona(modules, '医院照护伤情')!;
  assert.deepEqual(modules, original);
  assert.deepEqual(Object.keys(selected).sort(), Object.keys(modules).sort());
  for (const key of Object.keys(selected) as (keyof typeof modules)[]) {
    assert(selected[key]!.startsWith(modules[key].split('\n')[0]!));
    for (const unit of selected[key]!.split('\n')) assert(modules[key].includes(unit));
  }
  assert(JSON.stringify(selected).length < 9000);
});
test('an indivisible pathological persona fails explicitly rather than quietly disappearing', () => {
  assert.throws(
    () => selectActorPersona({ traits: 'x'.repeat(20000) }, ''),
    /ACTOR_PERSONA_UNIT_EXCEEDS_BUDGET/,
  );
});
test('personality and present situation survive optional recall pressure without mutating sources', () => {
  const input = {
    ...base,
    actorSituation: situation,
    authoredLifeModules: { traits: '独立人格。', behavior: '先确认具体困难。' },
    messages: Array.from({ length: 12 }, (_, i) => ({ id: String(i), text: '旧记录'.repeat(700) })),
    retrievedMemories: Array.from({ length: 8 }, () => ({ text: '过往'.repeat(700) })),
    authoredPosts: [{ text: '日常'.repeat(3000) }],
  };
  const snapshot = structuredClone(input),
    output = reserveActorContext(input, '现在发生什么？');
  assert(JSON.stringify(output).length <= 18000);
  assert.deepEqual(output.actorSituation, situation);
  assert.deepEqual(output.authoredLifeModules, input.authoredLifeModules);
  assert.deepEqual(output.messages.slice(-4), input.messages.slice(-4));
  assert.deepEqual(input, snapshot);
});
test('private direction reaches the actor model with current world time and clear non-factual status', async () => {
  let calls = 0;
  await new WorldTurnPlanner({
    async complete(messages) {
      calls++;
      const payload = JSON.parse(messages[1]!.content);
      assert.deepEqual(payload.currentSituation, situation);
      assert.equal(payload.world.time, situation.storyAt);
      assert.match(messages[0]!.content, /不是全部已发生事实/);
      assert.match(messages[0]!.content, /已拒绝请求不重复索要或催促/);
      assert.match(messages[0]!.content, /所有角色共用此世界时间/);
      return '我在医院陪着阿姨，具体伤情还没确认。你现在方便赶来吗？';
    },
  }).propose({ context: { ...base, actorSituation: situation }, userText: '现在怎么回事？' });
  assert.equal(calls, 1);
});
