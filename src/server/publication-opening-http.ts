import { z } from 'zod';
import { Id } from '../contracts/api.ts';
import { OpeningStatusSchema, OpeningAdvanceSchema } from '../contracts/publication-opening.ts';
import { openingStatus } from '../modules/settings/application/publication-opening-ports.ts';
import { PublicationOpeningRepository } from '../modules/settings/infrastructure/publication-opening-repository.ts';
import { authenticated, endpoint, HttpError, json, parseBody } from './http.ts';
import { requestLimit } from './limits.ts';
import { readNpcAgentOpeningStatusIfEnabled } from './npc-agent-advance-services.ts';
export function publicationOpeningRoute(request: Request, worldId: string) {
  return endpoint(async () => {
    const s = await authenticated(request);
    if (!Id.safeParse(worldId).success) throw new HttpError('NOT_FOUND', 404);
    await s.worlds.get({ userId: s.ownerId }, worldId);
    await requestLimit(s.db, s.ownerId);
    const opening = new PublicationOpeningRepository(s.db);
    const readStatus = async () =>
      (await readNpcAgentOpeningStatusIfEnabled(s.db, s.ownerId, worldId)) ??
      openingStatus(await opening.read(s.ownerId, worldId));
    if (request.method === 'GET') return json(OpeningStatusSchema.parse(await readStatus()));
    const input = await parseBody(
      request,
      z.strictObject({ confirmRetry: z.boolean().default(false) }),
    );
    const result = await s.advanceOpening(
      s.ownerId,
      worldId,
      !input.confirmRetry,
      input.confirmRetry,
    );
    const current = await readStatus();
    const clock = await s.readWorldClock(s.ownerId, worldId);
    return json(
      OpeningAdvanceSchema.parse({
        status: 'advanced',
        worldId,
        ...(result.result ?? {
          storyNow: clock.storyNow,
          played: 0,
          folded: 0,
          summary: null,
          actors: [],
        }),
        opening: current,
      }),
    );
  });
}
