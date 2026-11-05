import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runProactiveScheduler,
  proactiveTickPolicy,
  proactiveClaimParameters,
} from '../src/modules/world/application/run-proactive-scheduler.ts';
import {
  localProactivePolicy,
  runLocalProactiveLoop,
} from '../scripts/local-proactive-worker-policy.mjs';

test('bounded tick passes remaining capacity, shares cron/worker defaults and isolates world failures', async () => {
  const limits: number[] = [],
    seen: string[] = [];
  let next = 0;
  const result = await runProactiveScheduler(
    {
      claimProactive: async (limit = 2) => {
        limits.push(limit);
        return Array.from({ length: limit }, () => ({ ownerId: 'o', worldId: String(next++) }));
      },
    },
    async (_owner, id) => {
      seen.push(id);
      return { played: 1 };
    },
    { maxWorlds: 3, maxElapsedMs: 1000 },
  );
  assert.deepEqual(limits, [2, 1]);
  assert.deepEqual(seen, ['0', '1', '2']);
  assert.deepEqual(result, { claimed: 3, advanced: 3, messages: 3, failed: 0 });
  assert.deepEqual(proactiveTickPolicy(), { maxWorlds: 50, maxElapsedMs: 240000 });
  assert.deepEqual(proactiveClaimParameters(), [2, 180, 60]);
  assert.deepEqual(
    proactiveClaimParameters(1, { cooldownSeconds: 60, leaseSeconds: 60 }),
    [1, 60, 60],
  );
  assert.throws(() => proactiveTickPolicy({ maxWorlds: 0 }));
  assert.throws(() => proactiveClaimParameters(3));
  assert.throws(() => localProactivePolicy({ checkEveryMs: 1000 }));
  assert.deepEqual(localProactivePolicy(), {
    checkEveryMs: 15000,
    maxWorlds: 2,
    cooldownSeconds: 180,
    leaseSeconds: 60,
    maxElapsedMs: 15000,
  });
});

test('local loop never overlaps a long tick, stops starting new work and lets paid work drain', async () => {
  const stop = new AbortController();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0,
    completed = 0,
    sleeps = 0,
    unrelatedTaskCompleted = false;
  const running = runLocalProactiveLoop({
    shutdown: stop.signal,
    tick: async () => {
      calls++;
      started();
      await gate;
      return { played: 1 };
    },
    sleep: async () => {
      sleeps++;
    },
    onResult: async () => {
      completed++;
    },
  });
  await entered;
  await Promise.resolve().then(() => {
    unrelatedTaskCompleted = true;
  });
  stop.abort();
  assert.equal(calls, 1);
  assert.equal(completed, 0);
  assert.equal(unrelatedTaskCompleted, true);
  release();
  assert.deepEqual(await running, { ticks: 1 });
  assert.equal(completed, 1);
  assert.equal(sleeps, 0);
});
