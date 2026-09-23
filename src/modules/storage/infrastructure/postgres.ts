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
      max: 8,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
    this.pool.on('error', () => {
      /* Request errors are surfaced without query text or secrets. */
    });
  }
  async transaction<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
