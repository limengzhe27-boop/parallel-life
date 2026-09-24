import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { z } from 'zod';
export const runtime = 'nodejs';
const DirectionSchema = z.strictObject({
  guidance: z.string().trim().max(500).optional(),
  themes: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  pacing: z.enum(['slow', 'normal', 'fast']).optional(),
  focusActorIds: z.array(Id).max(3).optional(),
  /** Describe the impact without applying it. */
  preview: z.boolean().optional(),
  /** Only the future can be directed; 'past' is refused with a pointer to branches. */
  move: z.enum(['future', 'past']).optional(),
});
/** This life's director brief: what the user asked the director to do. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    return json(await s.readWorldDirection(s.ownerId, worldId.data));
  });
}
/**
 * Direct the future of this life: themes, pacing and who to focus on. With
 * `preview: true` nothing is saved and the impact is returned instead, so a big change
 * can be shown before it happens. Rewriting the past is refused — that is a branch.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = DirectionSchema.parse(await parseBody(request, DirectionSchema));
    try {
      return json(await s.setWorldDirection(s.ownerId, worldId.data, input));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'INVALID_COMMAND' || error.code === 'FORBIDDEN')
      )
        throw new HttpError('INVALID_INPUT', 422);
      throw error;
    }
  });
}
