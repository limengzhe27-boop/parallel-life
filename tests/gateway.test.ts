import test from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
const config = {
  apiKey: 'test-only-secret',
  model: 'test-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};
test('gateway restricts origin and does not follow redirects', async () => {
  assert.throws(() => new YibuTextModel({ ...config, baseUrl: 'https://example.com' }), {
    code: 'INVALID_CONFIG',
  });
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://yibuapi.com/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer test-only-secret',
    );
    return Response.json({ choices: [{ message: { content: '你好' } }] });
  };
  assert.equal(
    await new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]),
    '你好',
  );
});
test('upstream errors are sanitized and not automatically retried', async () => {
  let count = 0;
  const request: typeof fetch = async () => {
    count++;
    return new Response('private upstream data', { status: 500 });
  };
  await assert.rejects(
    new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]),
    { code: 'UPSTREAM_FAILED', message: 'UPSTREAM_FAILED' },
  );
  assert.equal(count, 1);
});
test('empty or malformed completions do not become successful replies', async () => {
  for (const body of [{}, null, { choices: [{ message: { content: '' } }] }]) {
    const request: typeof fetch = async () => Response.json(body);
    await assert.rejects(
      new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]),
      { code: 'INVALID_RESPONSE' },
    );
  }
});
test('gateway parses OpenAI-compatible streaming deltas', async () => {
  const request: typeof fetch = async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).stream, true);
    return new Response(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
        'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const tokens: string[] = [];
  for await (const token of new YibuTextModel(config, request).streamComplete!([
    { role: 'user', content: 'hi' },
  ]))
    tokens.push(token);
  assert.deepEqual(tokens, ['你', '好']);
});

test('stream failure diagnostics identify HTTP rejection without exposing provider body or retrying', async () => {
  let requests = 0;
  const model = new YibuTextModel(config, async () => {
    requests++;
    return new Response('secret upstream body', { status: 403 });
  });
  await assert.rejects(
    async () => {
      for await (const _ of model.streamComplete([{ role: 'user', content: 'private input' }])) {
      }
    },
    (error) => {
      assert.equal((error as { httpStatus?: number }).httpStatus, 403);
      assert.equal((error as { stage?: string }).stage, 'response');
      assert.doesNotMatch(JSON.stringify(error), /secret|private input/);
      return true;
    },
  );
  assert.equal(requests, 1);
});
test('stream diagnostics distinguish request failure from interrupted response', async () => {
  for (const brokenBody of [false, true]) {
    const model = new YibuTextModel(config, async () => {
      if (!brokenBody) throw new Error('private transport details');
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private read details'));
          },
        }),
      );
    });
    await assert.rejects(
      async () => {
        for await (const _ of model.streamComplete([{ role: 'user', content: 'hi' }])) {
        }
      },
      (error) => {
        assert.equal((error as { stage?: string }).stage, brokenBody ? 'stream' : 'request');
        assert.equal((error as { httpStatus?: number }).httpStatus, brokenBody ? 200 : undefined);
        assert.doesNotMatch(JSON.stringify(error), /private/);
        return true;
      },
    );
  }
});
