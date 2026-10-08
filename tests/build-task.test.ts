import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryBuildTask } from '../src/features/discovery/build-task.ts';
import type { Task } from '../src/contracts/api.ts';
test('explicit build retry executes the replacement task after refreshing, never the failed task', async () => {
  const sequence: string[] = [];
  const replacement = { id: 'replacement', status: 'queued' } as Task;
  const result = await retryBuildTask(
    {
      async retryTask(id, command) {
        sequence.push(`retry:${id}:${command}`);
        return replacement;
      },
      async task(id) {
        sequence.push(`run:${id}`);
        return { ...replacement, status: 'succeeded' };
      },
    },
    'failed',
    'same-command',
    async () => {
      sequence.push('refresh');
    },
  );
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(sequence, ['retry:failed:same-command', 'refresh', 'run:replacement']);
});
test('a retry with an uncertain request outcome cannot trigger another task execution', async () => {
  let runs = 0;
  await assert.rejects(
    retryBuildTask(
      {
        async retryTask() {
          throw Error('NETWORK_ERROR');
        },
        async task() {
          runs++;
          throw Error('unexpected');
        },
      },
      'failed',
      'stable-command',
      async () => {},
    ),
    /NETWORK_ERROR/,
  );
  assert.equal(runs, 0);
});
test('a replayed terminal retry receipt is not executed again', async () => {
  let runs = 0;
  const done = { id: 'replacement', status: 'succeeded' } as Task;
  assert.equal(
    (
      await retryBuildTask(
        {
          async retryTask() {
            return done;
          },
          async task() {
            runs++;
            return done;
          },
        },
        'failed',
        'same-command',
        async () => {},
      )
    ).status,
    'succeeded',
  );
  assert.equal(runs, 0);
});
