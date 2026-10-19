import test from 'node:test';
import assert from 'node:assert/strict';
import { roleTextModel } from '../src/server/role-text-model.ts';
import type { TextModel } from '../src/modules/ai/application/ports.ts';

test('only native NPC output selects its configured role model, including private/group/scene callers', async () => {
  const seen: string[] = [];
  const make = (name: string): TextModel => ({
    complete: async () => {
      seen.push(name);
      return name;
    },
  });
  const model = roleTextModel(make('base'), make('npc'));
  await model.complete([], undefined, 4096, {
    format: 'json_schema',
    name: 'npc_agent_response',
    strict: true,
    schema: {},
  });
  await model.complete([], undefined, 4096, {
    format: 'json_schema',
    name: 'director',
    strict: true,
    schema: {},
  });
  await model.complete([]);
  assert.deepEqual(seen, ['npc', 'base', 'base']);
});

test('NPC failure records only safe fields and never retries or falls back', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  let baseCalls = 0,
    npcCalls = 0;
  const failure = Object.assign(Error('secret prompt and user ID'), {
    code: 'UPSTREAM_FAILED',
    stage: 'response',
    httpStatus: 503,
    durationMs: 1514.7,
    responseOutcome: 'rejected',
    request: { headers: { authorization: 'secret-key' } },
    model: 'private-model',
    userId: 'private-user',
  });
  const model = roleTextModel(
    {
      complete: async () => {
        baseCalls++;
        return '';
      },
    },
    {
      complete: async () => {
        npcCalls++;
        throw failure;
      },
    },
  );
  await assert.rejects(
    model.complete([{ role: 'user', content: 'private chat content' }], undefined, 4096, {
      format: 'json_schema',
      name: 'npc_agent_response',
      strict: true,
      schema: {},
    }),
    (error) => error === failure,
  );
  assert.equal(baseCalls, 0);
  assert.equal(npcCalls, 1);
  assert.deepEqual(
    logs.map((line) => JSON.parse(line)),
    [
      {
        event: 'npc_text_model_failed',
        code: 'UPSTREAM_FAILED',
        stage: 'response',
        httpStatus: 503,
        durationMs: 1515,
        responseOutcome: 'rejected',
      },
    ],
  );
  assert.doesNotMatch(logs[0]!, /secret|private|headers|userId|request"|"model"|message|stack/);
});

test('unsafe error metadata is omitted and a logging failure cannot mask the original error', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const failure = Object.assign(Error('private payload'), {
    code: 'secret-code',
    stage: 'private-stage',
    httpStatus: 999,
    durationMs: Infinity,
    responseOutcome: 'private-outcome',
  });
  Object.defineProperty(failure, 'request', {
    get: () => {
      throw Error('should not read');
    },
  });
  const model = roleTextModel(
    { complete: async () => 'base' },
    {
      complete: async () => {
        throw failure;
      },
    },
  );
  const output = {
    format: 'json_schema' as const,
    name: 'npc_agent_response',
    strict: true,
    schema: {},
  };
  await assert.rejects(model.complete([], undefined, 4096, output), (error) => error === failure);
  assert.deepEqual(
    logs.map((line) => JSON.parse(line)),
    [{ event: 'npc_text_model_failed' }],
  );
  t.mock.restoreAll();
  t.mock.method(console, 'error', () => {
    throw Error('logger unavailable');
  });
  await assert.rejects(model.complete([], undefined, 4096, output), (error) => error === failure);
});

test('base-model failure does not create an NPC diagnostic', async (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'error', (line: string) => logs.push(line));
  const failure = Error('base failure');
  const model = roleTextModel(
    {
      complete: async () => {
        throw failure;
      },
    },
    { complete: async () => 'npc' },
  );
  await assert.rejects(model.complete([]), (error) => error === failure);
  assert.deepEqual(logs, []);
});

test('only versioned Director JSON schema requests select the optional Director role model', async () => {
  const calls: { role: string; args: unknown[] }[] = [];
  const make = (role: string): TextModel => ({
    async complete(...args) {
      calls.push({ role, args });
      return role;
    },
  });
  const model = roleTextModel(make('base'), make('npc'), make('director'));
  const messages = [{ role: 'user' as const, content: 'A bounded fictional coordination input.' }];
  const signal = new AbortController().signal;
  const directorOutput = {
    format: 'json_schema' as const,
    name: 'director_response_v12',
    strict: true,
    schema: { type: 'object' },
  };
  assert.equal(await model.complete(messages, signal, 4321, directorOutput), 'director');
  assert.deepEqual(calls[0]!.args, [messages, signal, 4321, directorOutput]);
  for (const output of [
    { ...directorOutput, name: 'director' },
    { ...directorOutput, name: 'director_response_v12_extra' },
    { ...directorOutput, name: 'prefix_director_response_v12' },
    { ...directorOutput, name: 'director_response_vx' },
    { format: 'json_object' as const },
    undefined,
  ])
    assert.equal(await model.complete(messages, signal, 4321, output), 'base');
  assert.equal(
    await model.complete(messages, signal, 4321, { ...directorOutput, name: 'npc_agent_response' }),
    'npc',
  );
  assert.deepEqual(
    calls.map((call) => call.role),
    ['director', 'base', 'base', 'base', 'base', 'base', 'base', 'npc'],
  );
});

test('missing optional Director override preserves the ordinary base route', async () => {
  const seen: string[] = [];
  const model = roleTextModel(
    {
      complete: async () => {
        seen.push('base');
        return 'base';
      },
    },
    {
      complete: async () => {
        seen.push('npc');
        return 'npc';
      },
    },
  );
  for (const name of ['director_response_v1', 'director_response_v12', 'director_response_v99'])
    assert.equal(
      await model.complete([], undefined, 4096, {
        format: 'json_schema',
        name,
        strict: true,
        schema: {},
      }),
      'base',
    );
  assert.deepEqual(seen, ['base', 'base', 'base']);
});

test('Director override failure is returned once without retry, NPC invocation or base downgrade', async () => {
  let baseCalls = 0,
    npcCalls = 0,
    directorCalls = 0;
  const failure = Object.assign(Error('Original Director failure'), { code: 'UPSTREAM_FAILED' });
  const model = roleTextModel(
    {
      complete: async () => {
        baseCalls++;
        return 'base';
      },
    },
    {
      complete: async () => {
        npcCalls++;
        return 'npc';
      },
    },
    {
      complete: async () => {
        directorCalls++;
        throw failure;
      },
    },
  );
  await assert.rejects(
    model.complete([], undefined, 4096, {
      format: 'json_schema',
      name: 'director_response_v12',
      strict: true,
      schema: {},
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    { baseCalls, npcCalls, directorCalls },
    { baseCalls: 0, npcCalls: 0, directorCalls: 1 },
  );
});
