import { createHash, timingSafeEqual } from 'node:crypto';
import { endpoint, HttpError, json } from '../../../../server/http.ts';
import { runProactiveWorlds } from '../../../../server/scheduler.ts';
import { verifyGitHubActionsToken } from '../../../../server/github-oidc.ts';
import { getServices } from '../../../../server/services.ts';

export const runtime = 'nodejs';
export const maxDuration = 300;

function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function databaseTokenMatches(header: string | null): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const hash = createHash('sha256').update(header.slice(7)).digest('hex');
  try {
    return await getServices().verifyCronToken(hash);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  return endpoint(async () => {
    const authorization = request.headers.get('authorization');
    if (
      !bearerMatches(authorization, process.env.CRON_SECRET) &&
      !(await verifyGitHubActionsToken(authorization)) &&
      !(await databaseTokenMatches(authorization))
    )
      throw new HttpError('UNAUTHORIZED', 401);
    return json(await runProactiveWorlds());
  });
}
