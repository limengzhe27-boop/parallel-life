import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LifeClient, ApiFailure } from '../src/features/api/client.ts';
import { emptyWorkspace } from './fixtures/interview.ts';
test('client shares one session and validates real responses without fixture fallback', async () => {
  let sessions = 0;
  const client = new LifeClient(async (url, options) => {
    if (String(url).endsWith('/session')) {
      sessions++;
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    }
    assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), 'a'.repeat(43));
    return Response.json(emptyWorkspace);
  });
  const results = await Promise.all([client.workspace(), client.workspace()]);
  assert.equal(sessions, 1);
  assert.equal(results[0]?.profile.facts.length, 0);
});
test('network/malformed/conflict responses remain explicit failures', async () => {
  for (const type of ['network', 'malformed', 'conflict']) {
    const client = new LifeClient(async (url) => {
      if (String(url).endsWith('/session'))
        return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
      if (type === 'network') throw Error('secret upstream');
      if (type === 'malformed') return Response.json({ madeUp: true });
      return Response.json(
        {
          error: {
            code: 'VERSION_CONFLICT',
            message: '资料有更新',
            retryable: false,
            requestId: randomUUID(),
          },
        },
        { status: 409 },
      );
    });
    await assert.rejects(
      client.workspace(),
      (error: unknown) =>
        error instanceof ApiFailure &&
        !error.message.includes('secret') &&
        (type !== 'conflict' || error.code === 'VERSION_CONFLICT'),
    );
  }
});

test('default transport keeps the receiver required by native browser fetch', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function (this: unknown, url: RequestInfo | URL) {
      assert.equal(this, globalThis);
      return String(url).endsWith('/session')
        ? Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) })
        : Response.json(emptyWorkspace);
    };
    const client = new LifeClient();
    assert.equal((await client.workspace()).interview.version, 0);
  } finally {
    globalThis.fetch = original;
  }
});
