import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectActorPersona,
  reserveActorContext,
  legacyPersonaExcerpt,
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
test('an indivisible long persona remains usable as a bounded source excerpt', () => {
  const source = 'x'.repeat(20000);
  const selected = selectActorPersona({ traits: source }, '')!;
  assert(selected.traits!.length > 0);
  assert(selected.traits!.length <= 1600);
  for (const part of selected.traits!.split('\n')) assert(source.includes(part));
  assert.equal(source.length, 20000);
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

test('stable personality dimensions do not change with player topic; biography still follows relevance', () => {
  const core =
    '嘴硬心软，对陌生人强势，对妹妹退让。\n' +
    '日常保持克制与边界。\n'.repeat(300) +
    '海边时会放松说笑。';
  const modules = {
    traits: core,
    drives: core,
    behavior: core,
    relationships: core,
    lifeContext:
      '大学毕业后定居。\n' +
      '普通生活经历。\n'.repeat(300) +
      '曾在海边做救生员。\n曾在医院做志愿者。',
  };
  const beach = selectActorPersona(modules, '海边'),
    hospital = selectActorPersona(modules, '医院');
  for (const key of ['traits', 'drives', 'behavior', 'relationships'] as const) {
    assert.equal(beach![key], hospital![key]);
    assert.match(beach![key]!, /对陌生人强势，对妹妹退让/);
  }
  assert.match(beach!.lifeContext!, /海边做救生员/);
  assert.match(hospital!.lifeContext!, /医院做志愿者/);
  assert.notEqual(beach!.lifeContext, hospital!.lifeContext);
});

test('legacy structured personality and final capacity fallback use the same stable-core rule', () => {
  const source = JSON.stringify({
    identity: '作者身份不得改',
    boundaries: '不泄露私人信息',
    traits: { details: ['嘴硬心软。', ...Array(100).fill('平时克制。'), '海边会笑。'] },
    lifeContext: '普通经历。'.repeat(200) + '海边做救生员。',
  });
  const a = JSON.parse(legacyPersonaExcerpt(source, '海边', 500));
  const b = JSON.parse(legacyPersonaExcerpt(source, '医院', 500));
  assert.deepEqual(a.traits, b.traits);
  assert.equal(a.identity, '作者身份不得改');
  assert.equal(a.boundaries, '不泄露私人信息');
  const input = {
    ...base,
    authoredLifeModules: {
      traits: '嘴硬心软，对陌生人强势，对妹妹退让。\n' + '日常克制。'.repeat(6000),
    },
  };
  const before = structuredClone(input);
  const first = reserveActorContext(input, '海边');
  const second = reserveActorContext(input, '医院');
  assert.equal(first.authoredLifeModules.traits, second.authoredLifeModules.traits);
  assert.match(first.authoredLifeModules.traits, /嘴硬心软/);
  assert.deepEqual(input, before);
});
