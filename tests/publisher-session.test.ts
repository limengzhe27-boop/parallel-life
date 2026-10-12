import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  hashPublisherPassword,
  parsePublisherPrincipals,
  PublisherSessions,
  publisherOriginAllowed,
} from '../src/modules/identity/infrastructure/publisher-session.ts';
import { SignedSession } from '../src/modules/identity/infrastructure/signed-session.ts';

const secret = 'fictional-test-only-publisher-key-000000000000';
const now = Date.parse('2026-10-12T09:00:00Z');
const password = 'fictional-test-only-password';
const verifier = await hashPublisherPassword(password);
const config = () => [
  {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'editor_one',
    displayName: '测试编辑',
    permissions: ['edit', 'publish'],
    enabled: true,
    passwordHash: verifier,
  },
];
const session = () => new PublisherSessions(secret, config());
async function token() {
  const value = await session().login('editor_one', password, now);
  assert.ok(value);
  return value.token;
}

test('publisher identity is separate from guest identity and does not serialize credential configuration', async () => {
  const svc = session(),
    result = await svc.login('editor_one', password, now);
  assert.ok(result);
  assert.equal(svc.verify(new SignedSession(secret).issue(now).token, now), null);
  assert.equal(new SignedSession(secret).verify(result.token, now), null);
  assert.equal(JSON.stringify(svc), '{}');
  assert.ok(!JSON.stringify(result.publisher).includes(verifier));
  assert.deepEqual(result.publisher.permissions, ['edit', 'publish']);
});
test('wrong, unknown, disabled and excessive credentials cannot establish internal identity', async () => {
  const svc = session();
  assert.equal(await svc.login('editor_one', 'wrong', now), null);
  assert.equal(await svc.login('unknown_user', password, now), null);
  assert.equal(
    await new PublisherSessions(
      secret,
      config().map((x) => ({ ...x, enabled: false })),
    ).login('editor_one', password, now),
    null,
  );
  assert.equal(await svc.login('editor_one', 'x'.repeat(161), now), null);
});
test('sessions have a two hour bound, reject future claims, expiry and tampering', async () => {
  const svc = session(),
    value = await token();
  assert.ok(svc.verify(value, now));
  assert.equal(svc.verify(value, now - 1000), null);
  assert.ok(svc.verify(value, now + 7199_000));
  assert.equal(svc.verify(value, now + 7200_000), null);
  assert.equal(svc.verify(value.replace(/.$/, value.endsWith('a') ? 'b' : 'a'), now), null);
  assert.equal(svc.verify('x'.repeat(2049), now), null);
});
test('different configured identities receive separate sessions and public permissions are cloned', async () => {
  const cfg = config();
  cfg.push({ ...cfg[0]!, id: '10000000-0000-4000-8000-000000000002', username: 'editor_two' });
  const svc = new PublisherSessions(secret, cfg);
  const a = await svc.login('editor_one', password, now),
    b = await svc.login('editor_two', password, now);
  assert.ok(a && b);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.publisher.id, b.publisher.id);
  a.publisher.permissions.splice(0);
  assert.ok(svc.authorize(a.token, 'publish', now));
});
test('removal, disabling, permission change, password change and signing key rotation revoke prior sessions', async () => {
  const value = await token();
  assert.equal(new PublisherSessions(secret, []).verify(value, now), null);
  for (const changed of [
    config().map((x) => ({ ...x, enabled: false })),
    config().map((x) => ({ ...x, permissions: ['edit'] })),
    config().map((x) => ({ ...x, passwordHash: `scrypt-v1$${'1'.repeat(32)}$${'1'.repeat(128)}` })),
  ]) {
    assert.equal(new PublisherSessions(secret, changed).verify(value, now), null);
  }
  assert.equal(
    new PublisherSessions('another-fictional-key-0000000000000000', config()).verify(value, now),
    null,
  );
});
test('edit permission does not grant publication and caller-owned configuration cannot mutate authority', async () => {
  const cfg = config().map((x) => ({ ...x, permissions: ['edit'] }));
  const svc = new PublisherSessions(secret, cfg);
  cfg[0]!.permissions.push('publish');
  const value = await svc.login('editor_one', password, now);
  assert.ok(value);
  assert.ok(svc.authorize(value.token, 'edit', now));
  assert.equal(svc.authorize(value.token, 'publish', now), null);
});
test('CSRF is specific to a valid internal session, rejects guest CSRF, expiry and multibyte mismatches', async () => {
  const svc = session(),
    value = await token(),
    next = await token(),
    csrf = svc.csrf(value, now);
  assert.ok(csrf);
  assert.ok(svc.verifyCsrf(value, csrf, now));
  assert.equal(svc.verifyCsrf(next, csrf, now), false);
  assert.equal(svc.verifyCsrf(value, new SignedSession(secret).csrf(value), now), false);
  assert.equal(svc.verifyCsrf(value, csrf, now + 7200_000), false);
  assert.equal(svc.verifyCsrf(value, '中'.repeat(csrf.length), now), false);
  assert.equal(svc.csrf('not-a-token', now), null);
});
test('even correctly signed extra claims or extended lifespan are rejected', async () => {
  const value = await token();
  const body = JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString());
  for (const bad of [
    { ...body, permission: 'publish' },
    { ...body, expires: body.expires + 1 },
    { ...body, v: 2 },
  ]) {
    const payload = Buffer.from(JSON.stringify(bad)).toString('base64url');
    const sig = createHmac('sha256', secret)
      .update(`publisher-session:v1:${payload}`)
      .digest('base64url');
    assert.equal(session().verify(`${payload}.${sig}`, now), null);
  }
});
test('publisher configuration strictly validates identities, hashes, roles and duplicates', () => {
  for (const bad of [
    null,
    {},
    [{ ...config()[0], password: password }],
    [config()[0], config()[0]],
    [{ ...config()[0], permissions: ['admin'] }],
    [{ ...config()[0], passwordHash: password }],
    [{ ...config()[0], id: 'guest' }],
    [{ ...config()[0], enabled: 'true' }],
  ]) {
    assert.throws(() => parsePublisherPrincipals(bad), /PUBLISHER_CONFIG_INVALID/);
  }
  assert.throws(() => new PublisherSessions('short', config()), /PUBLISHER_SESSION_NOT_CONFIGURED/);
});
test('configuration getters are rejected without executing and password hashing uses unique salts', async () => {
  let executed = false;
  const bad = { ...config()[0] };
  Object.defineProperty(bad, 'passwordHash', {
    enumerable: true,
    get: () => {
      executed = true;
      return verifier;
    },
  });
  assert.throws(() => parsePublisherPrincipals([bad]), /PUBLISHER_CONFIG_INVALID/);
  assert.equal(executed, false);
  const another = await hashPublisherPassword(password);
  assert.notEqual(another, verifier);
  await assert.rejects(hashPublisherPassword('short'), /PUBLISHER_PASSWORD_INVALID/);
});
test('configuration arrays cannot execute element getters or caller supplied iteration methods', () => {
  let calls = 0;
  const getter = config();
  Object.defineProperty(getter, '0', {
    enumerable: true,
    get: () => {
      calls++;
      return config()[0];
    },
  });
  assert.throws(() => parsePublisherPrincipals(getter), /PUBLISHER_CONFIG_INVALID/);
  const custom = config();
  Object.setPrototypeOf(custom, {
    map() {
      calls++;
      return config();
    },
  });
  assert.throws(() => parsePublisherPrincipals(custom), /PUBLISHER_CONFIG_INVALID/);
  const permissions = ['edit'];
  Object.defineProperty(permissions, Symbol.iterator, {
    get: () => {
      calls++;
      return Array.prototype[Symbol.iterator];
    },
  });
  assert.throws(
    () => parsePublisherPrincipals([{ ...config()[0], permissions }]),
    /PUBLISHER_CONFIG_INVALID/,
  );
  assert.equal(calls, 0);
});

test('administrative origin checks allow only exact configured sites and reject hostile forwarded hosts', () => {
  const origins = ['https://parallel-life.example', 'http://127.0.0.1:3218'];
  const request = (origin: string, more: Record<string, string> = {}) =>
    new Request('https://parallel-life.example/internal', {
      method: 'POST',
      headers: { origin, ...more },
    });
  assert.ok(publisherOriginAllowed(request(origins[0]!), origins));
  assert.ok(publisherOriginAllowed(request(origins[1]!), origins));
  assert.equal(
    publisherOriginAllowed(request(origins[0]!, { 'sec-fetch-site': 'cross-site' }), origins),
    false,
  );
  assert.equal(
    publisherOriginAllowed(
      request('https://unrelated.vercel.app', {
        host: 'unrelated.vercel.app',
        'x-forwarded-host': 'unrelated.vercel.app',
      }),
      origins,
    ),
    false,
  );
  for (const origin of [
    'null',
    'https://parallel-life.example/another',
    'https://name:password@parallel-life.example',
    'https://parallel-life.example.evil.test',
  ])
    assert.equal(publisherOriginAllowed(request(origin), origins), false);
  assert.equal(
    publisherOriginAllowed(new Request('https://parallel-life.example/internal'), origins),
    false,
  );
});
