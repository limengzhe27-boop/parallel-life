import { authenticated, endpoint, HttpError, json } from '../../../../../../server/http.ts';
import { Id } from '../../../../../../contracts/api.ts';
import { WorldForkRequestSchema } from '../../../../../../contracts/life-management.ts';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    const checkpoints = await s.worlds.getForkCheckpoints(s.ownerId, worldId.data);
    return json(checkpoints);
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    const body = await request.json().catch(() => ({}));
    const parsed = WorldForkRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError('INVALID_INPUT', 400);
    }

    const { forkVersion, title } = parsed.data;
    const forked = await s.worlds.forkWorld(s.ownerId, worldId.data, forkVersion, { title });
    return json({ world: forked }, 201);
  });
}
