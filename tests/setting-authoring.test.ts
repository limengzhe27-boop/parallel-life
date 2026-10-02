import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthoringPlanner,
  AuthoringInputSchema,
} from '../src/modules/settings/infrastructure/authoring-planner.ts';
import { LifeSettingContentSchema } from '../src/contracts/life-settings.ts';
import { settingContent } from './fixtures/life-setting.ts';

const content = () => LifeSettingContentSchema.parse(settingContent());
const answer = (proposal: unknown = null) => ({
  reply: '可以先从一个具体身份开始。',
  question: proposal ? null : '你希望玩家成为谁？',
  proposal,
});
const returning = (output: unknown) =>
  new AuthoringPlanner({
    async complete() {
      return JSON.stringify(output);
    },
  });

test('authoring sends only isolated creative input and supports one clarification without a draft', async () => {
  const input = { brief: '我想写另一种人生' };
  let calls = 0;
  const output = await new AuthoringPlanner({
    async complete(messages) {
      calls++;
      assert.equal(messages.length, 2);
      assert.equal(messages[0]!.role, 'system');
      assert.deepEqual(JSON.parse(messages[1]!.content), input);
      return JSON.stringify(answer());
    },
  }).propose(input);
  assert.equal(calls, 1);
  assert.equal(output.proposal, null);
  assert.equal(output.question, '你希望玩家成为谁？');
});

test('a complete valid setting is returned as a proposal and does not mutate its input', async () => {
  const current = content();
  const before = JSON.stringify(current);
  const proposal = { ...current, story: { ...current.story, title: '换一个片名' } };
  const output = await returning(answer(proposal)).propose({
    brief: '改个片名',
    currentSetting: current,
  });
  assert.deepEqual(output.proposal, proposal);
  assert.equal(JSON.stringify(current), before);
});

test('private inputs and extra authority fields are rejected rather than stripped', async () => {
  let calls = 0;
  const planner = new AuthoringPlanner({
    async complete() {
      calls++;
      return JSON.stringify(answer());
    },
  });
  for (const key of ['ownerId', 'profile', 'interview', 'world']) {
    const input = { brief: '创作', [key]: 'private' };
    assert.equal(AuthoringInputSchema.safeParse(input).success, false);
    await assert.rejects(planner.propose(input));
  }
  assert.equal(calls, 0);
  for (const invalid of [
    { ...answer(), published: true },
    { ...answer(), question: ['谁？', '哪里？'] },
    answer({ ...content(), permissions: ['publish'] }),
    answer({ ...content(), openingCharacterId: 'missing' }),
  ])
    await assert.rejects(returning(invalid).propose({ brief: '创作' }), {
      code: 'INVALID_RESPONSE',
    });
});

test('sources must be unchanged input sources; a known URL does not authorize invented claims', async () => {
  const current = content();
  current.sources = [{ id: 'book', title: '作者提供的参考', url: 'https://example.org/reference' }];
  current.contextNotes = [
    { text: '尚未核实的参考陈述', basis: 'source_claim', sourceIds: ['book'] },
  ];
  assert.deepEqual(
    (await returning(answer(current)).propose({ brief: '保留资料', currentSetting: current }))
      .proposal,
    current,
  );
  await assert.rejects(
    returning(answer(current)).propose({ brief: '参考 https://example.org/reference' }),
    { code: 'INVALID_RESPONSE' },
  );
  for (const changed of [
    { ...current, sources: [{ ...current.sources[0]!, url: 'https://invented.example/new' }] },
    { ...current, sources: [{ ...current.sources[0]!, title: '已经核实的史料' }] },
    { ...current, contextNotes: [{ ...current.contextNotes[0]!, text: '新编的史实' }] },
  ])
    await assert.rejects(
      returning(answer(changed)).propose({ brief: '补充', currentSetting: current }),
      { code: 'INVALID_RESPONSE' },
    );
});

test('existing real-person inspiration cannot lose its fictional framing', async () => {
  const current = {
    ...content(),
    kind: 'historical_fiction' as const,
    inspiration: { name: '李白', fictionalFraming: '历史灵感，人物对话与分岔均为虚构' },
  };
  assert.deepEqual(
    (await returning(answer(current)).propose({ brief: '继续构思', currentSetting: current }))
      .proposal,
    current,
  );
  for (const proposal of [
    { ...current, kind: 'original', inspiration: null },
    { ...current, inspiration: { ...current.inspiration, fictionalFraming: '真实传记' } },
  ])
    await assert.rejects(
      returning(answer(proposal)).propose({ brief: '改写', currentSetting: current }),
      { code: 'INVALID_RESPONSE' },
    );
});

test('model failure and cancellation never retry or return a fallback story', async () => {
  const failure = Error('MODEL_UNAVAILABLE');
  let calls = 0;
  await assert.rejects(
    new AuthoringPlanner({
      async complete() {
        calls++;
        throw failure;
      },
    }).propose({ brief: '创作' }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  calls = 0;
  const planner = new AuthoringPlanner({
    async complete() {
      calls++;
      return JSON.stringify(answer(content()));
    },
  });
  await assert.rejects(planner.propose({ brief: '创作' }, controller.signal), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);
  const during = new AbortController();
  await assert.rejects(
    new AuthoringPlanner({
      async complete(_, signal) {
        calls++;
        assert.equal(signal, during.signal);
        during.abort();
        return JSON.stringify(answer(content()));
      },
    }).propose({ brief: '创作' }, during.signal),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});
