import {
  authenticated,
  endpoint,
  json,
  parseBody,
  HttpError,
} from '../../../../../../../../server/http.ts';
import { requestLimit } from '../../../../../../../../server/limits.ts';
import { Id } from '../../../../../../../../contracts/api.ts';
import { SceneLeaveSchema, SceneReceiptSchema } from '../../../../../../../../contracts/scenes.ts';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; sceneId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params,
      id = pathId(p.id),
      sceneId = pathId(p.sceneId);
    await requestLimit(s.db, s.ownerId);
    const input = await parseBody(request, SceneLeaveSchema);
    return json(
      SceneReceiptSchema.parse(await s.scenes.navigate(s.ownerId, id, sceneId, input, true)),
      200,
    );
  });
}

function pathId(value: string) {
  const id = Id.safeParse(value);
  if (!id.success) throw new HttpError('INVALID_INPUT', 422);
  return id.data;
}
