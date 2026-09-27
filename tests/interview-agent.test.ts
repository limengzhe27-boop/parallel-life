import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  InterviewPlanner,
  InvalidInterviewOutput,
  extractBasicInfoFromText,
} from '../src/modules/profile/infrastructure/interview-planner.ts';
import type { Profile, Interview } from '../src/contracts/api.ts';
const profile: Profile = {
  id: randomUUID(),
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  referenceAssetIds: [],
  updatedAt: new Date().toISOString(),
};
const id = randomUUID();
const messages: Interview['messages'] = [
  {
    id,
    role: 'user',
    text: '喜欢修自行车，想开自己的维修店',
    createdAt: profile.updatedAt,
    taskId: null,
  },
];
test('interview extracts only proposals with actual user message provenance', async () => {
  const output = {
    reply: '自己开一家店时，你最期待什么？',
    question: { text: '你最想先从哪一步开始？', target: 'wish' },
    facts: [{ category: 'wish', value: '开一家自行车维修店', sourceMessageIds: [id] }],
    events: [],
  };
  const p = new InterviewPlanner({
    async complete() {
      return JSON.stringify(output);
    },
  });
  const proposal = await p.propose(profile, messages);
  assert.equal(proposal.facts.length, 1);
  assert.equal(proposal.question?.target, 'wish');
  output.facts[0]!.sourceMessageIds = [randomUUID()];
  await assert.rejects(p.propose(profile, messages), InvalidInterviewOutput);
});
test('interview budget keeps latest input and does not pass unlimited history', async () => {
  const long = Array.from({ length: 200 }, () => ({
    ...messages[0]!,
    id: randomUUID(),
    text: 'x'.repeat(4000),
  }));
  const p = new InterviewPlanner({
    async complete(input) {
      assert(input.reduce((n, m) => n + m.content.length, 0) < 64000);
      assert(input[1]?.content.includes(long.at(-1)!.id));
      return JSON.stringify({ reply: '继续聊聊？', facts: [], events: [] });
    },
  });
  await p.propose(profile, long);
});

test('interview planner passes blocked topics to the model context', async () => {
  const p = new InterviewPlanner({
    async complete(input) {
      const context = input[1]?.content ?? '';
      assert.match(context, /"blockedTargets":\["relationship","wish"\]/);
      return JSON.stringify({ reply: '我们可以聊聊你最近想做的事。', facts: [], events: [] });
    },
  });
  await p.propose(profile, messages, undefined, ['relationship', 'wish']);
});

test('interview streaming exposes only the reply text, not the structured JSON envelope', async () => {
  const output = JSON.stringify({ reply: '先从你最近在意的事聊起。', facts: [], events: [] });
  const p = new InterviewPlanner({
    async complete() {
      return output;
    },
    async *streamComplete() {
      for (const chunk of output.match(/.{1,4}/gu) ?? []) yield chunk;
    },
  });
  const tokens: string[] = [];
  const proposal = await p.proposeStream(profile, messages, (token) => tokens.push(token));
  assert.equal(tokens.join(''), proposal.reply);
  assert.equal(tokens.join('').includes('"facts"'), false);
});

test('extractBasicInfoFromText correctly captures birth year, full dates, corrections and identity', () => {
  // 年份口语与纠错
  assert.equal(extractBasicInfoFromText('之前信息有误，我是01年的').birthdate, '2001');
  assert.equal(extractBasicInfoFromText('我是05年的').birthdate, '2005');
  assert.equal(extractBasicInfoFromText('其实我是98年的').birthdate, '1998');
  assert.equal(extractBasicInfoFromText('我是2001年出生的').birthdate, '2001');

  // 完整年月日
  assert.equal(extractBasicInfoFromText('我是1998年5月12日出生的').birthdate, '1998-05-12');
  assert.equal(extractBasicInfoFromText('我的生日是01年5月12日').birthdate, '2001-05-12');

  // 称呼与城市
  assert.equal(extractBasicInfoFromText('叫我阿哲就好，我生活在上海').name, '阿哲');
  assert.equal(extractBasicInfoFromText('叫我阿哲就好，我生活在上海').location, '上海');
});

test('birth dates require explicit self attribution and ignore model guesses', async () => {
  for (const text of [
    '2020年毕业',
    '我朋友1998年出生',
    '01年5月12日',
    '我在2005年搬家',
    '如果我是05年的',
    '他说“我是05年的”',
    '我是2001年2月30日出生的',
  ]) {
    assert.equal(extractBasicInfoFromText(text).birthdate, undefined, text);
    const planner = new InterviewPlanner({
      async complete() {
        return JSON.stringify({
          reply: '我听到了。',
          facts: [],
          events: [],
          basicInfo: { birthdate: '2001' },
        });
      },
    });
    const proposal = await planner.propose(profile, [{ ...messages[0]!, role: 'user', text }]);
    assert.equal(proposal.basicInfo?.birthdate, undefined, text);
  }
  assert.equal(extractBasicInfoFromText('我不是01年的，我是05年的').birthdate, '2005');
});

test('all basic fields require self attribution instead of trusting model fields', async () => {
  for (const text of [
    '我朋友，1998年出生的',
    '不是我，1998年出生的',
    '不要叫我小王',
    '我朋友的职业是导演',
    '如果我住在巴黎',
    '他说“我叫小王”',
  ]) {
    const planner = new InterviewPlanner({
      async complete() {
        return JSON.stringify({
          reply: '继续聊聊。',
          facts: [],
          events: [],
          basicInfo: {
            name: '小王',
            birthdate: '1998',
            location: '巴黎',
            occupation: '导演',
            hometown: '巴黎',
            birthTime: '12:00',
          },
        });
      },
    });
    assert.deepEqual(
      (await planner.propose(profile, [{ ...messages[0]!, role: 'user', text }])).basicInfo,
      {},
      text,
    );
  }
  assert.deepEqual(
    extractBasicInfoFromText(
      '我叫小王，我住在杭州，我的职业是导演，我的家乡是成都，我的出生时间是12:30',
    ),
    { name: '小王', location: '杭州', occupation: '导演', hometown: '成都', birthTime: '12:30' },
  );
});
