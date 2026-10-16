import { publisherMediaFinalizeRoute } from '@/server/publisher-media-http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id, assetId } = await context.params;
  return publisherMediaFinalizeRoute(request, id, assetId);
}
