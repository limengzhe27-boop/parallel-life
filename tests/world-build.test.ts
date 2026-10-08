import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  WorldPlanner,
  WORLD_OPENING_MAX_TOKENS,
  WORLD_OUTPUT_ATTEMPTS,
} from '../src/modules/world/infrastructure/world-planner.ts';
import {
  openingMessageAt,
  openingMessagesForDisplay,
} from '../src/modules/world/domain/opening-time.ts';
import type { ApprovedSeed } from '../src/contracts/seeds.ts';
const seed: ApprovedSeed = {
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  profileVersion: 1,
  discoveryVersion: 1,
  directionId: randomUUID(),
  story: {
    title: '如果开一间维修铺',
    premise: '学习修车',
    opening: '街角的新一天',
    tradeoff: '收入不稳定',
  },
  facts: [],
  people: [],
  portraitAssetId: null,
  assets: [],
};
const output = {
  identity: '修车店主',
  setting: '小城的早晨',
  actors: ['a', 'b', 'c'].map((key) => ({
    key,
    name: key,
    relationship: '邻居',
    persona: '各有自己的生活',
  })),
  actorTies: [{ fromKey: 'a', toKey: 'b', relationship: '同一家维修铺工作', mayShare: true }],
  messages: [{ actorKey: 'a', text: '早，能帮我看看自行车吗？' }],
  notes: [{ title: '开店前', text: '先检查工具' }],
};
test('world planner only sends selected seed fields and refuses unknown or duplicate actors', async () => {
  let sent = '';
  let requestedCap: number | undefined;
  const planner = new WorldPlanner({
    async complete(messages, _signal, maxTokens) {
      sent = messages[1]!.content;
      requestedCap = maxTokens;
      return JSON.stringify(output);
    },
  });
  const result = await planner.propose(seed);
  assert.equal(result.actors.length, 3);
  assert.deepEqual(result.actorTies, output.actorTies);
  assert.equal(requestedCap, WORLD_OPENING_MAX_TOKENS);
  assert.equal(requestedCap! > 4096, true);
  assert.deepEqual(Object.keys(JSON.parse(sent)), ['story', 'setup', 'facts', 'events', 'people']);
  assert.deepEqual(JSON.parse(sent).setup, { identity: '', place: '', tone: '' });
  assert.deepEqual(JSON.parse(sent).events, []);
  assert.equal(sent.includes(seed.id), false);
  for (const invalid of [
    { ...output, actors: output.actors.slice(0, 2) },
    { ...output, messages: [{ actorKey: 'outsider', text: 'hello' }] },
    {
      ...output,
      actorTies: [{ fromKey: 'a', toKey: 'outsider', relationship: '朋友', mayShare: true }],
    },
    { ...output, actorTies: [{ fromKey: 'a', toKey: 'a', relationship: '朋友', mayShare: true }] },
    {
      ...output,
      actorTies: [{ fromKey: 'a', toKey: 'b', relationship: '知道你爸最近在复查', mayShare: true }],
    },
    { ...output, actors: [output.actors[0], output.actors[0], output.actors[2]] },
    { ...output, messages: [] },
    { ...output, messages: [{ actorKey: 'a', text: '我听着心里有点堵。'.repeat(20) }] },
  ]) {
    let calls = 0;
    await assert.rejects(
      new WorldPlanner({
        async complete() {
          calls += 1;
          return JSON.stringify(invalid);
        },
      }).propose(seed),
      { code: 'INVALID_RESPONSE' },
    );
    // One corrective retry, never an unbounded loop.
    assert.equal(calls, WORLD_OUTPUT_ATTEMPTS);
  }
});

test('opening notifications preserve conversational order and predate the world clock', () => {
  const now = '2026-09-28T12:00:00.000Z';
  const times = Array.from({ length: 4 }, (_, index) => openingMessageAt(now, index, 4));
  assert.deepEqual(times, [
    '2026-09-28T10:20:00.000Z',
    '2026-09-28T11:25:00.000Z',
    '2026-09-28T11:48:00.000Z',
    '2026-09-28T11:55:00.000Z',
  ]);
  assert.ok(
    times.every(
      (time, index) =>
        Date.parse(time) < Date.parse(now) &&
        (index === 0 || Date.parse(time) > Date.parse(times[index - 1]!)),
    ),
  );
});

test('only an old all-equal genesis batch gets reconstructed for display', () => {
  const now = '2026-09-28T12:00:00.000Z';
  const messages = ['one', 'two', 'three'].map((id) => ({
    id,
    actorId: id,
    role: 'assistant' as const,
    text: id,
    at: now,
    sourceEventId: 'genesis:world',
  }));
  const fixed = openingMessagesForDisplay(messages, 'world', now);
  assert.deepEqual(
    fixed.map((message) => message.at),
    ['2026-09-28T11:25:00.000Z', '2026-09-28T11:48:00.000Z', '2026-09-28T11:55:00.000Z'],
  );
  assert.deepEqual(
    messages.map((message) => message.at),
    [now, now, now],
  );
  assert.deepEqual(
    openingMessagesForDisplay([{ ...messages[0]!, role: 'user' }, messages[1]!], 'world', now),
    [{ ...messages[0]!, role: 'user' }, messages[1]!],
  );
  assert.deepEqual(
    openingMessagesForDisplay(
      [{ ...messages[0]!, at: openingMessageAt(now, 0, 2) }, messages[1]!],
      'world',
      now,
    ),
    [{ ...messages[0]!, at: openingMessageAt(now, 0, 2) }, messages[1]!],
  );
});

test('selected identity is exact and the world opening must use the selected place', async () => {
  let calls = 0;
  let sent = '';
  const planner = new WorldPlanner({
    async complete(messages) {
      calls += 1;
      sent = messages[1]!.content;
      return JSON.stringify({
        ...output,
        identity: '模型猜测的别的职业',
        setting: calls === 1 ? '上海的早晨' : '杭州的早晨',
      });
    },
  });
  const chosen = { identity: '独立电影导演', place: '杭州', tone: '热闹但不总是顺利' };
  const result = await planner.propose({ ...seed, setup: chosen });
  assert.equal(calls, 2);
  assert.equal(result.identity, chosen.identity);
  assert.match(result.setting, /杭州/);
  assert.deepEqual(JSON.parse(sent).setup, chosen);
  await assert.rejects(
    new WorldPlanner({
      async complete() {
        return JSON.stringify({ ...output, setting: '上海的早晨' });
      },
    }).propose({ ...seed, setup: chosen }),
    { code: 'INVALID_RESPONSE' },
  );
});

test('an unusable structure is retried once with a correction, and a good retry wins', async () => {
  const sent: string[] = [];
  const planner = new WorldPlanner({
    async complete(messages) {
      sent.push(messages.at(-1)!.content);
      return sent.length === 1
        ? JSON.stringify({ ...output, messages: [{ actorKey: 'outsider', text: 'hello' }] })
        : JSON.stringify(output);
    },
  });
  const result = await planner.propose(seed);
  assert.equal(result.actors.length, 3);
  assert.equal(sent.length, WORLD_OUTPUT_ATTEMPTS);
  assert.match(sent[1]!, /上一次输出没有被接受/);
});

test('an uncertain outcome is never retried by the planner', async () => {
  let calls = 0;
  await assert.rejects(
    new WorldPlanner({
      async complete() {
        calls += 1;
        throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });
      },
    }).propose(seed),
    { code: 'TIMEOUT' },
  );
  assert.equal(calls, 1);
});

test('setting trials keep the exact authored cast and ties without sending future outcomes or private IDs', async () => {
  const { settingContent } = await import('./fixtures/life-setting.ts');
  const { ApprovedSeedSchema } = await import('../src/contracts/seeds.ts');
  const content = settingContent();
  content.relationships[0]!.disclosure = 'never';
  const trial = ApprovedSeedSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    source: { kind: 'setting_draft', draftId: randomUUID(), version: 0 },
    settingContent: content,
    story: content.story,
    setup: content.setup,
    facts: [],
    events: [],
    people: [],
    assets: [],
    portraitAssetId: null,
  });
  let sent = '';
  const generated = {
    messages: [{ actorKey: 'c_0', text: '两个场地都问好了，你先看看？' }],
    notes: [{ title: '场地', text: '今晚对比两个方案' }],
  };
  const result = await new WorldPlanner({
    async complete(messages) {
      sent = messages[1]!.content;
      return JSON.stringify(generated);
    },
  }).propose(trial);
  assert.deepEqual(
    result.actors.map((a) => a.name),
    content.characters.map((c) => c.name),
  );
  assert.equal(result.actors.length, 2);
  assert.equal(result.actorTies?.[0]?.mayShare, false);
  assert.equal(result.identity, content.setup.identity);
  assert.equal(result.setting.includes(content.setup.place), true);
  assert.equal(sent.includes(trial.id), false);
  assert.equal(sent.includes(content.threads[0]!.possibleOutcomes[0]!), false);
  assert.equal(result.actors[0]!.persona.includes(content.characters[0]!.desire), true);
  for (const invalid of [
    { ...generated, messages: [{ actorKey: 'outsider', text: 'hi' }] },
    { ...generated, messages: [{ actorKey: 'c_1', text: '抢先开场' }] },
    { ...generated, actors: [] },
  ]) {
    await assert.rejects(
      new WorldPlanner({
        async complete() {
          return JSON.stringify(invalid);
        },
      }).propose(trial),
      { code: 'INVALID_RESPONSE' },
    );
  }
  assert.equal(
    ApprovedSeedSchema.safeParse({ ...trial, directionId: randomUUID() }).success,
    false,
  );
  assert.equal(
    ApprovedSeedSchema.safeParse({
      ...trial,
      people: [{ id: randomUUID(), name: '私人关系', relationship: '朋友', assetId: null }],
    }).success,
    false,
  );
  assert.equal(
    ApprovedSeedSchema.safeParse({ ...trial, story: { ...trial.story, title: '换成其他起点' } })
      .success,
    false,
  );
});

test('authored seven-person casts preserve long IDs, names and all 28 directed ties', async () => {
  const { settingContent } = await import('./fixtures/life-setting.ts');
  const { ApprovedSeedSchema } = await import('../src/contracts/seeds.ts');
  const content = settingContent();
  content.characters = Array.from({ length: 7 }, (_, i) => ({
    id: `character-${i}-with-long-local-key`,
    name: `角色${i}` + '长'.repeat(45),
    role: '合作者',
    desire: '完成自己的作品',
    voice: '简洁',
  }));
  content.relationships = [];
  for (let i = 0; i < 7 && content.relationships.length < 28; i++)
    for (let j = 0; j < 7 && content.relationships.length < 28; j++)
      if (i !== j)
        content.relationships.push({
          fromId: content.characters[i]!.id,
          toId: content.characters[j]!.id,
          context: '共事'.repeat(25),
          disclosure: 'never',
        });
  content.openingCharacterId = content.characters[0]!.id;
  content.threads[0]!.involvedCharacterIds = content.characters.map((c) => c.id);
  const trial = ApprovedSeedSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    source: { kind: 'setting_draft', draftId: randomUUID(), version: 0 },
    settingContent: content,
    story: content.story,
    setup: content.setup,
    facts: [],
    events: [],
    people: [],
    assets: [],
    portraitAssetId: null,
  });
  const opening = await new WorldPlanner({
    async complete() {
      return JSON.stringify({
        messages: [{ actorKey: 'c_0', text: '场地已经问好了' }],
        notes: [{ title: '场地', text: '预算待定' }],
      });
    },
  }).propose(trial);
  assert.equal(opening.actors.length, 7);
  assert.equal(opening.actorTies!.length, 28);
  assert.deepEqual(
    opening.actors.map((c) => c.name),
    content.characters.map((c) => c.name),
  );
  assert.equal(opening.actorTies![0]!.relationship, content.relationships[0]!.context);
  assert.ok(opening.actors.every((c) => /^c_[0-6]$/.test(c.key)));
});

test('personal worlds without selected people never prompt for placeholder person IDs', async () => {
  let calls = 0;
  const result = await new WorldPlanner({
    async complete(messages) {
      calls++;
      assert.doesNotMatch(messages[0]!.content, /"sourcePersonId":"所选人物/);
      assert.match(messages[0]!.content, /全部省略sourcePersonId/);
      return JSON.stringify(output);
    },
  }).propose({ ...seed, people: [], personRoles: [] });
  assert.equal(result.actors.length, 3);
  assert.equal(calls, 1);
});

test('world correction identifies rejected actor ties and keeps their privacy guard', async () => {
  let calls = 0;
  await new WorldPlanner({
    async complete(messages) {
      calls++;
      if (calls === 1)
        return JSON.stringify({
          ...output,
          actorTies: [{ fromKey: 'a', toKey: 'b', relationship: '你的两个朋友', mayShare: true }],
        });
      assert.match(messages[2]!.content, /INVALID_ACTOR/);
      return JSON.stringify(output);
    },
  }).propose(seed);
  assert.equal(calls, 2);
});

test('phone choice and next-step IDs accept exact persisted event-effect IDs and reject arbitrary strings', async () => {
  const { WorldPhoneSchema } = await import('../src/contracts/world-build.ts');
  const eventId = randomUUID();
  const choice = {
    id: `${eventId}_effect_1`,
    actorId: randomUUID(),
    quote: '我决定检查前后轮',
    intent: '检查前后轮',
    at: '2026-10-08T00:00:00.000Z',
    sourceEventId: eventId,
    status: 'followed_up',
    nextStep: {
      quote: '先转动前后轮',
      at: '2026-10-08T01:00:00.000Z',
      sourceEventId: randomUUID(),
      sourceMessageId: `${randomUUID()}_effect_0`,
    },
  };
  const phone = {
    id: randomUUID(),
    seedId: randomUUID(),
    title: '合成维修铺',
    time: '2026-10-08T01:00:00.000Z',
    identity: '店主',
    setting: '街角',
    actors: [],
    messages: [],
    notes: [],
    choices: [choice],
  };
  assert.equal(WorldPhoneSchema.parse(phone).choices![0]!.id, choice.id);
  assert(
    WorldPhoneSchema.safeParse({ ...phone, choices: [{ ...choice, id: randomUUID() }] }).success,
  );
  for (const id of [
    'arbitrary',
    `${eventId}_effect_10000`,
    `${eventId}_effect_01`,
    `${eventId}_effect_0_extra`,
    `invalid-event_effect_0`,
  ])
    assert.equal(
      WorldPhoneSchema.safeParse({ ...phone, choices: [{ ...choice, id }] }).success,
      false,
    );
  assert.equal(
    WorldPhoneSchema.safeParse({
      ...phone,
      choices: [{ ...choice, nextStep: { ...choice.nextStep, sourceMessageId: 'arbitrary' } }],
    }).success,
    false,
  );
});
