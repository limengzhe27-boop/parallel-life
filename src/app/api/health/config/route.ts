import { json } from '../../../../server/http.ts';
export const runtime = 'nodejs';
export async function GET() {
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
  });
}
