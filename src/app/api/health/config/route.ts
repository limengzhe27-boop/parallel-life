import pg from 'pg';
import { PostgresDatabase } from '../../../../../modules/storage/infrastructure/postgres.ts';
import { json } from '../../../../server/http.ts';
export const runtime = 'nodejs';
export async function GET() {
  let database: { ok: boolean; code?: string } = { ok: false };
  if (process.env.APP_DATABASE_URL) {
    const parsed = new URL(process.env.APP_DATABASE_URL);
    parsed.searchParams.delete('sslmode');
    const client = new pg.Client({
      connectionString: parsed.toString(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      await client.query('select 1');
      database = { ok: true };
    } catch (error) {
      database = { ok: false, code: String((error as { code?: unknown })?.code ?? 'FAILED') };
    } finally {
      await client.end().catch(() => {});
    }
  }
  let appProbe: { ok: boolean; code?: string } = { ok: false };
  if (process.env.APP_DATABASE_URL) {
    const db = new PostgresDatabase(process.env.APP_DATABASE_URL);
    try {
      await db.transaction('probe', async (sql) => {
        await sql.query('select 1');
      });
      appProbe = { ok: true };
    } catch (error) {
      appProbe = { ok: false, code: String((error as { code?: unknown })?.code ?? 'FAILED') };
    } finally {
      await db.pool.end().catch(() => {});
    }
  }
  const raw = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  let dbUser: string | null = null;
  try {
    dbUser = raw ? decodeURIComponent(new URL(raw).username).split('.')[0]! : null;
  } catch {
    dbUser = 'invalid-url';
  }
  return json({
    appDatabase: !!process.env.APP_DATABASE_URL,
    databaseFallback: !!process.env.DATABASE_URL,
    sessionSecret: !!process.env.SESSION_SECRET,
    appOrigin: process.env.APP_ORIGIN ?? null,
    dbUser,
    supabaseUrl: !!process.env.SUPABASE_URL,
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    yibuKey: !!process.env.YIBU_API_KEY,
    database,
    appProbe,
  });
}
