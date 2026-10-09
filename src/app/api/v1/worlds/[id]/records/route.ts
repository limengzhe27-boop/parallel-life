import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { PlayerRecordsSchema } from '../../../../../../contracts/world-records.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    return json(PlayerRecordsSchema.parse(await s.records.read(s.ownerId, worldId.data)));
  });
}
