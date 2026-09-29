import { timingSafeEqual } from 'node:crypto';
import { endpoint, HttpError, json } from '../../../../server/http.ts';
import { runScheduledWorlds } from '../../../../server/scheduler.ts';

export const runtime = 'nodejs';
export const maxDuration = 240;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  return endpoint(async () => {
    if (!authorized(request.headers.get('authorization'), process.env.CRON_SECRET))
      throw new HttpError('UNAUTHORIZED', 401);
    return json(await runScheduledWorlds());
  });
}
