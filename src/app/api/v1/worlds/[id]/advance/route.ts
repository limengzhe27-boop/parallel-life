import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
export const runtime = 'nodejs';
export const maxDuration = 240;
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
    const input = await request.json().catch(() => ({}));
    const automatic = Boolean(
      input && typeof input === 'object' && 'automatic' in input && input.automatic === true,
    );
    try {
      const result = await s.advanceWorld(
        s.ownerId,
        worldId.data,
        automatic ? 1 : undefined,
        automatic,
      );
      return json({ status: 'advanced' as const, worldId: worldId.data, ...result });
    } catch (error) {
      console.error(
        JSON.stringify({
          scope: 'advance-endpoint-failure',
          code: (error as { code?: unknown })?.code ?? null,
          message:
            error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 100),
          stack: error instanceof Error ? error.stack?.split('\n').slice(0, 8) : [],
        }),
      );
      throw error;
    }
  });
}
