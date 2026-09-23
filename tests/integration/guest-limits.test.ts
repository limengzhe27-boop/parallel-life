import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';

/** AUD-15 acceptance: one caller must not be able to spend everyone's guest allowance. */
test('guest creation is limited per caller, keeps a global ceiling, and stays idempotent', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const identity = new IdentityRepository(db);
  const limits = { perCaller: 3, ceiling: 5, windowSeconds: 3600 };
  const noisy = `noisy-${randomUUID().slice(0, 8)}`;
  const quiet = `quiet-${randomUUID().slice(0, 8)}`;
  try {
    await admin.query('DELETE FROM parallel_life.guest_limits');
    await admin.query('DELETE FROM parallel_life.guest_limits_by_key');

    // A caller may create up to its own allowance.
    for (let attempt = 1; attempt <= limits.perCaller; attempt += 1)
      assert.equal(await identity.reserveGuestCreation(noisy, limits), true, `attempt ${attempt}`);

    // Then that caller is refused while another caller is unaffected.
    assert.equal(await identity.reserveGuestCreation(noisy, limits), false);
    assert.equal(await identity.reserveGuestCreation(quiet, limits), true);

    // The refused attempts did not consume the global ceiling: the second caller
    // still has room for the rest of the ceiling (5 total, 4 used).
    assert.equal(await identity.reserveGuestCreation(quiet, limits), true);
    assert.equal(await identity.reserveGuestCreation(quiet, limits), false);

    // Creating an account twice never consumes quota.
    const id = randomUUID();
    await identity.ensureGuest(id);
    await identity.ensureGuest(id);
    const accounts = (
      await admin.query('SELECT count(*)::int AS n FROM parallel_life.accounts WHERE id=$1', [id])
    ).rows[0].n;
    assert.equal(accounts, 1);
  } finally {
    await admin.query('DELETE FROM parallel_life.guest_limits');
    await admin.query('DELETE FROM parallel_life.guest_limits_by_key');
    await db.close();
    await admin.end();
  }
});
