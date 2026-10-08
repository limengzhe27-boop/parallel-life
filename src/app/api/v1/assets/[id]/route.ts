import { authenticated, endpoint, HttpError } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      { id } = await context.params;
    if (!Id.safeParse(id).success) throw new HttpError('NOT_FOUND', 404);
    const params = new URL(request.url).searchParams,
      worldId = params.get('worldId'),
      revision = Number(params.get('revision'));
    if (worldId && (!Id.safeParse(worldId).success || !Number.isInteger(revision) || revision < 1))
      throw new HttpError('NOT_FOUND', 404);
    const bytes = worldId
      ? await s.assets.readForWorld(s.ownerId, worldId, id, revision)
      : await s.assets.read(s.ownerId, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  });
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      { id } = await context.params;
    if (!Id.safeParse(id).success) throw new HttpError('NOT_FOUND', 404);
    if (new URL(request.url).searchParams.get('onlyIfUnused') === '1')
      await s.assets.discardUnreferencedUpload(s.ownerId, id);
    else await s.assets.remove(s.ownerId, id);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  });
}
