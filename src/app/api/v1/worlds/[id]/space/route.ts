import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { Id } from '../../../../../../contracts/api.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    return json(await s.space.read(s.ownerId, id.data));
  });
}
