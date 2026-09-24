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
const ClockControlSchema = z
  .strictObject({
    paused: z.boolean().optional(),
    speed: z.number().min(0).max(60).optional(),
  })
  .refine((input) => input.paused !== undefined || input.speed !== undefined, {
    message: 'paused or speed is required',
  });
/** The life's clock: story time, speed, pause state and the last offline summary. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    return json(await s.readWorldClock(s.ownerId, worldId.data));
  });
}
/** Pause/resume or change the speed. A paused world costs nothing and never moves. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = ClockControlSchema.parse(await parseBody(request, ClockControlSchema));
    await s.setWorldClock(s.ownerId, worldId.data, input);
    return json({
      status: 'committed' as const,
      ...(await s.readWorldClock(s.ownerId, worldId.data)),
    });
  });
}
