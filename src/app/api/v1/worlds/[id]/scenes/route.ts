import {
  authenticated,
  endpoint,
  json,
  parseBody,
  HttpError,
} from '../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../server/limits.ts';
import { Id } from '../../../../../../contracts/api.ts';
import {
  SceneEnterSchema,
  SceneReadSchema,
  SceneReceiptSchema,
} from '../../../../../../contracts/scenes.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = pathId((await context.params).id);
    return json(SceneReadSchema.parse(await s.scenes.read(s.ownerId, id)));
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      id = pathId((await context.params).id);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, SceneEnterSchema);
    return json(SceneReceiptSchema.parse(await s.scenes.enter(s.ownerId, id, input)), 202);
  });
}

function pathId(value: string) {
  const id = Id.safeParse(value);
  if (!id.success) throw new HttpError('INVALID_INPUT', 422);
  return id.data;
}
