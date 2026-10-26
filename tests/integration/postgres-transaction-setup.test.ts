import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';

test('transaction setup uses one fixed SQL round trip, isolates identity and rolls back failures', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.POSTGRES_SETUP_TEST_PORT ?? 55432));
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(() => db.close());
  const calls: { text: string; values: unknown[] | undefined }[] = [];
  db.pool.on('connect', (client) => {
    const query = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      calls.push({ text: String(args[0]), values: Array.isArray(args[1]) ? args[1] : undefined });
      return Reflect.apply(query, client, args);
    }) as typeof client.query;
  });
  const first = randomUUID();
  const inspect = (owner: string) =>
    db.transaction(owner, async (sql) => {
      const row = (
        await sql.query(
          "SELECT current_setting('app.user_id') AS owner, current_setting('lock_timeout') AS timeout",
        )
      ).rows[0];
      assert.equal(row.owner, owner);
      assert.equal(row.timeout, '5s');
      return row.owner;
    });
  assert.equal(await inspect(first), first);
  assert.deepEqual(
    calls.map((q) => q.text),
    [
      "BEGIN; SET LOCAL lock_timeout = '5000ms'",
      "SELECT set_config('app.user_id',$1,true)",
      "SELECT current_setting('app.user_id') AS owner, current_setting('lock_timeout') AS timeout",
      'COMMIT',
    ],
  );
  assert.deepEqual(calls[1]!.values, [first]);
  const outside = await db.pool.query(
    "SELECT current_setting('app.user_id',true) AS owner, current_setting('lock_timeout') AS timeout",
  );
  assert.equal(outside.rows[0].owner, '');
  assert.equal(outside.rows[0].timeout, '0');
  await assert.rejects(
    db.transaction(randomUUID(), async (sql) => {
      await sql.query('CREATE TEMP TABLE setup_rollback_probe(value integer)');
      throw Error('CALLBACK_FAILURE');
    }),
    /CALLBACK_FAILURE/,
  );
  assert.equal(
    (await db.pool.query("SELECT to_regclass('pg_temp.setup_rollback_probe') AS name")).rows[0]
      .name,
    null,
  );
  assert.ok(calls.some((q) => q.text === 'ROLLBACK'));
  assert.equal((await inspect(randomUUID())) !== first, true);
});
