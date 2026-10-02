import { authenticated, endpoint, HttpError } from '../../../../../server/http.ts';
import { Id } from '../../../../../contracts/api.ts';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const s = await authenticated(request),
      { id } = await context.params;
    if (!Id.safeParse(id).success) throw new HttpError('NOT_FOUND', 404);
    return new Response(new Uint8Array(await s.assets.read(s.ownerId, id)), {
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
