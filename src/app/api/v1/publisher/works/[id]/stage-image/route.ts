import { publisherStageImageRoute } from '../../../../../../../server/publisher-stage-image-http.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherStageImageRoute(request, (await context.params).id);
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherStageImageRoute(request, (await context.params).id);
}
