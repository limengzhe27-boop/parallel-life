import { authenticated, endpoint, HttpError, json } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
import { WorldPatchRequestSchema } from '../../../../../contracts/life-management.ts';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    /* A malformed id is the caller's mistake, not an unavailable service. */
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);
    return json(await s.builds.phone(s.ownerId, worldId.data));
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    const body = await request.json().catch(() => ({}));
    const parsed = WorldPatchRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpError('INVALID_INPUT', 400);

    const req = parsed.data;
    let result: Record<string, unknown> = { id: worldId.data };

    if (req.title !== undefined) {
      const renamed = await s.worlds.renameWorld(s.ownerId, worldId.data, req.title);
      result = { ...result, ...renamed };
    }

    if (req.action === 'archive') {
      const archived = await s.worlds.archiveWorld(s.ownerId, worldId.data);
      result = { ...result, ...archived };
    } else if (req.action === 'restore') {
      const restored = await s.worlds.restoreWorld(s.ownerId, worldId.data);
      result = { ...result, ...restored };
    }

    return json(result);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request);
    const worldId = Id.safeParse((await context.params).id);
    if (!worldId.success) throw new HttpError('NOT_FOUND', 404);

    const deleted = await s.worlds.deleteWorld(s.ownerId, worldId.data);
    return json(deleted);
  });
}
