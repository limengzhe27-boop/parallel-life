import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOne } from '../src/modules/tasks/application/run-worker.ts';
import type { TaskOutcome } from '../src/modules/tasks/domain/types.ts';
test('a timed-out generation is unknown and is not retried automatically', async () => {
  let claims = 0,
    calls = 0;
  const results: TaskOutcome[] = [];
  const queue = {
    async claim() {
      claims++;
      return claims === 1
        ? {
            id: 'task',
            ownerId: 'owner',
            kind: 'interview',
            scopeId: 'scope',
            input: {},
            token: 'token',
          }
        : null;
    },
    async renew() {
      return true;
    },
    async finish(_task: unknown, result: TaskOutcome) {
      results.push(result);
    },
  };
  const handlers = {
    interview: async () => {
      calls++;
      throw { code: 'TIMEOUT' };
    },
  };
  await runOne(queue, handlers);
  await runOne(queue, handlers);
  assert.equal(calls, 1);
  assert.equal(results[0]?.status, 'unknown');
});
