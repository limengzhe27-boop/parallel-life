import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { adminClient } from '../scripts/db-admin.mjs';
import { localConfig } from '../scripts/local-config.mjs';

test('AUD-11: database roles and tables enforce NOBYPASSRLS and FORCE ROW LEVEL SECURITY', async () => {
  const admin = await adminClient('parallel_life_dev');
  try {
    // 1. Verify pl_app and pl_worker have rolbypassrls = false
    const roleRes = await admin.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('pl_app', 'pl_worker')`,
    );
    for (const row of roleRes.rows) {
      assert.equal(
        row.rolbypassrls,
        false,
        `Role ${row.rolname} MUST NOT bypass RLS (rolbypassrls should be false)`,
      );
      assert.equal(row.rolsuper, false, `Role ${row.rolname} MUST NOT be superuser`);
    }

    // 2. Verify all tables in parallel_life schema have rowsecurity and forcerowsecurity enabled
    const tablesRes = await admin.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'parallel_life' AND c.relkind = 'r'
    `);

    assert(
      tablesRes.rowCount && tablesRes.rowCount > 0,
      'Tables must exist in parallel_life schema',
    );
    for (const row of tablesRes.rows) {
      if (row.relname === 'world_scheduler_claims') {
        // This cross-owner claim table is reachable only inside a SECURITY
        // DEFINER function; none of the runtime roles may access it directly.
        for (const role of ['pl_app', 'pl_worker', 'pl_scheduler']) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            const access = await admin.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [
              role,
              'parallel_life.world_scheduler_claims',
              privilege,
            ]);
            assert.equal(
              access.rows[0].allowed,
              false,
              `${role} must not ${privilege} scheduler claims`,
            );
          }
        }
        continue;
      }
      assert.equal(
        row.relrowsecurity,
        true,
        `Table parallel_life.${row.relname} must have rowsecurity enabled`,
      );
      assert.equal(
        row.relforcerowsecurity,
        true,
        `Table parallel_life.${row.relname} must have forcerowsecurity enabled`,
      );
    }
  } finally {
    await admin.end();
  }
});

test('AUD-11: cross-tenant access is strictly blocked under pl_app role via RLS', async () => {
  const config = await localConfig();
  const appClientA = new pg.Client({
    host: '127.0.0.1',
    port: config.port,
    user: 'pl_app',
    password: config.appPassword,
    database: 'parallel_life_dev',
  });
  const appClientB = new pg.Client({
    host: '127.0.0.1',
    port: config.port,
    user: 'pl_app',
    password: config.appPassword,
    database: 'parallel_life_dev',
  });

  await appClientA.connect();
  await appClientB.connect();

  const userA = 'test_user_rls_a_' + Date.now();
  const userB = 'test_user_rls_b_' + Date.now();

  try {
    // Session A: set context to userA and insert an account
    await appClientA.query(`SET app.user_id = '${userA}'`);
    await appClientA.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      userA,
    ]);

    // Session B: set context to userB and insert an account
    await appClientB.query(`SET app.user_id = '${userB}'`);
    await appClientB.query(`INSERT INTO parallel_life.accounts (id, kind) VALUES ($1, 'guest')`, [
      userB,
    ]);

    // Session B attempts to read Session A's accounts
    const readAFromB = await appClientB.query(
      `SELECT * FROM parallel_life.accounts WHERE id = $1`,
      [userA],
    );
    assert.equal(readAFromB.rowCount, 0, 'User B must not see User A accounts');

    // Session B attempts to delete Session A's account
    const deleteAFromB = await appClientB.query(
      `DELETE FROM parallel_life.accounts WHERE id = $1`,
      [userA],
    );
    assert.equal(deleteAFromB.rowCount, 0, 'User B must not be able to delete User A accounts');

    // Verify User A can read own account
    const readAFromA = await appClientA.query(
      `SELECT * FROM parallel_life.accounts WHERE id = $1`,
      [userA],
    );
    assert.equal(readAFromA.rowCount, 1, 'User A should read own account');
  } finally {
    // Cleanup using admin
    await appClientA.end();
    await appClientB.end();

    const admin = await adminClient('parallel_life_dev');
    try {
      await admin.query(`DELETE FROM parallel_life.accounts WHERE id IN ($1, $2)`, [userA, userB]);
    } finally {
      await admin.end();
    }
  }
});
