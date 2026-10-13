import { publicationSocialRoute } from '../../../../../../server/publication-social-http.ts';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicationSocialRoute(request, (await context.params).id);
}
