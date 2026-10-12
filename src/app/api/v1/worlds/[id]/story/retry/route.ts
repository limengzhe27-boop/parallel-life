import { publicationStoryRetryRoute } from '../../../../../../../server/publication-story-http.ts';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicationStoryRetryRoute(request, (await context.params).id);
}
