import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  InterviewPlanner,
  InvalidInterviewOutput,
} from '../src/modules/profile/infrastructure/interview-planner.ts';
import type { Profile, Interview } from '../src/contracts/api.ts';
const profile: Profile = {
  id: randomUUID(),
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
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
    facts: [{ category: 'wish', value: '开一家自行车维修店', sourceMessageIds: [id] }],
    events: [],
  };
  const p = new InterviewPlanner({
    async complete() {
      return JSON.stringify(output);
    },
  });
  assert.equal((await p.propose(profile, messages)).facts.length, 1);
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
