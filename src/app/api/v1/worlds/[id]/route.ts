import { authenticated, endpoint, HttpError, json } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    /* A malformed id is the caller's mistake, not an unavailable service. */
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    return json(await s.builds.phone(s.ownerId, worldId.data));
  });
}
