import { authenticated, endpoint, HttpError, json } from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Owner-only repair for a durable unknown director attempt; never resends the old call. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async (http) => {
    const s = await authenticated(request);
    const world = Id.safeParse((await context.params).id);
    if (!world.success) throw new HttpError('NOT_FOUND', 404);
    let retired: number;
    try {
      retired = await s.retireUnknownDirector(s.ownerId, world.data);
    } catch (error) {
      console.error('DIRECTOR_RECOVERY_FAILED', error);
      throw error;
    }
    return json({ retired });
  });
}
