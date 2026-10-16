import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LifeClient, ApiFailure } from '../src/features/api/client.ts';
import { sendFailureStatus } from '../src/features/phone/chat-send-state.ts';
const worldId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const commandId = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';
const message = { commandId, actorId, expectedVersion: 7, text: '刚才说的事情，我还想问一句。' };
const committed = { status: 'committed', commandId, actorId, worldId, version: 8, eventId };
const advanced = {
  status: 'advanced',
  worldId,
  storyNow: '2026-10-14T00:00:00.000Z',
  played: 1,
  folded: 0,
  summary: null,
  actors: [actorId],
};

/** Virtual timers exercise abort behavior without real waits or any remote request. */
function virtualDeadlines(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('deadline reached', 'TimeoutError')), ms);
    return controller.signal;
  });
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function replyAfter(delay: number, data: unknown, signal: AbortSignal | undefined | null) {
  return new Promise<Response>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(Response.json(data));
    }, delay);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
async function connected(
  transport: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  const client = new LifeClient(async (url, init) => {
    if (String(url).endsWith('/session'))
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    return transport(url, init);
  });
  await client.connect();
  return client;
}
test('a real-shaped message receipt arriving after 15 seconds is accepted once with its original command and version', async (t) => {
  let calls = 0;
  const client = await connected(async (url, init) => {
    calls++;
    assert.equal(String(url), `/api/v1/worlds/${worldId}/messages`);
    assert.deepEqual(JSON.parse(String(init?.body)), message);
    return replyAfter(20_000, committed, init?.signal);
  });
  virtualDeadlines(t);
  let settled = false;
  const result = client.sendWorldMessage(worldId, message).finally(() => {
    settled = true;
  });
  await flush();
  t.mock.timers.tick(15_001);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(4_999);
  assert.deepEqual(await result, committed);
  assert.equal(calls, 1);
});
test('director advance waits through a two-model budget without sending a second advance', async (t) => {
  let calls = 0;
  const client = await connected(async (url, init) => {
    calls++;
    assert.equal(String(url), `/api/v1/worlds/${worldId}/advance`);
    assert.deepEqual(JSON.parse(String(init?.body)), { automatic: true });
    return replyAfter(175_000, advanced, init?.signal);
  });
  virtualDeadlines(t);
  let settled = false;
  const result = client.advanceWorld(worldId, true).finally(() => {
    settled = true;
  });
  await flush();
  t.mock.timers.tick(125_000);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(50_000);
  assert.deepEqual(await result, advanced);
  assert.equal(calls, 1);
});
test('ordinary reads retain their short deadline', async (t) => {
  let calls = 0;
  const client = await connected(async (_url, init) => {
    calls++;
    return replyAfter(20_000, {}, init?.signal);
  });
  virtualDeadlines(t);
  const result = client.readWorldClock(worldId);
  const rejected = assert.rejects(
    result,
    (error: unknown) => error instanceof ApiFailure && error.code === 'UNAVAILABLE',
  );
  await flush();
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(calls, 1);
});
test('long request deadlines remain finite and lost outcomes stay unknown without retrying', async (t) => {
  let calls = 0;
  const client = await connected(async (_url, init) => {
    calls++;
    return replyAfter(240_000, {}, init?.signal);
  });
  virtualDeadlines(t);
  const sent = client.sendWorldMessage(worldId, message);
  const unknownMessage = assert.rejects(
    sent,
    (error: unknown) => sendFailureStatus(error) === 'unknown',
  );
  await flush();
  t.mock.timers.tick(125_000);
  await unknownMessage;
  assert.equal(calls, 1);
  const advance = client.advanceWorld(worldId, true);
  const unknownAdvance = assert.rejects(
    advance,
    (error: unknown) => error instanceof ApiFailure && sendFailureStatus(error) === 'unknown',
  );
  await flush();
  t.mock.timers.tick(185_000);
  await unknownAdvance;
  assert.equal(calls, 2);
});
