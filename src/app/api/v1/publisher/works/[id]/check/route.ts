import { publisherRoute } from '../../../../../../../server/publisher-services.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publisherRoute(request, 'check', id);
}
