import { publisherPreparationRoute } from '../../../../../../../server/publisher-preparation-http.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherPreparationRoute(request, (await context.params).id, true);
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherPreparationRoute(request, (await context.params).id, true);
}
