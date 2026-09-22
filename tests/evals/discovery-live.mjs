// Explicit paid evaluation, using synthetic confirmed profiles only.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import { DiscoveryPlanner } from '../../src/modules/discovery/infrastructure/discovery-planner.ts';
if (!process.argv.includes('--live'))
  throw Error('Pass --live for two paid synthetic evaluations.');
const upstream = new YibuTextModel({
  apiKey: process.env.YIBU_API_KEY,
  baseUrl: process.env.YIBU_BASE_URL,
  model: process.env.YIBU_TEXT_MODEL,
  timeoutMs: 85000,
});
const planner = new DiscoveryPlanner({
  async complete(messages, signal) {
    const raw = await upstream.complete(messages, signal);
    await writeFile('.local/discovery-model-raw.json', raw, { mode: 0o600 });
    return raw;
  },
});
const results = [];
for (const facts of [
  [
    { category: 'interest', value: '喜欢摄影和旅行' },
    { category: 'wish', value: '想在海边体验慢生活' },
  ],
  [
    { category: 'interest', value: '喜欢维修自行车和机械旧物' },
    { category: 'wish', value: '希望在西安开自己的维修店，不想旅行或拍电影' },
  ],
]) {
  const basis = facts.map((f) => ({ ...f, factId: randomUUID() }));
  const start = Date.now();
  const directions = await planner.propose({
    kind: 'discovery',
    profileId: randomUUID(),
    expectedVersion: 0,
    profileVersion: 1,
    basis,
    brief: '',
    basedOn: null,
  });
  assert.equal(directions.length, 3);
  assert.ok(directions.every((d) => d.sources.length > 0));
  results.push({ durationMs: Date.now() - start, directions });
  console.log({
    case: results.length,
    durationMs: Date.now() - start,
    titles: directions.map((d) => d.title),
  });
}
assert.notDeepEqual(
  results[0].directions.map((d) => d.title),
  results[1].directions.map((d) => d.title),
);
await writeFile('.local/discovery-live.json', JSON.stringify(results, null, 2), { mode: 0o600 });
