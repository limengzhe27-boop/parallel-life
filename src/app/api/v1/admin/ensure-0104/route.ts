import { authenticated, endpoint, json } from '../../../../../server/http.ts';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** One-shot owner maintenance route for the missing plan-review migration. */
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    return json(await s.ensure0104(s.ownerId));
  });
}
