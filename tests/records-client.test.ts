import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LifeClient, ApiFailure } from '../src/features/api/client.ts';
const worldId = randomUUID();
const fixture = {
  schemaVersion: 1,
  worldId,
  worldVersion: 3,
  coverage: 'recent',
  current: [],
  about: [],
  history: [],
};
test('records client shares the session and accepts a strict successful empty response', async () => {
  let sessions = 0,
    reads = 0;
  const client = new LifeClient(async (url, options) => {
    if (String(url).endsWith('/session')) {
      sessions++;
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    }
    reads++;
    assert.equal(String(url), `/api/v1/worlds/${worldId}/records`);
    assert.equal(options?.body, undefined);
    assert.equal(options?.method, undefined);
    assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), 'a'.repeat(43));
    return Response.json(fixture);
  });
  const both = await Promise.all([
    client.readWorldRecords(worldId),
    client.readWorldRecords(worldId),
  ]);
  assert.equal(sessions, 1);
  assert.equal(reads, 2);
  assert.deepEqual(both[0], fixture);
});
test('strict records reader rejects missing fields and unexpected private payloads', async () => {
  for (const body of [
    {},
    { ...fixture, payload: 'SECRET_INTERNAL' },
    { ...fixture, current: [{ id: 'fake', text: 'fake' }] },
  ]) {
    const client = new LifeClient(async (url) =>
      String(url).endsWith('/session')
        ? Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) })
        : Response.json(body),
    );
    await assert.rejects(
      client.readWorldRecords(worldId),
      (error) =>
        error instanceof ApiFailure &&
        error.code === 'UNAVAILABLE' &&
        !error.message.includes('SECRET'),
    );
  }
});
test('404 and 503 remain failures rather than successful empty records', async () => {
  for (const [status, code] of [
    [404, 'NOT_FOUND'],
    [503, 'UNAVAILABLE'],
  ] as const) {
    const client = new LifeClient(async (url) =>
      String(url).endsWith('/session')
        ? Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) })
        : Response.json(
            {
              error: {
                code,
                message: '读取失败',
                retryable: status === 503,
                requestId: randomUUID(),
              },
            },
            { status },
          ),
    );
    await assert.rejects(
      client.readWorldRecords(worldId),
      (error) => error instanceof ApiFailure && error.code === code,
    );
  }
});
test('a disconnected records read is explicit and does not contain upstream secrets', async () => {
  const client = new LifeClient(async (url) => {
    if (String(url).endsWith('/session'))
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    throw Error('SECRET_TRANSPORT');
  });
  await assert.rejects(
    client.readWorldRecords(worldId),
    (error) =>
      error instanceof ApiFailure &&
      error.code === 'UNAVAILABLE' &&
      !error.message.includes('SECRET'),
  );
});
