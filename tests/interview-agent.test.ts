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
  assert.equal(extractBasicInfoFromText('2001年出生的').birthdate, '2001');
  
  // 完整年月日
  assert.equal(extractBasicInfoFromText('我是1998年5月12日出生的').birthdate, '1998-05-12');
  assert.equal(extractBasicInfoFromText('01年5月12日').birthdate, '2001-05-12');

  // 称呼与城市
  assert.equal(extractBasicInfoFromText('叫我阿哲就好，生活在上海').name, '阿哲');
  assert.equal(extractBasicInfoFromText('叫我阿哲就好，生活在上海').location, '上海');
});
