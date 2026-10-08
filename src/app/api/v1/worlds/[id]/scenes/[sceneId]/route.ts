import { authenticated, endpoint, json, HttpError } from '../../../../../../../server/http.ts';
import { Id } from '../../../../../../../contracts/api.ts';
import { SceneReadSchema } from '../../../../../../../contracts/scenes.ts';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; sceneId: string }> },
) {
  return endpoint(async () => {
    const s = await authenticated(request),
      p = await context.params;
    return json(
      SceneReadSchema.parse(await s.scenes.read(s.ownerId, pathId(p.id), pathId(p.sceneId))),
    );
  });
}

function pathId(value: string) {
  const id = Id.safeParse(value);
  if (!id.success) throw new HttpError('INVALID_INPUT', 422);
  return id.data;
}
