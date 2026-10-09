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

test('failure diagnostics and persisted duration use elapsed time rather than the wall clock', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  t.mock.method(Date, 'now', () => 1800000000000);
  const outcomes: TaskOutcome[] = [];
  await runOne(queueWith(outcomes), {
    media: async () => {
      throw { code: 'TIMEOUT', stage: 'request', durationMs: 37 };
    },
  });
  const log = JSON.parse(logs[0]!);
  assert.equal(log.durationMs, 37);
  assert.equal(outcomes[0]!.durationMs, 37);
  assert.equal(log.stage, 'request');
  assert.equal(log.status, 'unknown');
});
test('missing or invalid handler timing uses a bounded elapsed fallback', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  t.mock.method(Date, 'now', () => 1800000000000);
  for (const durationMs of [undefined, NaN, Infinity, -1]) {
    const outcomes: TaskOutcome[] = [];
    await runOne(queueWith(outcomes), {
      media: async () => {
        throw { code: 'TIMEOUT', durationMs, stage: 'private-stage', httpStatus: 'private-status' };
      },
    });
    const log = JSON.parse(logs.at(-1)!);
    assert(Number.isInteger(log.durationMs) && log.durationMs >= 0 && log.durationMs < 10000);
    assert.equal(log.durationMs, outcomes[0]!.durationMs);
    assert.equal(log.stage, undefined);
    assert.equal(log.httpStatus, undefined);
    assert.doesNotMatch(JSON.stringify(log), /private-/);
  }
});
