import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayError, YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';

const config = {
  apiKey: 'audit-private-key',
  model: 'audit-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 30,
};
const messages = [{ role: 'user' as const, content: 'audit-private-input' }];
const encoder = new TextEncoder();
const delta = 'data: {"choices":[{"delta":{"content":"合成片段"}}]}\n\n';
const done = 'data: [DONE]\n\n';
function model(request: typeof fetch, timeoutMs = 30) {
  return new YibuTextModel({ ...config, timeoutMs }, request);
}
async function collect(source: AsyncIterable<string>) {
  let text = '';
  for await (const part of source) text += part;
  return text;
}
type Observed<T> =
  { state: 'resolved'; value: T } | { state: 'rejected'; error: unknown } | { state: 'pending' };
async function observe<T>(promise: Promise<T>, maxWait = 180): Promise<Observed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ state: 'resolved' as const, value }),
        (error) => ({ state: 'rejected' as const, error }),
      ),
      new Promise<{ state: 'pending' }>((resolve) => {
        timer = setTimeout(() => resolve({ state: 'pending' }), maxWait);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function safeError(
  result: Observed<unknown>,
  code: GatewayError['code'],
  stage: GatewayError['stage'],
) {
  assert.equal(
    result.state,
    'rejected',
    'adapter must settle without cooperation from the transport',
  );
  if (result.state !== 'rejected') throw Error('unreachable');
  assert.ok(result.error instanceof GatewayError);
  assert.equal(result.error.code, code);
  assert.equal(result.error.stage, stage);
  assert.doesNotMatch(String(result.error.stack) + JSON.stringify(result.error), /audit-private/);
}
function stalledBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancellations++;
    },
  });
  return {
    body,
    cancellations: () => cancellations,
    cleanup() {
      try {
        controller.error(Error('fixture shutdown'));
      } catch {
        /* Already canceled. */
      }
    },
  };
}

test('Q: complete has a hard deadline when the injected request ignores abort, and never retries', async () => {
  let settle!: (response: Response) => void,
    calls = 0;
  const task = model(async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      settle = resolve;
    });
  }).complete(messages);
  const result = await observe(task);
  settle(Response.json({ choices: [{ message: { content: 'late fixture' } }] }));
  await task.catch(() => {});
  safeError(result, 'TIMEOUT', 'request');
  assert.equal(calls, 1);
});

test('Q: complete body read has a hard deadline independent of fetch signal support', async () => {
  const fixture = stalledBody();
  let calls = 0;
  const task = model(async () => {
    calls++;
    return new Response(fixture.body);
  }).complete(messages);
  const result = await observe(task);
  fixture.cleanup();
  await task.catch(() => {});
  safeError(result, 'TIMEOUT', 'response');
  assert.equal(calls, 1);
  assert.equal(fixture.body.locked, false);
  assert.equal(fixture.cancellations(), 1);
});

test('Q: explicit complete cancellation interrupts an uncooperative request', async () => {
  let settle!: (response: Response) => void,
    calls = 0;
  const cancellation = new AbortController();
  const task = model(async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      settle = resolve;
    });
  }, 1000).complete(messages, cancellation.signal);
  cancellation.abort(Error('audit-private-cancel-reason'));
  const result = await observe(task);
  settle(Response.json({ choices: [{ message: { content: 'late' } }] }));
  await task.catch(() => {});
  safeError(result, 'CANCELLED', 'request');
  assert.equal(calls, 1);
});

test('Q: explicit complete cancellation interrupts a stalled response and releases its reader', async () => {
  const fixture = stalledBody(),
    cancellation = new AbortController();
  const task = model(async () => new Response(fixture.body), 1000).complete(
    messages,
    cancellation.signal,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  cancellation.abort();
  const result = await observe(task);
  fixture.cleanup();
  await task.catch(() => {});
  safeError(result, 'CANCELLED', 'response');
  assert.equal(fixture.body.locked, false);
  assert.equal(fixture.cancellations(), 1);
});

test('Q: streaming request also has a hard deadline when the request ignores abort', async () => {
  let settle!: (response: Response) => void,
    calls = 0;
  const task = collect(
    model(async () => {
      calls++;
      return new Promise<Response>((resolve) => {
        settle = resolve;
      });
    }).streamComplete(messages),
  );
  const result = await observe(task);
  settle(new Response(done));
  await task.catch(() => {});
  safeError(result, 'TIMEOUT', 'request');
  assert.equal(calls, 1);
});

test('Q: streaming body stall times out, cancels and unlocks independently of request abort support', async () => {
  const fixture = stalledBody();
  let calls = 0;
  const task = collect(
    model(async () => {
      calls++;
      return new Response(fixture.body);
    }).streamComplete(messages),
  );
  const result = await observe(task);
  fixture.cleanup();
  await task.catch(() => {});
  safeError(result, 'TIMEOUT', 'stream');
  assert.equal(calls, 1);
  assert.equal(fixture.body.locked, false);
  assert.equal(fixture.cancellations(), 1);
});

test('Q: external streaming cancellation interrupts a stalled read without a retry', async () => {
  const fixture = stalledBody(),
    cancellation = new AbortController();
  let calls = 0;
  const task = collect(
    model(async () => {
      calls++;
      return new Response(fixture.body);
    }, 1000).streamComplete(messages, cancellation.signal),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  cancellation.abort(Error('audit-private-reason'));
  const result = await observe(task);
  fixture.cleanup();
  await task.catch(() => {});
  safeError(result, 'CANCELLED', 'stream');
  assert.equal(calls, 1);
  assert.equal(fixture.body.locked, false);
  assert.equal(fixture.cancellations(), 1);
});

test('Q: SSE EOF without DONE never turns a partial delta into a completed reply', async () => {
  let calls = 0;
  const result = await observe(
    collect(
      model(async () => {
        calls++;
        return new Response(delta);
      }).streamComplete(messages),
    ),
  );
  assert.equal(result.state, 'rejected');
  if (result.state === 'rejected') {
    assert.ok(result.error instanceof GatewayError);
    assert.equal(result.error.code, 'UPSTREAM_FAILED');
    assert.equal(result.error.stage, 'stream');
  }
  assert.equal(calls, 1);
});

test('Q: SSE finish_reason length remains a safe TRUNCATED error even when DONE follows', async () => {
  const result = await observe(
    collect(
      model(
        async () =>
          new Response(
            delta + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' + done,
          ),
      ).streamComplete(messages),
    ),
  );
  safeError(result, 'TRUNCATED', 'stream');
});

test('Q: a provider SSE error envelope is not silently swallowed behind DONE', async () => {
  const result = await observe(
    collect(
      model(
        async () =>
          new Response(
            delta +
              'data: {"error":{"message":"audit-private-provider-body","code":"quota"}}\n\n' +
              done,
          ),
      ).streamComplete(messages),
    ),
  );
  safeError(result, 'UPSTREAM_FAILED', 'stream');
});

test('Q: malformed JSON in a data record is rejected, while comment keepalives remain legal', async () => {
  const result = await observe(
    collect(
      model(
        async () => new Response(delta + 'data: {"choices":[audit-private-broken}\n\n' + done),
      ).streamComplete(messages),
    ),
  );
  safeError(result, 'INVALID_RESPONSE', 'stream');
  assert.equal(
    await collect(
      model(async () => new Response(': keepalive\n\n' + delta + done)).streamComplete(messages),
    ),
    '合成片段',
  );
});

test('Q: a consumer ending the iterator cancels the upstream body and unlocks it', async () => {
  let canceled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(delta));
    },
    cancel() {
      canceled++;
    },
  });
  for await (const part of model(async () => new Response(body), 1000).streamComplete(messages)) {
    assert.equal(part, '合成片段');
    break;
  }
  assert.equal(body.locked, false);
  assert.equal(canceled, 1);
});

test('Q: DONE stops and cancels a still-open upstream stream without reading or retrying again', async () => {
  let canceled = 0,
    calls = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(delta + done));
    },
    cancel() {
      canceled++;
    },
  });
  assert.equal(
    await collect(
      model(async () => {
        calls++;
        return new Response(body);
      }, 1000).streamComplete(messages),
    ),
    '合成片段',
  );
  assert.equal(body.locked, false);
  assert.equal(canceled, 1);
  assert.equal(calls, 1);
});

test('Q: pre-cancelled stream starts no request and exposes none of its cancellation reason', async () => {
  let calls = 0;
  const cancellation = new AbortController();
  cancellation.abort(Error('audit-private-reason'));
  const result = await observe(
    collect(
      model(async () => {
        calls++;
        throw Error('must not send');
      }).streamComplete(messages, cancellation.signal),
    ),
  );
  safeError(result, 'CANCELLED', 'request');
  assert.equal(calls, 0);
});

test('Q: SSE decoding preserves split UTF-8 text and CRLF framing through explicit DONE', async () => {
  const bytes = encoder.encode(delta.replaceAll('\n', '\r\n') + done.replaceAll('\n', '\r\n'));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 2) c.enqueue(bytes.slice(i, i + 2));
      c.close();
    },
  });
  assert.equal(
    await collect(model(async () => new Response(body), 1000).streamComplete(messages)),
    '合成片段',
  );
});

test('Q: a legitimate DONE marker without a trailing newline still completes unicode content', async () => {
  assert.equal(
    await collect(
      model(async () => new Response(delta + 'data: [DONE]'), 1000).streamComplete(messages),
    ),
    '合成片段',
  );
});
test('Q: a response arriving after the deadline is canceled rather than accepted as success', async () => {
  let settle!: (r: Response) => void,
    canceled = 0,
    calls = 0;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      canceled++;
    },
  });
  const task = model(async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      settle = resolve;
    });
  }).complete(messages);
  const result = await observe(task);
  settle(new Response(body));
  await new Promise<void>((resolve) => setImmediate(resolve));
  // The original adapter may still be pending in its late body read: close this synthetic stream for cleanup.
  if (body.locked) {
    try {
      controller.error(Error('late fixture cleanup'));
    } catch {}
  }
  await task.catch(() => {});
  safeError(result, 'TIMEOUT', 'request');
  assert.equal(calls, 1);
  assert.equal(canceled, 1);
  assert.equal(body.locked, false);
});
test('Q: complete enforces a byte bound before accepting an otherwise valid oversized JSON envelope', async () => {
  let calls = 0;
  const result = await observe(
    model(async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: 'small reply' } }],
        padding: '汉'.repeat(400000),
      });
    }, 1000).complete(messages),
  );
  assert.equal(result.state, 'rejected');
  if (result.state === 'rejected') {
    assert.ok(result.error instanceof GatewayError);
    assert.equal(result.error.code, 'INVALID_RESPONSE');
    assert.doesNotMatch(result.error.message, /small reply|padding/);
  }
  assert.equal(calls, 1);
});
test('Q: an unterminated oversized SSE frame is rejected rather than buffered indefinitely', async () => {
  const result = await observe(
    collect(
      model(async () => new Response('data: ' + 'x'.repeat(131073)), 1000).streamComplete(messages),
    ),
  );
  safeError(result, 'INVALID_RESPONSE', 'stream');
});
test('Q: streamed text has an aggregate bound even when every JSON frame is below its own cap', async () => {
  const chunk = (text: string) =>
    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
  const result = await observe(
    collect(
      model(
        async () =>
          new Response(chunk('a'.repeat(50000)) + chunk('b'.repeat(50000)) + chunk('c') + done),
        1000,
      ).streamComplete(messages),
    ),
  );
  safeError(result, 'INVALID_RESPONSE', 'stream');
});
test('Q: cancellation between yielded deltas emits no later buffered token', async () => {
  let canceled = 0;
  const c = new AbortController();
  const packet = (text: string) =>
    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(packet('first') + packet('late') + done));
    },
    cancel() {
      canceled++;
    },
  });
  const iterator = model(async () => new Response(body), 1000)
    .streamComplete(messages, c.signal)
    [Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: 'first', done: false });
  c.abort();
  const result = await observe(iterator.next());
  safeError(result, 'CANCELLED', 'stream');
  assert.equal(canceled, 1);
  assert.equal(body.locked, false);
});
test('Q: an uncooperative upstream cancel hook cannot keep consumer cleanup pending or keep the reader locked', async () => {
  let release!: () => void,
    canceled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(delta));
    },
    cancel() {
      canceled++;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  const iterator = model(async () => new Response(body), 1000)
    .streamComplete(messages)
    [Symbol.asyncIterator]();
  await iterator.next();
  const ending = iterator.return!();
  const result = await observe(ending);
  if (release) release();
  await ending;
  assert.equal(result.state, 'resolved');
  assert.equal(canceled, 1);
  assert.equal(body.locked, false);
});

for (const kind of ['complete', 'stream'] as const) {
  for (const phase of ['request', 'body'] as const) {
    for (const reason of ['SyntaxError', 'GatewayError'] as const) {
      test(`Q: ${kind} ${phase} cancellation reason ${reason} cannot override CANCELLED classification`, async () => {
        const fixture = stalledBody();
        const external = new AbortController();
        let settle: ((response: Response) => void) | undefined;
        let calls = 0;
        const adapter = model(async () => {
          calls++;
          if (phase === 'body') return new Response(fixture.body);
          return new Promise<Response>((resolve) => {
            settle = resolve;
          });
        }, 1000);
        const task =
          kind === 'complete'
            ? adapter.complete(messages, external.signal)
            : collect(adapter.streamComplete(messages, external.signal));
        await new Promise<void>((resolve) => setImmediate(resolve));
        external.abort(
          reason === 'SyntaxError'
            ? new SyntaxError('audit-private-reason')
            : new GatewayError('TRUNCATED', { stage: 'parse' }),
        );
        const result = await observe(task);
        settle?.(Response.json({ choices: [{ message: { content: 'late synthetic content' } }] }));
        fixture.cleanup();
        await task.catch(() => {});
        safeError(
          result,
          'CANCELLED',
          phase === 'request' ? 'request' : kind === 'complete' ? 'response' : 'stream',
        );
        assert.equal(calls, 1);
      });
    }
  }
}

test('Q: timeout cancels and unlocks the reader while a consumer is paused at yield', async () => {
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(delta));
    },
    cancel() {
      cancellations++;
    },
  });
  const iterator = model(async () => new Response(body), 25)
    .streamComplete(messages)
    [Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, '合成片段');
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  const atDeadline = { cancellations, locked: body.locked };
  const resumed = await observe(iterator.next());
  safeError(resumed, 'TIMEOUT', 'stream');
  assert.deepEqual(
    atDeadline,
    { cancellations: 1, locked: false },
    'cleanup must not depend on the next consumer iteration',
  );
});

test('Q: external abort cancels and unlocks the reader while a consumer is paused at yield', async () => {
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(delta));
    },
    cancel() {
      cancellations++;
    },
  });
  const external = new AbortController();
  const iterator = model(async () => new Response(body), 1000)
    .streamComplete(messages, external.signal)
    [Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, '合成片段');
  external.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const atAbort = { cancellations, locked: body.locked };
  const resumed = await observe(iterator.next());
  safeError(resumed, 'CANCELLED', 'stream');
  assert.deepEqual(atAbort, { cancellations: 1, locked: false });
});

test('Q: normal complete and DONE stream dispose their deadline timer after success', async () => {
  for (const streaming of [false, true]) {
    let signal: AbortSignal | null | undefined;
    const adapter = model(async (_url, init) => {
      signal = init?.signal;
      return streaming
        ? new Response(delta + done)
        : Response.json({ choices: [{ message: { content: 'synthetic reply' } }] });
    }, 25);
    assert.ok(
      streaming
        ? await collect(adapter.streamComplete(messages))
        : await adapter.complete(messages),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 65));
    assert.equal(
      signal?.aborted,
      false,
      'successful call must not leave a timer that aborts later',
    );
  }
});
