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

test('unused-upload disposal accepts no-content and preserves server conflicts', async () => {
  const assetId = randomUUID();
  let conflict = false;
  const client = new LifeClient(async (url, options) => {
    if (String(url).endsWith('/session'))
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    assert.equal(String(url), `/api/v1/assets/${assetId}?onlyIfUnused=1`);
    assert.equal(options?.method, 'DELETE');
    assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), 'a'.repeat(43));
    return conflict
      ? Response.json(
          {
            error: {
              code: 'CONFLICT',
              message: '已被使用',
              retryable: false,
              requestId: randomUUID(),
            },
          },
          { status: 409 },
        )
      : new Response(null, { status: 204 });
  });
  await client.discardUnusedUpload(assetId);
  conflict = true;
  await assert.rejects(client.discardUnusedUpload(assetId), { code: 'CONFLICT' });
});

test('client handles account register, login, session status, and clearSession', async () => {
  const accountId = randomUUID();
  let currentCsrf = 'csrf-initial-' + 'b'.repeat(30);

  const client = new LifeClient(async (url, options) => {
    const u = String(url);
    if (u === '/api/v1/session' && options?.method === 'GET') {
      return Response.json({
        authenticated: true,
        kind: 'account',
        userId: accountId,
        identifier: 'tester@example.com',
        csrfToken: currentCsrf,
      });
    }
    if (u.endsWith('/session') && options?.method === 'POST') {
      return Response.json({ kind: 'guest', csrfToken: currentCsrf });
    }
    if (u.endsWith('/session') && options?.method === 'DELETE') {
      currentCsrf = '';
      return Response.json({ status: 'cleared' });
    }
    if (u.endsWith('/auth/register') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      assert.equal(body.identifier, 'newuser@example.com');
      currentCsrf = 'csrf-registered-' + 'c'.repeat(27);
      return Response.json({
        accountId,
        identifier: body.identifier,
        kind: 'account',
        mergedGuest: false,
        csrfToken: currentCsrf,
      });
    }
    if (u.endsWith('/auth/login') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      assert.equal(body.identifier, 'tester@example.com');
      currentCsrf = 'csrf-loggedin-' + 'd'.repeat(29);
      return Response.json({
        accountId,
        identifier: body.identifier,
        kind: 'account',
        mergedGuest: true,
        csrfToken: currentCsrf,
      });
    }
    throw new Error(`Unexpected url: ${u}`);
  });

  // 1. Session status check
  const status = await client.getSessionStatus();
  assert.equal(status.authenticated, true);
  assert.equal(status.kind, 'account');
  assert.equal(status.identifier, 'tester@example.com');

  // 2. Register account
  const reg = await client.registerAccount({
    identifier: 'newuser@example.com',
    password: 'password123',
  });
  assert.equal(reg.accountId, accountId);
  assert.equal(reg.identifier, 'newuser@example.com');

  // 3. Login account with guest merge
  const login = await client.loginAccount({
    identifier: 'tester@example.com',
    password: 'password123',
    mergeGuest: true,
  });
  assert.equal(login.accountId, accountId);
  assert.equal(login.mergedGuest, true);

  // 4. Clear session
  await client.clearSession();
});
