import { authenticated, endpoint, json, HttpError } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { Id } from '../../../../../contracts/api.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      { id } = await context.params;
    if (!Id.safeParse(id).success) throw new HttpError('NOT_FOUND', 404);
    await requestLimit(s.db, s.ownerId);
    return json(await s.tasks.get(s.ownerId, id));
  });
}
