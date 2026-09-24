import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchOutbox } from '../src/modules/tasks/application/dispatch-outbox.ts';
import type { OutboxJob } from '../src/modules/tasks/domain/outbox.ts';

const job = (over: Partial<OutboxJob> = {}): OutboxJob => ({
  id: 'job-1',
  ownerId: 'owner-1',
  worldId: 'world-1',
  eventId: 'event-1',
  status: 'queued',
  attempts: 1,
  payload: {
    id: 'job-1',
    eventId: 'event-1',
    worldId: 'world-1',
    type: 'image.generate',
    requestId: 'media-1',
    prompt: '窗外的雨',
  },
  ...over,
});

function harness(
  jobs: OutboxJob[],
  submit?: (j: OutboxJob) => Promise<{ taskId: string; duplicate: boolean }>,
) {
  const seen = { submitted: [] as string[], rejected: [] as string[] };
  return {
    seen,
    deps: {
      outbox: {
        claim: async () => jobs,
        submitted: async (j: OutboxJob) => {
          seen.submitted.push(j.id);
        },
        rejected: async (j: OutboxJob, reason: string) => {
          seen.rejected.push(`${j.id}:${reason}`);
        },
      },
      tasks: { submit: submit ?? (async () => ({ taskId: 'task-1', duplicate: false })) },
    },
  };
}

test('an image request is dispatched into a media task exactly once', async () => {
  const h = harness([job()]);
  const summary = await dispatchOutbox(h.deps);
  assert.deepEqual(summary, { claimed: 1, submitted: 1, rejected: 0 });
  assert.deepEqual(h.seen.submitted, ['job-1']);
});

test('a job type without an executor is rejected with a reason, never retried', async () => {
  const h = harness([job({ payload: { ...job().payload, type: 'video.generate' } })]);
  const summary = await dispatchOutbox(h.deps);
  assert.deepEqual(summary, { claimed: 1, submitted: 0, rejected: 1 });
  assert.deepEqual(h.seen.rejected, ['job-1:NO_EXECUTOR:video.generate']);
});

test('a payload without a request id is rejected instead of half-dispatched', async () => {
  const h = harness([job({ payload: { ...job().payload, requestId: undefined } })]);
  const summary = await dispatchOutbox(h.deps);
  assert.equal(summary.rejected, 1);
  assert.match(h.seen.rejected[0]!, /OUTBOX_MISSING_REQUEST_ID|SCOPE_MISMATCH/);
  assert.equal(h.seen.submitted.length, 0);
});

test('a queue rejection is recorded and does not stop the remaining jobs', async () => {
  const h = harness([job({ id: 'job-a' }), job({ id: 'job-b' })], async (j) => {
    if (j.id === 'job-a') throw Object.assign(Error('busy'), { code: 'BUSY' });
    return { taskId: 'task-b', duplicate: false };
  });
  const summary = await dispatchOutbox(h.deps);
  assert.deepEqual(summary, { claimed: 2, submitted: 1, rejected: 1 });
  assert.deepEqual(h.seen.rejected, ['job-a:BUSY']);
  assert.deepEqual(h.seen.submitted, ['job-b']);
});

test('an empty outbox is a no-op', async () => {
  const h = harness([]);
  assert.deepEqual(await dispatchOutbox(h.deps), { claimed: 0, submitted: 0, rejected: 0 });
});
