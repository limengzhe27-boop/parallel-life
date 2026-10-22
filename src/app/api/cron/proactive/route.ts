import { timingSafeEqual } from 'node:crypto';
import { endpoint, HttpError, json } from '../../../../server/http.ts';
import { runProactiveWorlds } from '../../../../server/scheduler.ts';
import { verifyGitHubActionsToken } from '../../../../server/github-oidc.ts';

export const runtime = 'nodejs';
export const maxDuration = 300;

function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  return endpoint(async () => {
    const authorization = request.headers.get('authorization');
    if (
      !bearerMatches(authorization, process.env.CRON_SECRET) &&
      !(await verifyGitHubActionsToken(authorization))
    )
      throw new HttpError('UNAUTHORIZED', 401);
    return json(await runProactiveWorlds());
  });
}
