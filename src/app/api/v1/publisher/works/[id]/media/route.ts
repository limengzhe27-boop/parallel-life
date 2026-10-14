import { publisherMediaBeginRoute } from '@/server/publisher-media-http.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherMediaBeginRoute(request, (await context.params).id);
}
