import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresClockStore } from '../src/modules/world/infrastructure/clock-repository.ts';
import type { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';

/** Autocommit rotates physical backends; BEGIN pins one until COMMIT/ROLLBACK. */
class TransactionPool {
  backends = [0, 1, 2].map((id) => ({
    id,
    pinned: false,
    session: new Set<string>(),
    transaction: new Set<string>(),
  }));
  next = 0;
  calls: string[] = [];
  releases: boolean[] = [];
  failCommit = false;
  failRollback = false;
  async connect() {
    let pinned: TransactionPool['backends'][number] | undefined;
    const pick = () => {
      for (let i = 0; i < this.backends.length; i++) {
        const backend = this.backends[this.next++ % this.backends.length]!;
        if (!backend.pinned) return backend;
      }
      throw new Error('NO_FREE_BACKEND');
    };
    return {
      query: async (
        sql: string,
        values: unknown[] = [],
      ): Promise<{ rows: Record<string, boolean>[] }> => {
        this.calls.push(sql);
        const backend = pinned ?? pick();
        const key = String(values[0]);
        if (sql === 'BEGIN') {
          pinned = backend;
          backend.pinned = true;
          return { rows: [] };
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if ((sql === 'COMMIT' && this.failCommit) || (sql === 'ROLLBACK' && this.failRollback))
            throw new Error(`${sql}_FAILED`);
          backend.transaction.clear();
          backend.pinned = false;
          pinned = undefined;
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_unlock'))
          return { rows: [{ unlocked: backend.session.delete(key) }] };
        if (sql.includes('pg_try_advisory')) {
          const available = !this.backends.some(
            (other) => other !== backend && (other.session.has(key) || other.transaction.has(key)),
          );
          if (available) {
            if (sql.includes('pg_try_advisory_xact_lock')) {
              backend.transaction.add(key);
              if (!pinned) backend.transaction.delete(key);
            } else backend.session.add(key);
          }
          return { rows: [{ locked: available }] };
        }
        throw new Error('UNEXPECTED_QUERY');
      },
      release: (discard = false) => {
        this.releases.push(discard);
        if (discard && pinned) {
          pinned.transaction.clear();
          pinned.pinned = false;
          pinned = undefined;
        }
      },
    };
  }
  store() {
    return new PostgresClockStore({ pool: this } as unknown as PostgresDatabase);
  }
}
test('counterexample: separate session lock/unlock statements can leak on a transaction pool', async () => {
  const pool = new TransactionPool();
  const client = await pool.connect();
  assert.equal(
    (await client.query('SELECT pg_try_advisory_lock($1) AS locked', ['world'])).rows[0]!.locked,
    true,
  );
  assert.equal(
    (await client.query('SELECT pg_advisory_unlock($1) AS unlocked', ['world'])).rows[0]!.unlocked,
    false,
  );
  assert.ok(pool.backends.some((backend) => backend.session.has('world')));
});
test('advance pins its lock to a transaction, blocks concurrent advance, and releases after commit', async () => {
  const pool = new TransactionPool(),
    store = pool.store();
  let competingRan = false;
  const answer = await store.withAdvanceLock('world', async () => {
    assert.ok(pool.backends.some((backend) => backend.transaction.has('world')));
    await assert.rejects(
      store.withAdvanceLock('world', async () => {
        competingRan = true;
      }),
      /VERSION_CONFLICT|导演正在处理/,
    );
    return 42;
  });
  assert.equal(answer, 42);
  assert.equal(competingRan, false);
  assert.deepEqual(pool.releases, [false, false]);
  assert.ok(pool.calls.includes('ROLLBACK'));
  assert.equal(pool.calls.at(-1), 'COMMIT');
  assert.ok(!pool.calls.some((sql) => sql.includes('pg_advisory_unlock')));
  assert.ok(
    pool.backends.every((backend) => backend.transaction.size === 0 && backend.session.size === 0),
  );
  assert.equal(await store.withAdvanceLock('world', async () => 'again'), 'again');
});
test('callback failure rolls back the lock, preserves the error and releases exactly once', async () => {
  const pool = new TransactionPool(),
    failure = new Error('CHARACTER_FAILED');
  await assert.rejects(
    pool.store().withAdvanceLock('world', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(pool.calls.at(-1), 'ROLLBACK');
  assert.deepEqual(pool.releases, [false]);
  assert.ok(pool.backends.every((backend) => backend.transaction.size === 0));
  assert.equal(await pool.store().withAdvanceLock('world', async () => 'recovered'), 'recovered');
});
test('commit failure rolls back; rollback failure destroys the connection without replacing the original error', async () => {
  for (const failedRollback of [false, true]) {
    const pool = new TransactionPool();
    pool.failCommit = true;
    pool.failRollback = failedRollback;
    await assert.rejects(
      pool.store().withAdvanceLock('world', async () => 1),
      /COMMIT_FAILED/,
    );
    assert.deepEqual(pool.releases, [failedRollback]);
    assert.equal(pool.calls.at(-1), 'ROLLBACK');
    assert.ok(pool.backends.every((backend) => backend.transaction.size === 0));
  }
});
test('nested same-world advance on another pooled connection is an explicit conflict, never reentrant', async () => {
  const pool = new TransactionPool(),
    store = pool.store();
  await store.withAdvanceLock('world', async () => {
    await assert.rejects(
      store.withAdvanceLock('world', async () => 'nested'),
      /VERSION_CONFLICT|导演正在处理/,
    );
    assert.equal(
      await store.withAdvanceLock('other-world', async () => 'independent'),
      'independent',
    );
  });
  assert.deepEqual(pool.releases, [false, false, false]);
});
