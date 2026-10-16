import { publisherRoute } from '../../../../../server/publisher-services.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return publisherRoute(request, 'session');
}
export function POST(request: Request) {
  return publisherRoute(request, 'login');
}
export function DELETE(request: Request) {
  return publisherRoute(request, 'logout');
}
