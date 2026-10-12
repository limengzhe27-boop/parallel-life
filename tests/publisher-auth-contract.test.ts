import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PublisherLoginSchema,
  PublisherSessionStateSchema,
} from '../src/contracts/publisher-auth.ts';

const identity = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: 'editor',
  displayName: '测试编辑',
  permissions: ['edit'],
};
const authenticated = { publisher: identity, csrfToken: 'a'.repeat(43) };

test('publisher login accepts only bounded credentials and rejects client-supplied authority', () => {
  assert.ok(PublisherLoginSchema.safeParse({ username: 'editor', password: 'wrong' }).success);
  for (const extra of [
    { principalId: identity.id },
    { permissions: ['publish'] },
    { canPublish: true },
    { approved: true },
  ]) {
    assert.equal(
      PublisherLoginSchema.safeParse({ username: 'editor', password: 'wrong', ...extra }).success,
      false,
    );
  }
  assert.equal(
    PublisherLoginSchema.safeParse({ username: 'editor', password: 'a'.repeat(161) }).success,
    false,
  );
});

test('publisher session DTO cannot carry credentials, cookie tokens or employee configuration', () => {
  assert.ok(PublisherSessionStateSchema.safeParse(authenticated).success);
  for (const key of ['token', 'password', 'passwordHash', 'principals', 'secret']) {
    assert.equal(
      PublisherSessionStateSchema.safeParse({ ...authenticated, [key]: 'private' }).success,
      false,
    );
    assert.equal(
      PublisherSessionStateSchema.safeParse({
        ...authenticated,
        publisher: { ...identity, [key]: 'private' },
      }).success,
      false,
    );
  }
});

test('publisher session state binds identity and CSRF presence without inventing authenticated guests', () => {
  assert.ok(PublisherSessionStateSchema.safeParse({ publisher: null, csrfToken: null }).success);
  assert.equal(
    PublisherSessionStateSchema.safeParse({ publisher: identity, csrfToken: null }).success,
    false,
  );
  assert.equal(
    PublisherSessionStateSchema.safeParse({ publisher: null, csrfToken: 'a'.repeat(43) }).success,
    false,
  );
  assert.equal(
    PublisherSessionStateSchema.safeParse({ ...authenticated, csrfToken: 'not-a-token' }).success,
    false,
  );
});

test('publisher display permissions keep edit separate from publish and reject invalid authority names', () => {
  const edit = PublisherSessionStateSchema.parse(authenticated);
  assert.deepEqual(edit.publisher?.permissions, ['edit']);
  for (const permissions of [['admin'], ['edit', 'edit'], ['edit', 'publish', 'publish']]) {
    assert.equal(
      PublisherSessionStateSchema.safeParse({
        ...authenticated,
        publisher: { ...identity, permissions },
      }).success,
      false,
    );
  }
});
