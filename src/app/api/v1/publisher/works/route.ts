import { publisherRoute } from '../../../../../server/publisher-services.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return publisherRoute(request, 'list');
}
export function POST(request: Request) {
  return publisherRoute(request, 'create');
}
