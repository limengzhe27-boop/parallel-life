import { authenticated, endpoint, json, HttpError } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('INVALID_INPUT', 422);
    return json(await s.seeds.get(s.ownerId, id.data));
  });
}
