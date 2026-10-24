import pg, { type PoolClient } from 'pg';
export type SqlClient = PoolClient;
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
    this.pool.on('error', () => {
      /* Request errors are surfaced without query text or secrets. */
    });
  }
  async transaction<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A slow archive must fail its own request, not queue every later request
      // behind a row lock until the connection pool is exhausted.
      await client.query("SET LOCAL lock_timeout = '5000ms'");
      await client.query("SELECT set_config('app.user_id',$1,true)", [ownerId]);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
