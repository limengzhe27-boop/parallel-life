import test from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
const config = { apiKey: 'test-only-secret', model: 'test-model', baseUrl: 'https://yibuapi.com', timeoutMs: 1000 };
test('gateway restricts origin and does not follow redirects', async () => {
  assert.throws(() => new YibuTextModel({ ...config, baseUrl: 'https://example.com' }), { code: 'INVALID_CONFIG' });
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://yibuapi.com/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-only-secret');
    return Response.json({ choices: [{ message: { content: '你好' } }] });
  };
  assert.equal(await new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]), '你好');
});
test('upstream errors are sanitized and not automatically retried', async () => {
  let count = 0;
  const request: typeof fetch = async () => { count++; return new Response('private upstream data', { status: 500 }); };
  await assert.rejects(new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]), { code: 'UPSTREAM_FAILED', message: 'UPSTREAM_FAILED' });
  assert.equal(count, 1);
});
test('empty or malformed completions do not become successful replies', async () => {
  for (const body of [{}, null, { choices: [{ message: { content: '' } }] }]) {
    const request: typeof fetch = async () => Response.json(body);
    await assert.rejects(new YibuTextModel(config, request).complete([{ role: 'user', content: 'hi' }]), { code: 'INVALID_RESPONSE' });
  }
});
