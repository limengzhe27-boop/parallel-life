import pg, { type PoolClient } from 'pg';
export type SqlClient = PoolClient;
/** pg-pool only installs its own error listener while a client is idle. Checked-out
 * connections can fail between queries too; keep the process alive and discard them. */
const poolFailures = new WeakMap<pg.Pool, WeakSet<pg.Client>>();
export function observePoolClientFailures(pool: pg.Pool): WeakSet<pg.Client> {
  const existing = poolFailures.get(pool);
  if (existing) return existing;
  const failed = new WeakSet<pg.Client>();
  poolFailures.set(pool, failed);
  pool.on('connect', (client) => {
    client.on('error', () => failed.add(client));
  });
  return failed;
}
/** A transaction-local identity cannot leak when pooled connections change owners. */
export class PostgresDatabase {
  readonly pool: pg.Pool;
  constructor(url: string) {
    let connectionString = url;
    let ssl: { rejectUnauthorized: boolean } | undefined;
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        parsed.searchParams.delete('sslmode');
        connectionString = parsed.toString();
        ssl = { rejectUnauthorized: false };
      }
    } catch {
      /* Fallback to raw connection string if parsing fails. */
    }
    this.pool = new pg.Pool({
      connectionString,
      ssl,
      // Serverless invocations are many and short-lived. Keep each instance's
      // footprint small and release idle pooler slots immediately; one slow
      // archive must not multiply into hundreds of held Supabase clients.
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
    });
    observePoolClientFailures(this.pool);
    this.pool.on('error', () => {
      /* Request errors are surfaced without query text or secrets. */
    });
  }
  async transaction<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      // A slow archive must fail its own request, not queue every later request
      // behind a row lock until the connection pool is exhausted.
      // Fixed SQL only: keep identity parameterized in the next statement.
      await client.query("BEGIN; SET LOCAL lock_timeout = '5000ms'");
      await client.query("SELECT set_config('app.user_id',$1,true)", [ownerId]);
      const result = await run(client);
      if (observePoolClientFailures(this.pool).has(client))
        throw Object.assign(Error('DATABASE_CONNECTION_LOST'), { code: '08006' });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release(observePoolClientFailures(this.pool).has(client));
    }
  }
  async close() {
    await this.pool.end();
  }
}
