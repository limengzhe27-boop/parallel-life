import { Id } from '../contracts/api.ts';
import {
  ClockActivityRequestSchema,
  WorldClockSchema,
  clockResponse,
  WORLD_TIME_PROTOCOL_HEADER,
  WORLD_TIME_PROTOCOL,
} from '../contracts/world-clock.ts';
import { StoryWaitRequestSchema, StoryWaitReceiptSchema } from '../contracts/story-wait.ts';
import { authenticated, endpoint, HttpError, json, parseBody } from './http.ts';
import { requestLimit } from './limits.ts';
import { StoryWaitError } from '../modules/world/domain/story-wait.ts';
import { randomUUID } from 'node:crypto';
export function worldTimeActivityRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, ClockActivityRequestSchema);
    return json(
      clockResponse(
        WorldClockSchema.parse(await s.updateClockActivity(s.ownerId, worldId, input)),
        request.headers.get(WORLD_TIME_PROTOCOL_HEADER) === WORLD_TIME_PROTOCOL,
      ),
    );
  });
}
export function worldTimeWaitRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, StoryWaitRequestSchema);
    try {
      return json(StoryWaitReceiptSchema.parse(await s.waitStoryTime(s.ownerId, worldId, input)));
    } catch (error) {
      if (error instanceof StoryWaitError)
        return json(
          {
            error: {
              code: 'INVALID_COMMAND',
              message: error.message,
              retryable: false,
              requestId: randomUUID(),
            },
          },
          422,
        );
      throw error;
    }
  });
}
