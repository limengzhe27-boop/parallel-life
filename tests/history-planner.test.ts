import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HistoryPlanner,
  HISTORY_MAX_TOKENS,
} from '../src/modules/world/infrastructure/history-planner.ts';
import { WorldPlanner } from '../src/modules/world/infrastructure/world-planner.ts';
import { ApprovedSeedSchema } from '../src/contracts/seeds.ts';
import { randomUUID } from 'node:crypto';
import { settingContent } from './fixtures/life-setting.ts';
const at = '1998-01-01T00:00:00.000Z';
const opening = {
  identity: '店主',
  setting: '杭州社区的早晨',
  actors: ['a', 'b', 'c'].map((key, index) => ({
    key,
    name: '名字' + index,
    relationship: '私有未公开关系',
    persona: '后台不能泄露的动机' + index,
  })),
  messages: [{ actorKey: 'a', text: '今天开门吗？' }],
  notes: [{ title: '备忘', text: '私人便签不送历史生成' }],
};
const valid = {
  groups: opening.actors.map((_, i) => ({
    actorIndex: i,
    messages: [{ text: '那件配件我已经替你留着了。', minutesBeforeStart: 1440 + i }],
  })),
};
const seed = ApprovedSeedSchema.parse({
  id: randomUUID(),
  createdAt: at,
  profileVersion: 0,
  discoveryVersion: 0,
  directionId: randomUUID(),
  story: {
    title: '社区维修铺',
    premise: '经营维修铺',
    opening: '开始新一天',
    tradeoff: '需要协调时间',
  },
  people: [],
  facts: [],
  events: [],
  assets: [],
  portraitAssetId: null,
});
test('history input exposes only authorized setting and visible cast; runtime binds all identifiers', async () => {
  const result = await new HistoryPlanner({
    async complete(messages, _signal, cap, options) {
      assert.equal(cap, HISTORY_MAX_TOKENS);
      assert.deepEqual(options, { format: 'json_object' });
      const input = JSON.parse(messages[1]!.content);
      assert.deepEqual(Object.keys(input), ['storyTime', 'identity', 'setting', 'cast']);
      assert(
        input.cast.every(
          (a: object) => Object.keys(a).join(',') === 'actorIndex,name,relationship',
        ),
      );
      assert(!JSON.stringify(input).includes('后台'));
      assert(!JSON.stringify(input).includes('私有未公开关系'));
      assert(input.cast.every((a: { relationship: string }) => a.relationship === ''));
      assert(!JSON.stringify(input).includes('私人便签'));
      return JSON.stringify(valid);
    },
  }).propose(opening, at);
  assert.deepEqual(
    result.messages.map((m) => m.actorKey),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    result.messages.map((m) => m.key),
    ['past_0_0', 'past_1_0', 'past_2_0'],
  );
});
test('missing groups, forbidden player fields, duplicate times and invalid dates cannot be filled by runtime', async () => {
  for (const invalid of [
    { groups: valid.groups.slice(0, 2) },
    { groups: [{ actorIndex: 0, messages: [] }, ...valid.groups.slice(1)] },
    {
      groups: valid.groups.map((g, i) =>
        i === 0 ? { ...g, messages: [{ ...g.messages[0], role: 'user' }] } : g,
      ),
    },
    {
      groups: valid.groups.map((g, i) =>
        i === 0 ? { ...g, messages: [g.messages[0], g.messages[0]] } : g,
      ),
    },
    {
      groups: valid.groups.map((g) => ({
        ...g,
        messages: g.messages.map((e) => ({ ...e, minutesBeforeStart: 5 })),
      })),
    },
    { groups: [valid.groups[0], valid.groups[0], valid.groups[2]] },
    {
      groups: valid.groups.map((g) => ({
        ...g,
        actorIndex: g.actorIndex === 0 ? 7 : g.actorIndex,
      })),
    },
    { ...valid, actors: [] },
  ]) {
    let calls = 0;
    await assert.rejects(
      new HistoryPlanner({
        async complete() {
          calls++;
          return JSON.stringify(invalid);
        },
      }).propose(opening, at),
      { code: 'INVALID_RESPONSE' },
    );
    assert.equal(calls, 2);
  }
});
test('one known history correction keeps frozen world and uses expected cast count', async () => {
  let calls = 0;
  const result = await new HistoryPlanner({
    async complete(messages) {
      calls++;
      if (calls === 1) return JSON.stringify({ groups: [] });
      assert.match(messages[2]!.content, /恰好3组/);
      return JSON.stringify(valid);
    },
  }).propose(opening, at);
  assert.equal(calls, 2);
  assert.equal(result.messages.length, 3);
});
test('history transport unknown, truncated or cancellation never triggers paid correction', async () => {
  for (const code of ['TIMEOUT', 'CANCELLED', 'TRUNCATED']) {
    let calls = 0;
    await assert.rejects(
      new HistoryPlanner({
        async complete() {
          calls++;
          throw Object.assign(Error(code), { code });
        },
      }).propose(opening, at),
      { code },
    );
    assert.equal(calls, 1);
  }
});
test('two-step freezes ordinary opening, shares deadline and only then adds validated history', async () => {
  let calls = 0;
  let shared: AbortSignal | undefined;
  const result = await new WorldPlanner(
    {
      async complete(messages, signal) {
        calls++;
        if (calls === 1) {
          shared = signal;
          assert.doesNotMatch(messages[0]!.content, /messageHistory/);
          return JSON.stringify(opening);
        }
        assert.equal(signal, shared);
        return JSON.stringify(valid);
      },
    },
    { historyEnabled: true, historyMode: 'two-step' },
  ).propose(seed, undefined, at);
  assert.equal(calls, 2);
  assert.deepEqual(result.actors, opening.actors);
  assert.deepEqual(result.messages, opening.messages);
  assert.equal(result.messageHistory!.messages.length, 3);
});
test('two-step authored cast stays server-authored and history covers the exact full cast', async () => {
  const content = settingContent();
  const trial = ApprovedSeedSchema.parse({
    id: randomUUID(),
    createdAt: at,
    source: { kind: 'setting_draft', draftId: randomUUID(), version: 0 },
    settingContent: content,
    story: content.story,
    setup: content.setup,
    people: [],
    facts: [],
    events: [],
    assets: [],
    portraitAssetId: null,
  });
  let calls = 0;
  const result = await new WorldPlanner(
    {
      async complete(messages) {
        calls++;
        const input = JSON.parse(messages[1]!.content);
        if (calls === 1)
          return JSON.stringify({
            messages: [{ actorKey: input.openingKey, text: '场地等你来定。' }],
            notes: [{ title: '待定', text: '先核对场地' }],
          });
        return JSON.stringify({
          groups: input.cast.map((a: { actorIndex: number }) => ({
            actorIndex: a.actorIndex,
            messages: [{ text: '上周看的场地我又核对了一遍。', minutesBeforeStart: 2880 }],
          })),
        });
      },
    },
    { historyEnabled: true, historyMode: 'two-step' },
  ).propose(trial, undefined, at);
  assert.equal(calls, 2);
  assert.equal(result.actors.length, content.characters.length);
  assert.equal(result.messageHistory!.messages.length, content.characters.length);
  assert.deepEqual(
    result.actors.map((a) => a.name),
    content.characters.map((c) => c.name),
  );
});
test('abort between phases prevents history request and abort after history prevents successful return', async () => {
  for (const phase of [1, 2]) {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
      new WorldPlanner(
        {
          async complete() {
            calls++;
            if (calls === phase)
              controller.abort(Object.assign(Error('cancelled'), { code: 'CANCELLED' }));
            return JSON.stringify(calls === 1 ? opening : valid);
          },
        },
        { historyEnabled: true, historyMode: 'two-step' },
      ).propose(seed, controller.signal, at),
      { code: 'CANCELLED' },
    );
    assert.equal(calls, phase);
  }
});

test('explicit actor indices preserve attribution when groups arrive reordered, including identical names', async () => {
  const same = { ...opening, actors: opening.actors.map((a) => ({ ...a, name: '同名' })) };
  const reversed = {
    groups: [...valid.groups].reverse().map((g) => ({
      ...g,
      messages: [{ ...g.messages[0], text: '人物' + g.actorIndex + '自己的旧来信' }],
    })),
  };
  const history = await new HistoryPlanner({
    async complete() {
      return JSON.stringify(reversed);
    },
  }).propose(same, at);
  for (const m of history.messages)
    assert.equal(
      m.text,
      '人物' + opening.actors.findIndex((a) => a.key === m.actorKey) + '自己的旧来信',
    );
});

test('only explicit authorized branch relationships can enter historical cast', async () => {
  await new HistoryPlanner({
    async complete(messages) {
      const input = JSON.parse(messages[1]!.content);
      assert.deepEqual(
        input.cast.map((a: { relationship: string }) => a.relationship),
        ['搭档', '', ''],
      );
      return JSON.stringify(valid);
    },
  }).propose(opening, at, undefined, new Map([['a', '搭档']]));
});

test('native cancellation and timeout arriving after provider completion retain unknown-safe codes without retry', async () => {
  for (const name of ['AbortError', 'TimeoutError'])
    for (const phase of [1, 2]) {
      const controller = new AbortController();
      let calls = 0;
      await assert.rejects(
        new WorldPlanner(
          {
            async complete() {
              calls++;
              if (calls === phase) controller.abort(new DOMException('native late signal', name));
              return JSON.stringify(calls === 1 ? opening : valid);
            },
          },
          { historyEnabled: true, historyMode: 'two-step' },
        ).propose(seed, controller.signal, at),
        { code: name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED' },
      );
      assert.equal(calls, phase);
    }
});
