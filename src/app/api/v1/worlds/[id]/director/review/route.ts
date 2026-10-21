import { authenticated, endpoint, HttpError, json } from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';

export const runtime = 'nodejs';
export const maxDuration = 240;

/** Owner-authorized immediate review; still requires source/eligibility and actor choice. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const world = Id.safeParse((await context.params).id);
    if (!world.success) throw new HttpError('NOT_FOUND', 404);
    try {
      return json({ result: await s.forceDirectorReview(s.ownerId, world.data) });
    } catch (error) {
      console.error('DIRECTOR_FORCE_REVIEW_FAILED', error);
      return json({
        error: {
          name: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message : String(error),
          code: (error as { code?: unknown } | null)?.code ?? null,
        },
      });
    }
  });
}
