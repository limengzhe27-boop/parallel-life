import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryWorkerLane } from '../src/modules/tasks/application/memory-worker-lane.ts';
import { runOne } from '../src/modules/tasks/application/run-worker.ts';

test('one memory model can wait while foreground task finishes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let start!: () => void;
  const ready = new Promise<void>((r) => (start = r));
  let claims = 0,
    foreground = false;
  const lane = memoryWorkerLane(async () => {
    start();
    await gate;
  });
  const queue = {
    claim: async (kinds: string[]) => {
      if (kinds[0] === 'memory') claims++;
      return { id: 't', ownerId: 'o', scopeId: 's', kind: kinds[0]!, input: {}, token: 'token' };
    },
    renew: async () => true,
    finish: async () => {},
  };
  lane.tick(queue);
  await ready;
  lane.tick(queue);
  await runOne(queue, {
    world: async () => {
      foreground = true;
    },
  });
  assert.equal(claims, 1);
  assert.equal(foreground, true);
  release();
  await lane.close();
});

test('summary replaces only supplied old prose, preserving recent and task evidence', async () => {
  const { summaryReplacedMessages } =
    await import('../src/modules/memory/infrastructure/conversation-summary.ts');
  const record = {
    id: 'm',
    status: 'active',
    sourceType: 'conversation_summary',
    sourceIds: ['old', 'recent', 'task'],
  } as any;
  assert.deepEqual(
    [...summaryReplacedMessages([record], new Set(['m']), new Set(['recent', 'task']))],
    ['old'],
  );
  assert.equal(summaryReplacedMessages([record], new Set(), new Set()).size, 0);
  assert.equal(
    summaryReplacedMessages([{ ...record, status: 'forgotten' }], new Set(['m']), new Set()).size,
    0,
  );
});
