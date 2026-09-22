import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
test('guests get stable isolated profiles and pooled identities do not leak', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    repo = new IdentityRepository(db),
    a = randomUUID(),
    b = randomUUID();
  try {
    await repo.ensureGuest(a);
    await repo.ensureGuest(a);
    await repo.ensureGuest(b);
    for (const id of [a, b]) {
      const rows = await db.transaction(id, (sql) =>
        sql.query('SELECT owner_id FROM parallel_life.profiles'),
      );
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0].owner_id, id);
    }
    assert.equal((await db.pool.query('SELECT * FROM parallel_life.profiles')).rowCount, 0);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [[a, b]]);
    await admin.end();
  }
});
