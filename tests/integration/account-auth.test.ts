import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { SignedSession } from '../../src/modules/identity/infrastructure/signed-session.ts';

const secret = 'test-secret-at-least-32-chars-long-for-tests';

test('G-01: official account registration, login, guest merging, and recovery', async () => {
  const cfg = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const admin = await adminClient('parallel_life_test');
  const identity = new IdentityRepository(db);
  const worlds = new PostgresWorldRepository(db);
  const sessions = new SignedSession(secret);

  try {
    const testSuffix = randomUUID().slice(0, 8);
    const identifier1 = `user_${testSuffix}@example.com`;
    const password = 'StrongPassword123!';

    // 1. Direct registration from clean state
    const regResult = await identity.registerAccount({
      identifier: identifier1,
      password,
    });
    assert.equal(regResult.identifier, identifier1);
    assert.equal(regResult.mergedGuest, false);
    assert.ok(regResult.accountId);

    // Verify account info
    const info1 = await identity.getAccountInfo(regResult.accountId);
    assert.equal(info1?.kind, 'account');
    assert.equal(info1?.identifier, identifier1);

    // 2. Duplicate registration is rejected with CONFLICT
    await assert.rejects(
      async () => {
        await identity.registerAccount({
          identifier: identifier1,
          password,
        });
      },
      (err: unknown) => {
        return (err as { code?: string }).code === 'CONFLICT';
      },
    );

    // 3. Login with correct credentials succeeds
    const loginResult = await identity.loginAccount({
      identifier: identifier1,
      password,
    });
    assert.equal(loginResult.accountId, regResult.accountId);
    assert.equal(loginResult.identifier, identifier1);
    assert.equal(loginResult.mergedGuest, false);

    // 4. Login with wrong password fails with UNAUTHORIZED
    await assert.rejects(
      async () => {
        await identity.loginAccount({
          identifier: identifier1,
          password: 'WrongPassword999!',
        });
      },
      (err: unknown) => {
        return (err as { code?: string }).code === 'UNAUTHORIZED';
      },
    );

    // 5. Login with non-existent identifier fails with UNAUTHORIZED
    await assert.rejects(
      async () => {
        await identity.loginAccount({
          identifier: `nonexistent_${testSuffix}@example.com`,
          password,
        });
      },
      (err: unknown) => {
        return (err as { code?: string }).code === 'UNAUTHORIZED';
      },
    );

    // 6. Guest direct promotion to official account preserves world and profile
    const guestId = randomUUID();
    await identity.ensureGuest(guestId);
    const guestInfo = await identity.getAccountInfo(guestId);
    assert.equal(guestInfo?.kind, 'guest');
    assert.equal(guestInfo?.identifier, null);

    // Create a world for this guest
    const guestWorldId = randomUUID();
    const guestActorId = randomUUID();
    await worlds.initialize(
      { userId: guestId },
      {
        schemaVersion: 1,
        id: guestWorldId,
        ownerId: guestId,
        version: 0,
        title: '游客创建的世界',
        time: '2026-10-10T10:00:00Z',
        actors: [{ id: guestActorId, name: '游客伙伴', persona: '合成伙伴' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );

    // Guest registers an official account with mergeGuest: true
    const identifier2 = `guest_converted_${testSuffix}@example.com`;
    const converted = await identity.registerAccount({
      identifier: identifier2,
      password,
      currentGuestId: guestId,
      mergeGuest: true,
    });
    assert.equal(converted.accountId, guestId); // Direct promotion keeps ID!
    assert.equal(converted.mergedGuest, true);

    const convertedInfo = await identity.getAccountInfo(guestId);
    assert.equal(convertedInfo?.kind, 'account');
    assert.equal(convertedInfo?.identifier, identifier2);

    // Verify world is still accessible under converted account
    const loadedWorld = await worlds.get({ userId: guestId }, guestWorldId);
    assert.equal(loadedWorld.title, '游客创建的世界');

    // 7. Merging a separate guest into an existing official account
    const separateGuestId = randomUUID();
    await identity.ensureGuest(separateGuestId);
    const separateWorldId = randomUUID();
    await worlds.initialize(
      { userId: separateGuestId },
      {
        schemaVersion: 1,
        id: separateWorldId,
        ownerId: separateGuestId,
        version: 0,
        title: '独立游客的世界',
        time: '2026-10-10T12:00:00Z',
        actors: [{ id: randomUUID(), name: '独立NPC', persona: '合成' }],
        facts: [],
        messages: [],
        appointments: [],
        mediaRequests: [],
      },
    );

    // Separate guest logs in to official account 1 with mergeGuest: true
    const mergedLogin = await identity.loginAccount({
      identifier: identifier1,
      password,
      currentGuestId: separateGuestId,
      mergeGuest: true,
    });
    assert.equal(mergedLogin.accountId, regResult.accountId);
    assert.equal(mergedLogin.mergedGuest, true);

    // Official account 1 now owns the world from the separate guest!
    const transferredWorld = await worlds.get({ userId: regResult.accountId }, separateWorldId);
    assert.equal(transferredWorld.title, '独立游客的世界');
    assert.equal(transferredWorld.ownerId, regResult.accountId);

    // The old guest account is now cleaned up
    const oldGuestExists = await identity.exists(separateGuestId);
    assert.equal(oldGuestExists, false);

    // 8. Security & Isolation: A third party cannot read or claim other people's worlds
    const strangerId = randomUUID();
    await identity.ensureGuest(strangerId);
    await assert.rejects(async () => {
      await worlds.get({ userId: strangerId }, separateWorldId);
    });

    // 9. Session token issue and verification across recovery
    const issued = sessions.issue(regResult.accountId);
    const verifiedId = sessions.verify(issued.token);
    assert.equal(verifiedId, regResult.accountId);

    const csrf = sessions.csrf(issued.token);
    assert.equal(sessions.verifyCsrf(issued.token, csrf), true);
    assert.equal(sessions.verifyCsrf(issued.token, 'tampered-csrf'), false);
  } finally {
    await db.close();
    await admin.end();
  }
});
