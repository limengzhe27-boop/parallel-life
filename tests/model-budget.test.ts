import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel, DEFAULT_MAX_TOKENS } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
import { DiscoveryPlanner, DISCOVERY_MAX_TOKENS } from '../src/modules/discovery/infrastructure/discovery-planner.ts';

const config = {
  apiKey: 'test-only-secret',
  model: 'test-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};

test('a length-capped reply is reported as truncated, never as a usable answer', async () => {
  const request: typeof fetch = async () =>
    Response.json({
      choices: [{ message: { content: '{"directions":[{"title":"如果…' }, finish_reason: 'length' }],
    });
  await assert.rejects(
    new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]),
    { code: 'TRUNCATED' },
  );
});

test('the output cap is per call, bounded, and defaults to the chat-sized limit', async () => {
  const caps: number[] = [];
  const request: typeof fetch = async (_url, init) => {
    caps.push(JSON.parse(String(init?.body)).max_tokens);
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const model = new YibuTextModel(config, request);
  await model.complete([{ role: 'user', content: 'hi' }]);
  await model.complete([{ role: 'user', content: 'hi' }], undefined, 8192);
  assert.deepEqual(caps, [DEFAULT_MAX_TOKENS, 8192]);
  for (const invalid of [0, 255, 16001, 1.5]) {
    await assert.rejects(model.complete([{ role: 'user', content: 'hi' }], undefined, invalid), {
      code: 'INVALID_CONFIG',
    });
  }
});

test('long structured planners ask for a larger cap than a chat reply', async () => {
  let requested: number | undefined;
  const planner = new DiscoveryPlanner({
    async complete(_messages, _signal, maxTokens) {
      requested = maxTokens;
      return JSON.stringify({
        directions: [1, 2, 3].map((n) => ({
          title: '如果方向' + n,
          premise: '改变' + n,
          opening: '开场' + n,
          tradeoff: '取舍' + n,
          reason: '依据' + n,
          sourceFactIds: [],
        })),
      });
    },
  });
  await planner.propose({
    kind: 'discovery',
    profileId: '10000000-0000-4000-8000-000000000001',
    expectedVersion: 0,
    profileVersion: 1,
    basis: [],
    brief: '想做点别的',
    basedOn: null,
  });
  assert.equal(requested, DISCOVERY_MAX_TOKENS);
  assert.equal(requested! > DEFAULT_MAX_TOKENS, true);
});
