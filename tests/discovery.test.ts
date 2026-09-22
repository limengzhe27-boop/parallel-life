import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DiscoveryPlanner } from '../src/modules/discovery/infrastructure/discovery-planner.ts';
import { DiscoverRequestSchema, type DiscoveryInput } from '../src/contracts/discovery.ts';
const basis = { factId: randomUUID(), category: 'interest' as const, value: '喜欢维修旧自行车' };
const input: DiscoveryInput = {
  kind: 'discovery',
  profileId: randomUUID(),
  expectedVersion: 0,
  profileVersion: 1,
  basis: [basis],
  brief: '想让老物件继续被使用',
  basedOn: null,
};
const output = (source: string | null) => ({
  directions: ['街角维修店', '流动修理车', '旧物教学工坊'].map((title) => ({
    title,
    premise: '尝试另一种生活',
    opening: '假如你在周末修好第一辆车',
    tradeoff: '自由更多，也需要面对经营压力',
    reason: '来自你对维修的兴趣',
    sourceFactIds: source ? [source] : [],
  })),
});
test('discovery keeps sourced confirmed facts, isolates context, and allocates server ids', async () => {
  const planner = new DiscoveryPlanner({
    async complete(messages) {
      assert.equal(messages.length, 2);
      const context = JSON.parse(messages[1]!.content);
      assert.deepEqual(Object.keys(context), ['basis', 'brief', 'basedOn']);
      assert.deepEqual(context.basis, [basis]);
      return JSON.stringify(output(basis.factId));
    },
  });
  const result = await planner.propose(input);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0]?.sources, [basis]);
  assert.equal(new Set(result.map((x) => x.id)).size, 3);
});
test('discovery refuses unknown, missing or duplicate evidence and repeated direction titles', async () => {
  for (const bad of [
    output(randomUUID()),
    output(null),
    { directions: Array(3).fill(output(basis.factId).directions[0]) },
  ]) {
    await assert.rejects(
      new DiscoveryPlanner({
        async complete() {
          return JSON.stringify(bad);
        },
      }).propose(input),
      { code: 'INVALID_RESPONSE' },
    );
  }
  const custom = await new DiscoveryPlanner({
    async complete() {
      return JSON.stringify(output(null));
    },
  }).propose({ ...input, basis: [], brief: '如果开一间维修工坊' });
  assert.deepEqual(custom[0]?.sources, []);
  await assert.rejects(
    new DiscoveryPlanner({
      async complete() {
        throw Error('must not call');
      },
    }).propose({ ...input, basis: [], brief: '' }),
    { code: 'INVALID_RESPONSE' },
  );
});
test('discovery request rejects caller supplied ownership, sources and invalid versions', () => {
  const request = { commandId: randomUUID(), expectedVersion: 0, expectedProfileVersion: 1 };
  assert.ok(DiscoverRequestSchema.safeParse(request).success);
  for (const extra of [
    { ownerId: randomUUID() },
    { basis: [basis] },
    { expectedProfileVersion: -1 },
  ])
    assert.equal(DiscoverRequestSchema.safeParse({ ...request, ...extra }).success, false);
});
