import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  createHttpRequestContext,
  safeHttpFailureMetadata,
} from '../src/server/http-failure-diagnostics.ts';

// Exercise the real endpoint and message route without Next's server runtime or any database/model.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server')
      return {
        url: 'data:text/javascript,export const NextResponse={json:(data,init)=>Response.json(data,init)};export const after=()=>{};',
        shortCircuit: true,
      };
    if (specifier === 'server-only')
      return { url: 'data:text/javascript,export {};', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/src/server/services.ts'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const getServices=()=>globalThis.__httpDiagnosticFixture;',
      };
    if (url.endsWith('/src/server/chat-media-tasks.ts'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const runCommittedChatMedia=async()=>{};',
      };
    return nextLoad(url, context);
  },
});
const { endpoint, json, HttpError } = await import('../src/server/http.ts');
const { worldMessageRoute } = await import('../src/server/world-message-http.ts');
const { NpcMessageError } = await import('../src/server/npc-agent-services.ts');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const commandId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('HTTP diagnostics retain finite structured evidence, never private text or accessor contents', () => {
  let getters = 0;
  const error = Object.assign(new Error('PRIVATE SQL token and dialogue'), {
    code: 'PRIVATE_UNKNOWN',
    diagnostic: {
      stage: 'commit',
      code: 'INVALID_AGENT_PROPOSAL',
      reason: 'UNKNOWN_GOAL',
      commandId,
      attemptId: id,
    },
  });
  Object.defineProperty(error, 'cause', {
    get() {
      getters++;
      throw Error('PRIVATE');
    },
  });
  const result = safeHttpFailureMetadata(error);
  assert.deepEqual(result, {
    category: 'business_precondition',
    failureCode: 'INVALID_AGENT_PROPOSAL',
    failureReason: 'UNKNOWN_GOAL',
    failureStage: 'commit',
    attemptId: id,
    commandId,
  });
  assert.equal(getters, 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  const malicious = {};
  for (const key of ['diagnostic', 'code', 'reason', 'stage', 'httpStatus', 'durationMs'])
    Object.defineProperty(malicious, key, {
      get() {
        getters++;
        return 'PRIVATE';
      },
    });
  assert.deepEqual(safeHttpFailureMetadata(malicious), { category: 'unclassified' });
  assert.equal(getters, 0);
});

test('unknown diagnostic fields and unsafe IDs remain unclassified and omitted', () => {
  const result = safeHttpFailureMetadata({
    diagnostic: {
      stage: 'PRIVATE',
      code: 'SQL_PRIVATE',
      reason: 'PRIVATE',
      commandId: 'PRIVATE',
      attemptId: 'PRIVATE',
    },
    httpStatus: Infinity,
    durationMs: -1,
  });
  assert.deepEqual(result, { category: 'unclassified' });
  const shape = safeHttpFailureMetadata({
    diagnostic: { code: 'INVALID_AGENT_PROPOSAL', reason: 'RESPONSE_SHAPE:PRIVATE_SOURCE=secret' },
  });
  assert.equal(shape.failureReason, 'RESPONSE_SHAPE');
  assert.equal(JSON.stringify(shape).includes('PRIVATE'), false);
});

test('request reporter records once and a logger failure never replaces the business result', () => {
  let calls = 0;
  const ctx = createHttpRequestContext(
    id,
    10,
    () => {
      calls++;
      throw Error('logging unavailable');
    },
    () => 20,
  );
  assert.doesNotThrow(() => ctx.reportFailure({ code: 'ATTEMPT_UNKNOWN' }, 503, 'UNKNOWN'));
  ctx.reportFailure({ code: 'VERSION_CONFLICT' }, 409, 'VERSION_CONFLICT');
  assert.equal(calls, 1);
  assert.equal(ctx.requestId, id);
});

test('real endpoint uses one body/header/log ID and retains existing status/retry semantics', async (t) => {
  const records: string[] = [];
  t.mock.method(console, 'warn', (line: string) => records.push(line));
  const response = await endpoint(async () => {
    throw Object.assign(new Error('PRIVATE SQL'), { code: 'VERSION_CONFLICT' });
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
  assert.equal(records.length, 1);
  assert.equal(JSON.parse(records[0]!).requestId, body.error.requestId);
  assert.equal(response.headers.get('x-error-message'), null);
  assert.equal(records.join().includes('PRIVATE'), false);
  assert.equal(JSON.parse(records[0]!).failureCode, 'VERSION_CONFLICT');
  const unavailable = await endpoint(async () => {
    throw Error('PRIVATE upstream response');
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.retryable, true); // Existing generic contract, not paid retry authority.
  const rate = await endpoint(async () => {
    throw new HttpError('RATE_LIMITED', 429);
  });
  assert.equal(rate.headers.get('retry-after'), '60');
  assert.equal((await rate.json()).error.retryable, true);
});

test('real message route handled NPC failure gets the endpoint ID and safe single log without enabling retry', async (t) => {
  const records: string[] = [];
  t.mock.method(console, 'warn', (line: string) => records.push(line));
  const failure = new NpcMessageError('UNKNOWN', '这次回复尚未确认。', 503);
  Object.assign(failure, {
    diagnostic: { stage: 'response_store', code: 'ATTEMPT_UNKNOWN', attemptId: id, commandId },
  });
  const fixture = {
    sessions: { verify: () => id, verifyCsrf: () => true },
    identity: { exists: async () => true },
    origin: 'https://example.test',
    npcAgents: {
      sendMessageIfEnabled: async () => {
        throw failure;
      },
    },
  };
  const globals = globalThis as typeof globalThis & { __httpDiagnosticFixture?: unknown };
  globals.__httpDiagnosticFixture = fixture;
  t.after(() => {
    delete globals.__httpDiagnosticFixture;
  });
  const response = await worldMessageRoute(
    new Request('https://example.test/api/v1/worlds/' + id + '/messages', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        cookie: 'pl_session=synthetic',
        'content-type': 'application/json',
        'x-csrf-token': 'synthetic',
      },
      body: JSON.stringify({
        commandId,
        actorId: id,
        expectedVersion: 0,
        text: 'PRIVATE synthetic player input',
      }),
    }),
    id,
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'UNKNOWN');
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
  assert.equal(records.length, 1);
  const record = JSON.parse(records[0]!);
  assert.equal(record.requestId, body.error.requestId);
  assert.equal(record.attemptId, id);
  assert.equal(record.commandId, commandId);
  assert.equal(record.failureStage, 'response_store');
  assert.equal(records.join().includes('PRIVATE'), false);
  assert.equal(response.headers.get('x-error-message'), null);
});

test('successful endpoint returns original response without failure logging', async (t) => {
  let logs = 0;
  t.mock.method(console, 'warn', () => {
    logs++;
  });
  const response = await endpoint(async (context) =>
    json({ requestId: context.requestId, ok: true }),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(logs, 0);
});

test('streaming known version conflict is a closed error frame, not a broken unknown transport', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const globals = globalThis as typeof globalThis & { __httpDiagnosticFixture?: unknown };
  globals.__httpDiagnosticFixture = {
    sessions: { verify: () => id, verifyCsrf: () => true },
    identity: { exists: async () => true },
    origin: 'https://example.test',
    npcAgents: {
      sendMessageIfEnabled: async () => {
        throw Object.assign(Error('PRIVATE'), { code: 'VERSION_CONFLICT' });
      },
    },
  };
  t.after(() => {
    delete globals.__httpDiagnosticFixture;
  });
  const response = await worldMessageRoute(
    new Request('https://example.test/api/v1/worlds/' + id + '/messages', {
      method: 'POST',
      headers: {
        origin: 'https://example.test',
        cookie: 'pl_session=synthetic',
        'content-type': 'application/json',
        'x-csrf-token': 'synthetic',
        'x-message-stream': '1',
      },
      body: JSON.stringify({ commandId, actorId: id, expectedVersion: 0, text: 'synthetic' }),
    }),
    id,
  );
  const frame = JSON.parse((await response.text()).trim());
  assert.equal(frame.type, 'error');
  assert.equal(frame.error.code, 'VERSION_CONFLICT');
  assert.equal(frame.error.retryable, false);
  assert.equal(frame.error.requestId, response.headers.get('x-request-id'));
});
