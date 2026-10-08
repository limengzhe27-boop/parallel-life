import { CreateGroupRequestSchema } from '../../../../../../contracts/world-experiences.ts';
import { Id } from '../../../../../../contracts/api.ts';
import {
  authenticated,
  endpoint,
  parseBody,
  json,
  HttpError,
} from '../../../../../../server/http.ts';
import { getGroupServices } from '../../../../../../server/group-services.ts';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    return json(await getGroupServices().list(s.ownerId, id.data));
  });
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = Id.safeParse((await context.params).id);
    if (!id.success) throw new HttpError('NOT_FOUND', 404);
    const input = await parseBody(request, CreateGroupRequestSchema);
    return json(await getGroupServices().create(s.ownerId, { worldId: id.data, ...input }));
  });
}
