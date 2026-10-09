import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
const config = {
  apiKey: 'fixture-private-key',
  model: 'fixture-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 20,
};
const messages = [{ role: 'user' as const, content: 'fixture-private-message' }];
function untilAbort(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture abort not delivered')), 1000);
    const rejectNow = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) rejectNow();
    else signal.addEventListener('abort', rejectNow, { once: true });
  });
}
test('complete timeout before response headers identifies request phase without a retry', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async (_url, init) => {
    calls++;
    return untilAbort(init!.signal!);
  });
  await assert.rejects(model.complete(messages), (error: unknown) => {
    const e = error as { code: string; stage: string; httpStatus?: number; durationMs: number };
    assert.equal(e.code, 'TIMEOUT');
    assert.equal(e.stage, 'request');
    assert.equal(e.httpStatus, undefined);
    assert(Number.isFinite(e.durationMs) && e.durationMs >= 0 && e.durationMs < 1000);
    assert.doesNotMatch(JSON.stringify(e), /fixture-private/);
    return true;
  });
  assert.equal(calls, 1);
});
test('complete timeout after headers identifies response body and HTTP status', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async (_url, init) => {
    calls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          void untilAbort(init!.signal!).catch((e) => controller.error(e));
        },
      }),
      { status: 200 },
    );
  });
  await assert.rejects(model.complete(messages), {
    code: 'TIMEOUT',
    stage: 'response',
    httpStatus: 200,
  });
  assert.equal(calls, 1);
});
test('fully received malformed envelope is a known parse failure, not uncertain transport', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    return new Response('fixture-private-provider-body: invalid JSON', { status: 200 });
  });
  await assert.rejects(model.complete(messages), (error: unknown) => {
    const e = error as { code: string; stage: string; httpStatus: number };
    assert.equal(e.code, 'INVALID_RESPONSE');
    assert.equal(e.stage, 'parse');
    assert.equal(e.httpStatus, 200);
    assert.doesNotMatch(JSON.stringify(e), /fixture-private/);
    return true;
  });
  assert.equal(calls, 1);
});
test('HTTP rejection and received truncated completion retain distinct safe diagnostics', async () => {
  for (const sample of [
    {
      response: new Response('fixture-private-body', { status: 429 }),
      code: 'UPSTREAM_FAILED',
      stage: 'response',
      status: 429,
    },
    {
      response: Response.json({
        choices: [{ message: { content: 'fixture-private-reply' }, finish_reason: 'length' }],
      }),
      code: 'TRUNCATED',
      stage: 'parse',
      status: 200,
    },
  ]) {
    const model = new YibuTextModel(config, async () => sample.response);
    await assert.rejects(model.complete(messages), (error: unknown) => {
      const e = error as { code: string; stage: string; httpStatus: number };
      assert.equal(e.code, sample.code);
      assert.equal(e.stage, sample.stage);
      assert.equal(e.httpStatus, sample.status);
      assert.doesNotMatch(JSON.stringify(e), /fixture-private/);
      return true;
    });
  }
});
test('already cancelled complete never starts an upstream request', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const model = new YibuTextModel(config, async () => {
    calls++;
    throw Error('must not execute');
  });
  await assert.rejects(model.complete(messages, controller.signal), {
    code: 'CANCELLED',
    stage: 'request',
  });
  assert.equal(calls, 0);
});
