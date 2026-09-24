import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOne, type WorkerQueue } from '../src/modules/tasks/application/run-worker.ts';
import type { TaskLease, TaskOutcome } from '../src/modules/tasks/domain/types.ts';

const lease = {
  id: 'task-1',
  kind: 'media',
  ownerId: 'owner-1',
  scopeId: 'media-1',
  input: {},
  attempts: 0,
} as unknown as TaskLease;

function queueWith(outcomes: TaskOutcome[]): WorkerQueue {
  return {
    claim: async () => lease,
    renew: async () => true,
    finish: async (_task, outcome) => {
      outcomes.push(outcome);
    },
  };
}

test('a handler that knows its own reason keeps that error code', async () => {
  const outcomes: TaskOutcome[] = [];
  await runOne(queueWith(outcomes), {
    media: async () => {
      throw Object.assign(Error('media adapter 未接入'), { code: 'UNAVAILABLE' });
    },
  });
  assert.equal(outcomes[0]!.status, 'failed');
  /* Reporting this as AI_FAILED would blame a model that was never called. */
  assert.equal(outcomes[0]!.errorCode, 'UNAVAILABLE');
});

test('an unclassified handler failure is reported as a model failure', async () => {
  const outcomes: TaskOutcome[] = [];
  await runOne(queueWith(outcomes), {
    media: async () => {
      throw Error('boom');
    },
  });
  assert.equal(outcomes[0]!.status, 'failed');
  assert.equal(outcomes[0]!.errorCode, 'AI_FAILED');
});

test('a cancelled handler is unknown, never a silent failure', async () => {
  const outcomes: TaskOutcome[] = [];
  await runOne(queueWith(outcomes), {
    media: async () => {
      throw Object.assign(Error('cancelled'), { code: 'CANCELLED' });
    },
  });
  assert.equal(outcomes[0]!.status, 'unknown');
  assert.equal(outcomes[0]!.errorCode, 'UNKNOWN');
});
