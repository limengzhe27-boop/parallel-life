import { authenticated, endpoint, json } from '../../../../../server/http.ts';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Owner-only read-only schema readiness check. */
export async function GET(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.schemaStatus(s.ownerId));
  });
}
