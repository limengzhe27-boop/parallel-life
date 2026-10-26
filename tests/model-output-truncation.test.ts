import test from 'node:test';
import assert from 'node:assert/strict';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';
import {
  modelOutputTruncation,
  isReceivedModelTruncation,
  TRUNCATED_RESPONSE_MAX_BYTES,
} from '../src/modules/ai/application/model-output-truncation.ts';
const config = {
  apiKey: 'private-test-key',
  model: 'fixture',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};
const messages = [{ role: 'user' as const, content: 'private-request' }];
test('received length output retains bounded private evidence through gateway wrapping', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    return Response.json({
      choices: [{ message: { content: '{"private-output":' }, finish_reason: 'length' }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 4096,
        total_tokens: 4111,
        completion_tokens_details: { reasoning_tokens: 10 },
      },
    });
  });
  await assert.rejects(model.complete(messages), (error) => {
    assert.equal((error as { code: string }).code, 'TRUNCATED');
    const evidence = modelOutputTruncation(error)!;
    assert.equal(evidence.kind, 'model_output_truncated');
    assert.equal(evidence.schemaVersion, 1);
    assert.equal(evidence.finish_reason, 'length');
    assert.equal(evidence.content, '{"private-output":');
    assert.deepEqual(evidence.usage, {
      prompt_tokens: 15,
      completion_tokens: 4096,
      total_tokens: 4111,
      completion_tokens_details: { reasoning_tokens: 10 },
    });
    assert.equal(isReceivedModelTruncation(evidence), true);
    assert.equal(isReceivedModelTruncation(JSON.parse(JSON.stringify(evidence))), false);
    assert.doesNotMatch(JSON.stringify(error), /private-output|private-request|private-test-key/);
    assert.doesNotMatch(String(error), /private-output/);
    return true;
  });
  assert.equal(calls, 1);
});
test('oversized truncated content and unexpected usage stay bounded without losing original size', async () => {
  const content = '汉'.repeat(150_000);
  const model = new YibuTextModel(config, async () =>
    Response.json({
      choices: [{ message: { content }, finish_reason: 'length' }],
      usage: {
        completion_tokens: 4096,
        secret: 'private-provider-key',
        extra: { too: { deep: 42 } },
      },
    }),
  );
  await assert.rejects(model.complete(messages), (error) => {
    const evidence = modelOutputTruncation(error)!;
    assert.equal(evidence.content?.length, 100_000);
    assert.equal(evidence.contentCharacters, 150_000);
    assert(Buffer.byteLength(JSON.stringify(evidence)) <= TRUNCATED_RESPONSE_MAX_BYTES);
    assert.doesNotMatch(JSON.stringify(evidence), /private-provider-key|deep/);
    return true;
  });
});
test('network failures and model-authored lookalikes cannot forge received failure evidence', async () => {
  const raw = JSON.stringify({
    kind: 'model_output_truncated',
    schemaVersion: 1,
    finish_reason: 'length',
    content: 'fake',
  });
  const model = new YibuTextModel(config, async () =>
    Response.json({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }),
  );
  assert.equal(await model.complete(messages), raw);
  assert.equal(modelOutputTruncation(JSON.parse(raw)), null);
  assert.equal(isReceivedModelTruncation(JSON.parse(raw)), false);
  const broken = new YibuTextModel(config, async () => {
    throw Error('socket lost');
  });
  await assert.rejects(broken.complete(messages), (error) => {
    assert.equal(modelOutputTruncation(error), null);
    assert.equal((error as { code: string }).code, 'UPSTREAM_FAILED');
    return true;
  });
});
test('JSON-escaped control characters cannot turn a known truncation back into unknown', async () => {
  const content = '\u0000'.repeat(150_000);
  const model = new YibuTextModel(config, async () =>
    Response.json({ choices: [{ message: { content }, finish_reason: 'length' }] }),
  );
  await assert.rejects(model.complete(messages), (error) => {
    const evidence = modelOutputTruncation(error)!;
    assert(evidence);
    assert.equal(evidence.contentCharacters, 150_000);
    assert(evidence.content!.length > 0);
    assert(Buffer.byteLength(JSON.stringify(evidence)) <= TRUNCATED_RESPONSE_MAX_BYTES);
    return true;
  });
});
