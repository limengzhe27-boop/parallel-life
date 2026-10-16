import { publicationStoryProgressRoute } from '../../../../../../server/publication-story-http.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicationStoryProgressRoute(request, (await context.params).id);
}
