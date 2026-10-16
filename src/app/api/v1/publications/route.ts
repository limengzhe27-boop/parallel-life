import { publishedCatalogRoute } from '../../../../server/publisher-world-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  return publishedCatalogRoute(request);
}
