import test from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
import { runOne, type WorkerQueue } from '../src/modules/tasks/application/run-worker.ts';
import type { TaskLease, TaskOutcome } from '../src/modules/tasks/domain/types.ts';

const config = {
  apiKey: 'private-fixture',
  model: 'test-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 25,
};
const messages = [{ role: 'user' as const, content: 'private-fixture-input' }];
const encoder = new TextEncoder();
const delta = 'data: {"choices":[{"delta":{"content":"片段"}}]}\n\n';

test('uncooperative request still times out and its late body is cancelled once', async () => {
  let release!: (response: Response) => void;
  let calls = 0,
    cancelled = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  await assert.rejects(model.complete(messages), { code: 'TIMEOUT', stage: 'request' });
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test('uncooperative response body has one total deadline and releases its lock', async () => {
  let cancelled = 0;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled++;
      },
    }),
  );
  const model = new YibuTextModel(config, async () => response);
  await assert.rejects(model.complete(messages), {
    code: 'TIMEOUT',
    stage: 'response',
    httpStatus: 200,
  });
  assert.equal(cancelled, 1);
  assert.equal(response.body!.locked, false);
});

test('consumer cancellation stops an open stream and releases the response reader', async () => {
  let cancelled = 0;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(delta));
      },
      cancel() {
        cancelled++;
      },
    }),
  );
  const model = new YibuTextModel({ ...config, timeoutMs: 1000 }, async () => response);
  for await (const token of model.streamComplete(messages)) {
    assert.equal(token, '片段');
    break;
  }
  assert.equal(cancelled, 1);
  assert.equal(response.body!.locked, false);
});

test('stream EOF without DONE remains an unknown worker outcome and is never retried', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    return new Response(delta);
  });
  let saved: TaskOutcome | undefined;
  const queue: WorkerQueue = {
    async claim() {
      return { id: 'synthetic-task', kind: 'interview' } as TaskLease;
    },
    async renew() {
      return true;
    },
    async finish(_task, outcome) {
      saved = outcome;
    },
  };
  let completed = false;
  await runOne(queue, {
    interview: async () => {
      for await (const _token of model.streamComplete(messages)) {
      }
      completed = true;
    },
  });
  assert.equal(completed, false);
  assert.equal(saved?.status, 'unknown');
  assert.equal(saved?.errorCode, 'UNKNOWN');
  assert.equal(calls, 1);
});
