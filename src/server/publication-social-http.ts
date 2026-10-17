import { authenticated, endpoint, HttpError, json } from './http.ts';
import { Id } from '../contracts/api.ts';
import {
  readPublicationSocial,
  mergeSocialMoments,
} from '../modules/settings/infrastructure/publication-social-repository.ts';
export function publicationSocialRoute(request: Request, id: string) {
  return endpoint(async () => {
    const s = await authenticated(request),
      worldId = Id.safeParse(id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    const world = await s.worlds.get({ userId: s.ownerId }, worldId.data);
    const authoredSocial = await readPublicationSocial(s.db, s.ownerId, worldId.data);
    return json(mergeSocialMoments(authoredSocial, world.moments));
  });
}
