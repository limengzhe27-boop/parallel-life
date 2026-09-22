import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SignedSession,
  sameOrigin,
} from '../src/modules/identity/infrastructure/signed-session.ts';
test('signed session refuses tampering, expiration and another session CSRF', () => {
  const codec = new SignedSession('a'.repeat(64)),
    a = codec.issue(),
    b = codec.issue();
  assert.equal(codec.verify(a.token), a.userId);
  assert.equal(codec.verify(a.token.slice(0, -1) + '!'), null);
  assert.equal(codec.verify(a.token, Date.now() + 31 * 86400000), null);
  assert(codec.verifyCsrf(a.token, codec.csrf(a.token)));
  assert(!codec.verifyCsrf(a.token, codec.csrf(b.token)));
});
test('write origin must explicitly match configured application origin', () => {
  const origin = 'http://127.0.0.1:3218';
  assert(sameOrigin(new Request(origin, { headers: { origin } }), origin));
  assert(!sameOrigin(new Request(origin), origin));
  assert(!sameOrigin(new Request(origin, { headers: { origin: 'http://evil.example' } }), origin));
});
