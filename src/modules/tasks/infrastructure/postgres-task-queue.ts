import pg, { type PoolClient } from 'pg';
import type { TaskLease, TaskOutcome } from '../domain/types.ts';
export type { TaskLease, TaskOutcome } from '../domain/types.ts';
export class LeaseLost extends Error {
  constructor() {
    super('LEASE_LOST');
  }
}
export class PostgresTaskQueue {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 4000 });
    this.pool.on('error', () => {});
  }
  async claim(kinds: string[]): Promise<TaskLease | null> {
    const row = (await this.pool.query('SELECT * FROM parallel_life.claim_task($1)', [kinds]))
      .rows[0];
    return row
      ? {
          id: row.id,
          ownerId: row.owner_id,
          kind: row.scope_kind,
          scopeId: row.scope_id,
          input: row.input,
          token: row.lease_token,
        }
      : null;
  }
  async claimForOwner(id: string, ownerId: string, kinds: string[]): Promise<TaskLease | null> {
    const row = (
      await this.pool.query('SELECT * FROM parallel_life.claim_task_for_owner($1,$2,$3)', [
        id,
        ownerId,
        kinds,
      ])
    ).rows[0];
    return row
      ? {
          id: row.id,
          ownerId: row.owner_id,
          kind: row.scope_kind,
          scopeId: row.scope_id,
          input: row.input,
          token: row.lease_token,
        }
      : null;
  }
  async renew(lease: TaskLease) {
    return !!(
      await this.pool.query('SELECT parallel_life.renew_task($1,$2) ok', [lease.id, lease.token])
    ).rows[0]?.ok;
  }
  async commit<T>(
    lease: TaskLease,
    apply: (sql: PoolClient) => Promise<{ value: T; outcome: TaskOutcome }>,
  ): Promise<T> {
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      await sql.query(
        "SELECT set_config('app.task_id',$1,true),set_config('app.lease_token',$2,true)",
        [lease.id, lease.token],
      );
      if (
        !(
          await sql.query(
            "SELECT id FROM parallel_life.tasks WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE",
            [lease.id, lease.token],
          )
        ).rowCount
      )
        throw new LeaseLost();
      const { value, outcome } = await apply(sql);
      const done = (
        await sql.query('SELECT parallel_life.finish_task($1,$2,$3,$4,$5,$6,$7,$8) ok', [
          lease.id,
          lease.token,
          outcome.status,
          outcome.errorCode ?? null,
          outcome.resultVersion ?? null,
          outcome.model ?? null,
          outcome.promptVersion ?? null,
          outcome.durationMs ?? null,
        ])
      ).rows[0]?.ok;
      if (!done) throw new LeaseLost();
      await sql.query('COMMIT');
      return value;
    } catch (error) {
      await sql.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      sql.release();
    }
  }
  async finish(lease: TaskLease, outcome: TaskOutcome) {
    return this.commit(lease, async () => ({ value: undefined, outcome }));
  }
  async read<T>(lease: TaskLease, query: (sql: PoolClient) => Promise<T>) {
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      await sql.query(
        "SELECT set_config('app.task_id',$1,true),set_config('app.lease_token',$2,true)",
        [lease.id, lease.token],
      );
      const result = await query(sql);
      await sql.query('COMMIT');
      return result;
    } catch (e) {
      await sql.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      sql.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
