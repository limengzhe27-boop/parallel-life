// Explicit, small paid evaluation using synthetic personas. Never runs in npm test.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import {
  InterviewPlanner,
  INTERVIEW_PROMPT_VERSION,
} from '../../src/modules/profile/infrastructure/interview-planner.ts';
const planner = new InterviewPlanner(
  new YibuTextModel({
    apiKey: process.env.YIBU_API_KEY,
    baseUrl: 'https://yibuapi.com',
    model: process.env.YIBU_TEXT_MODEL || 'gpt-4o-mini',
    timeoutMs: 85000,
  }),
);
const results = [];
for (const text of [
  '我叫小林，住在杭州，做产品设计，周末喜欢摄影。2022年换工作那会儿挺迷茫，现在很想去海边住一段时间。',
  '我叫阿远，在西安修自行车，喜欢机械和老物件。我不喜欢旅行，也不想拍电影，最近最大的愿望是开自己的维修店。',
]) {
  const now = new Date().toISOString(),
    profile = {
      id: randomUUID(),
      version: 0,
      facts: [],
      events: [],
      people: [],
      portraitAssetId: null,
      updatedAt: now,
    };
  const started = Date.now();
  const output = await planner.propose(profile, [
    { id: randomUUID(), role: 'user', text, createdAt: now, taskId: null },
  ]);
  results.push({ durationMs: Date.now() - started, output });
  console.log({
    case: results.length,
    durationMs: Date.now() - started,
    facts: output.facts.length,
    events: output.events.length,
    promptVersion: INTERVIEW_PROMPT_VERSION,
  });
}
await writeFile('.local/interview-live.json', JSON.stringify(results, null, 2), { mode: 0o600 });
