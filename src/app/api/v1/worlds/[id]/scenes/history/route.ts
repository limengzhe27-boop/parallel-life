import { authenticated, endpoint, json, HttpError } from '../../../../../../../server/http.ts';
import { Id, Version } from '../../../../../../../contracts/api.ts';
import { SceneHistorySchema } from '../../../../../../../contracts/scenes.ts';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    const raw = new URL(request.url).searchParams.get('before');
    const before = raw === null ? undefined : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!worldId.success || (before !== undefined && !Version.safeParse(before).success))
      throw new HttpError('INVALID_INPUT', 422);
    return json(SceneHistorySchema.parse(await s.scenes.history(s.ownerId, worldId.data, before)));
  });
}
