import { publicationOpeningRoute } from '../../../../../../server/publication-opening-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicationOpeningRoute(request, (await context.params).id);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicationOpeningRoute(request, (await context.params).id);
}
