import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorldPlanner, WORLD_OPENING_MAX_TOKENS } from '../src/modules/world/infrastructure/world-planner.ts';
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
  assert.equal(requestedCap, WORLD_OPENING_MAX_TOKENS);
  assert.equal(requestedCap! > 4096, true);
  assert.deepEqual(Object.keys(JSON.parse(sent)), ['story', 'facts', 'people']);
  assert.equal(sent.includes(seed.id), false);
  for (const invalid of [
    { ...output, messages: [{ actorKey: 'outsider', text: 'hello' }] },
    { ...output, actors: [output.actors[0], output.actors[0], output.actors[2]] },
    { ...output, messages: [] },
  ]) {
    await assert.rejects(
      new WorldPlanner({
        async complete() {
          return JSON.stringify(invalid);
        },
      }).propose(seed),
      { code: 'INVALID_RESPONSE' },
    );
  }
});
