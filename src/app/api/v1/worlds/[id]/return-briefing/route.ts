import {
  ReturnBriefingReceiptSchema,
  ReturnBriefingRequestSchema,
} from '../../../../../../contracts/world-clock.ts';
import { authenticated, endpoint, HttpError, json, parseBody } from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Runs the one bounded offline catch-up. Idempotent per (world, left_at) row. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = ReturnBriefingRequestSchema.parse(await parseBody(request, ReturnBriefingRequestSchema));
    return json(
      ReturnBriefingReceiptSchema.parse(
        await s.runReturnBriefing(s.ownerId, worldId.data, input.briefingId),
      ),
    );
  });
}
