import { authenticated, endpoint, HttpError, json } from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';

export const runtime = 'nodejs';
export const maxDuration = 240;

/** Deliver one already-committed Director opportunity; never create a new Director decision. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const world = Id.safeParse((await context.params).id);
    if (!world.success) throw new HttpError('NOT_FOUND', 404);
    return json({ result: await s.dispatchDirectorEpisode(s.ownerId, world.data) });
  });
}
