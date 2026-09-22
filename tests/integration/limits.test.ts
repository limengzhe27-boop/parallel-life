import { consumeLimit } from '../../src/modules/storage/infrastructure/limits.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { randomUUID } from 'node:crypto';
test('persistent counters permit only one final concurrent slot and isolate owners', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    a = randomUUID(),
    b = randomUUID();
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [a, b]);
    await db.transaction(a, (sql) => consumeLimit(sql, a, 'test', 2, 60));
    const r = await Promise.allSettled(
      [1, 2].map(() => db.transaction(a, (sql) => consumeLimit(sql, a, 'test', 2, 60))),
    );
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(r.filter((x) => x.status === 'rejected').length, 1);
    assert.equal(
      (await db.transaction(b, (sql) => sql.query('SELECT * FROM parallel_life.rate_limits')))
        .rowCount,
      0,
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [[a, b]]);
    await admin.end();
  }
});
