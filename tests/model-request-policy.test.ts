import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateModelRequest,
  MODEL_TEXT_CHARACTER_LIMIT,
  MODEL_SCHEMA_CHARACTER_LIMIT,
} from '../src/modules/ai/application/model-request-policy.ts';
import { modelRequestNotSent } from '../src/modules/ai/application/ports.ts';
import type { ModelMessage, ModelOutputOptions } from '../src/modules/ai/application/ports.ts';
import { YibuTextModel } from '../src/modules/ai/infrastructure/yibu-text-model.ts';

const messages = (length: number): ModelMessage[] => [
  { role: 'system', content: 's'.repeat(5636) },
  { role: 'user', content: 'u'.repeat(length - 5636) },
];
const output: ModelOutputOptions = {
  format: 'json_schema',
  name: 'fixture',
  strict: true,
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};
const config = {
  apiKey: 'fixture-only-key',
  model: 'fixture',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 1000,
};

test('request budget includes all messages, preserves 85k director input and exact 96k boundary', () => {
  for (const size of [84447, 85409, MODEL_TEXT_CHARACTER_LIMIT]) {
    const input = messages(size);
    assert.deepEqual(validateModelRequest(input, 4096, output).messages, input);
  }
  assert.throws(() => validateModelRequest(messages(MODEL_TEXT_CHARACTER_LIMIT + 1), 4096), {
    code: 'INVALID_CONFIG',
    reason: 'INPUT_TEXT_LIMIT',
    stage: 'request',
    responseOutcome: 'not_sent',
    actual: MODEL_TEXT_CHARACTER_LIMIT + 1,
    limit: MODEL_TEXT_CHARACTER_LIMIT,
  });
});

test('schema and tokens use the same pure preflight and safe bounded diagnostics', () => {
  const oversized: ModelOutputOptions = {
    ...output,
    schema: { type: 'object', description: 'PRIVATE'.repeat(MODEL_SCHEMA_CHARACTER_LIMIT) },
  };
  for (const [cap, format, reason] of [
    [255, output, 'OUTPUT_TOKEN_LIMIT'],
    [16001, output, 'OUTPUT_TOKEN_LIMIT'],
    [4096, oversized, 'OUTPUT_SCHEMA_LIMIT'],
    [4096, { ...output, name: 'bad name' }, 'OUTPUT_FORMAT_INVALID'],
  ] as const) {
    assert.throws(
      () => validateModelRequest(messages(6000), cap, format),
      (e) => {
        assert.equal((e as { reason: string }).reason, reason);
        assert.equal(modelRequestNotSent(e), true);
        assert.doesNotMatch(JSON.stringify(e), /PRIVATE|fixture-only-key/);
        return true;
      },
    );
  }
});

test('complete and stream reject oversized input before any injected transport call', async () => {
  let calls = 0;
  const model = new YibuTextModel(config, async () => {
    calls++;
    throw Error('TRANSPORT_MUST_NOT_RUN');
  });
  const input = messages(MODEL_TEXT_CHARACTER_LIMIT + 1);
  await assert.rejects(model.complete(input, undefined, 4096, output), {
    code: 'INVALID_CONFIG',
    reason: 'INPUT_TEXT_LIMIT',
    responseOutcome: 'not_sent',
  });
  await assert.rejects(
    async () => {
      for await (const _ of model.streamComplete(input, undefined, output)) {
        /* no output */
      }
    },
    { code: 'INVALID_CONFIG', reason: 'INPUT_TEXT_LIMIT', responseOutcome: 'not_sent' },
  );
  assert.equal(calls, 0);
});

test('85k preflight and actual complete use identical full content and schema', async () => {
  const input = messages(85409);
  const prepared = validateModelRequest(input, 4096, output);
  let calls = 0;
  const model = new YibuTextModel(config, async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.messages, prepared.messages);
    assert.deepEqual(body.response_format, prepared.format);
    assert.equal(body.max_tokens, prepared.maxTokens);
    return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
  });
  assert.equal(await model.complete(input, undefined, 4096, output), '{}');
  assert.equal(calls, 1);
});
