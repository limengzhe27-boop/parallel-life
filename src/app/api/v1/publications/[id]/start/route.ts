import { publishedStartRoute } from '../../../../../../server/publisher-world-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publishedStartRoute(request, (await context.params).id);
}
