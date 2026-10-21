import { authenticated, endpoint, HttpError, json } from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Owner-only read of the latest director attempt and audit; no mutation. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const world = Id.safeParse((await context.params).id);
    if (!world.success) throw new HttpError('NOT_FOUND', 404);
    return json({ latest: await s.directorStatus(s.ownerId, world.data) });
  });
}
