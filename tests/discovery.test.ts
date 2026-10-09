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

test('discovery accepts wrapped JSON but still validates all sources', async () => {
  let calls = 0;
  const planner = new DiscoveryPlanner({
    async complete() {
      calls++;
      return '以下是三个虚构方向：\n```json\n' + JSON.stringify(output(basis.factId)) + '\n```';
    },
  });
  assert.equal((await planner.propose(input)).length, 3);
  assert.equal(calls, 1);
});

test('discovery corrects a known invalid result once without accepting fabricated evidence', async () => {
  let calls = 0;
  const planner = new DiscoveryPlanner({
    async complete(messages) {
      calls++;
      if (calls === 1) return JSON.stringify(output(null));
      assert.equal(messages.length, 3);
      assert.match(messages[2]!.content, /MISSING_SOURCES/);
      return JSON.stringify(output(basis.factId));
    },
  });
  assert.deepEqual((await planner.propose(input))[0]!.sources, [basis]);
  assert.equal(calls, 2);
  let invalidCalls = 0;
  await assert.rejects(
    new DiscoveryPlanner({
      async complete() {
        invalidCalls++;
        return JSON.stringify(output(randomUUID()));
      },
    }).propose(input),
    { code: 'INVALID_RESPONSE', reason: 'UNKNOWN_SOURCE' },
  );
  assert.equal(invalidCalls, 2);
});

test('discovery never retries transport, cancelled, uncertain or truncated calls', async () => {
  for (const code of ['TIMEOUT', 'UPSTREAM_FAILED', 'CANCELLED', 'TRUNCATED']) {
    let calls = 0;
    const failure = Object.assign(new Error(code), { code });
    await assert.rejects(
      new DiscoveryPlanner({
        async complete() {
          calls++;
          throw failure;
        },
      }).propose(input),
      (e) => e === failure,
    );
    assert.equal(calls, 1);
  }
});

test('focused keeps the current brief even with unrelated confirmed interests and may cite no facts', async () => {
  const direction = {
    ...output(null).directions[0]!,
    title: '舞台摄影师',
    premise: '作为舞台摄影师体验一场演出',
    opening: '演出开场前调好相机',
    reason: '用户这次想体验舞台摄影师',
  };
  const planner = new DiscoveryPlanner({
    async complete(messages, _signal, _tokens, options) {
      assert.match(messages[0]!.content, /不因用户还喜欢其他事而换主线/);
      assert.equal(JSON.parse(messages[1]!.content).brief, '我想体验舞台摄影师，不开修车店');
      assert.deepEqual(options, { format: 'json_object' });
      return JSON.stringify({ directions: [direction] });
    },
  });
  const result = await planner.propose({
    ...input,
    mode: 'focused',
    brief: '我想体验舞台摄影师，不开修车店',
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.title, '舞台摄影师');
  assert.deepEqual(result[0]!.sources, []);
});

test('focused cardinality and source validation are not weakened by a one-direction response', async () => {
  for (const bad of [
    output(null),
    { directions: [{ ...output(null).directions[0]!, sourceFactIds: [randomUUID()] }] },
    {
      directions: [{ ...output(null).directions[0]!, sourceFactIds: [basis.factId, basis.factId] }],
    },
  ]) {
    await assert.rejects(
      new DiscoveryPlanner({
        async complete() {
          return JSON.stringify(bad);
        },
      }).propose({ ...input, mode: 'focused' }),
      { code: 'INVALID_RESPONSE' },
    );
  }
  await assert.rejects(
    new DiscoveryPlanner({
      async complete() {
        return JSON.stringify({ directions: [output(null).directions[0]] });
      },
    }).propose({ ...input, mode: 'focused', brief: '' }),
    { code: 'INVALID_RESPONSE', reason: 'MISSING_SOURCES' },
  );
});

test('focused known invalid output gets at most one count-aware correction; uncertain output is never retried', async () => {
  let calls = 0;
  const result = await new DiscoveryPlanner({
    async complete(messages) {
      calls++;
      if (calls === 1) return JSON.stringify(output(null));
      assert.match(messages[2]!.content, /恰好1个沿brief/);
      return JSON.stringify({ directions: [output(null).directions[0]] });
    },
  }).propose({ ...input, mode: 'focused' });
  assert.equal(result.length, 1);
  assert.equal(calls, 2);
  for (const code of ['TIMEOUT', 'UPSTREAM_FAILED', 'CANCELLED', 'TRUNCATED']) {
    let attempts = 0;
    await assert.rejects(
      new DiscoveryPlanner({
        async complete() {
          attempts++;
          throw Object.assign(Error(code), { code });
        },
      }).propose({ ...input, mode: 'focused' }),
      { code },
    );
    assert.equal(attempts, 1);
  }
});

test('explicit exploration and omitted legacy inputs still demand three directions', async () => {
  for (const mode of [undefined, 'explore' as const]) {
    const result = await new DiscoveryPlanner({
      async complete() {
        return JSON.stringify(output(basis.factId));
      },
    }).propose({ ...input, mode });
    assert.equal(result.length, 3);
    await assert.rejects(
      new DiscoveryPlanner({
        async complete() {
          return JSON.stringify({ directions: [output(basis.factId).directions[0]] });
        },
      }).propose({ ...input, mode }),
      { code: 'INVALID_RESPONSE' },
    );
  }
  assert.equal(
    DiscoverRequestSchema.safeParse({
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: 0,
      mode: 'anything',
    }).success,
    false,
  );
});

test('a related profession named only in reason cannot satisfy the literal current focus', async () => {
  const request = {
    ...input,
    mode: 'focused' as const,
    brief: '我想体验舞台摄影师，别换成其他职业',
  };
  const wrong = {
    ...output(null).directions[0]!,
    title: '舞台设计师',
    premise: '决定成为舞台设计师',
    reason: '舞台摄影师能拓展到舞台设计',
  };
  let calls = 0;
  await assert.rejects(
    new DiscoveryPlanner({
      async complete() {
        calls++;
        return JSON.stringify({ directions: [wrong] });
      },
    }).propose(request),
    { code: 'INVALID_RESPONSE', reason: 'FOCUS_MISMATCH' },
  );
  assert.equal(calls, 2);
  let corrected = 0;
  const result = await new DiscoveryPlanner({
    async complete(messages) {
      corrected++;
      if (corrected === 1) return JSON.stringify({ directions: [wrong] });
      assert.match(messages[2]!.content, /FOCUS_MISMATCH/);
      return JSON.stringify({
        directions: [{ ...wrong, title: '舞台摄影师', premise: '作为舞台摄影师跟随剧组拍摄演出' }],
      });
    },
  }).propose(request);
  assert.equal(corrected, 2);
  assert.match(result[0]!.premise, /舞台摄影师/);
});

// Exact synthetic public output: mentioning the requested identity before changing it is still drift.
test('public photographer-to-live-director drift is rejected before directions can commit', async () => {
  let calls = 0;
  await assert.rejects(
    new DiscoveryPlanner({
      async complete() {
        calls++;
        return JSON.stringify({
          directions: [
            {
              title: '如果转向现场导播',
              premise: '作为舞台摄影师，我可以改变为现场导播',
              opening: '站在导播台前调整摄像机和音频',
              tradeoff: '需要面对技术挑战',
              reason: '转向现场导播增强摄影创作',
              sourceFactIds: [],
            },
          ],
        });
      },
    }).propose({
      ...input,
      mode: 'focused',
      brief: '我现在想体验舞台摄影师，跟剧组一起拍演出的工作。不要换职业。',
    }),
    { code: 'INVALID_RESPONSE', reason: 'FOCUS_MISMATCH' },
  );
  assert.equal(calls, 2);
});
