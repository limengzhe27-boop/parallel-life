import { authenticated, endpoint, json, HttpError, parseBody } from './http.ts';
import { Id } from '../contracts/api.ts';
import { requestLimit } from './limits.ts';
import { z } from 'zod';
import { readNpcAgentStoryProgressIfEnabled } from './npc-agent-advance-services.ts';

/** Explicit owner recovery only: cannot choose a node or start a new director opportunity. */
export function publicationStoryRetryRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(
      request,
      z.strictObject({ claimId: Id, confirmRetry: z.literal(true) }),
    );
    await requestLimit(s.db, s.ownerId);
    await s.worlds.get({ userId: s.ownerId }, worldId);
    return json({
      status: 'advanced',
      worldId,
      ...(await s.advanceStoryOnly(s.ownerId, worldId, false, input.claimId)),
    });
  });
}

export function publicationStoryProgressRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    await s.worlds.get({ userId: s.ownerId }, worldId);
    return json(
      (await readNpcAgentStoryProgressIfEnabled(s.db, s.ownerId, worldId)) ??
        (await s.story.progress(s.ownerId, worldId)),
    );
  });
}
/** Staff-private transport may run one approved opportunity; there is no input for arbitrary plot edits. */
export function publicationStoryAdvanceRoute(
  request: Request,
  worldId: string,
  staffTrial = false,
) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!staffTrial) throw new HttpError('FORBIDDEN', 403);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    await s.worlds.get({ userId: s.ownerId }, worldId);
    const result = await s.advanceStoryOnly(s.ownerId, worldId, false);
    return json({ status: 'advanced', worldId, ...result });
  });
}
