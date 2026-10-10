import {
  authenticated,
  endpoint,
  HttpError,
  json,
  parseBody,
} from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';
import { TravelRequestSchema } from '../../../../../../../contracts/world-space.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, TravelRequestSchema);
    return json(await s.space.travel(s.ownerId, id.data, input));
  });
}
