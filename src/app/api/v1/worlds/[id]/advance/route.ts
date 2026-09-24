import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
export const runtime = 'nodejs';
/**
 * Moves this life's clock and lets a bounded number of beats happen on their own.
 *
 * Time is computed from real elapsed time, not simulated: at most MAX_BEATS_PER_ADVANCE
 * beats are played (each at most one model call) and the rest are folded into a summary.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const result = await s.advanceWorld(s.ownerId, worldId.data);
    return json({ status: 'advanced' as const, worldId: worldId.data, ...result });
  });
}
