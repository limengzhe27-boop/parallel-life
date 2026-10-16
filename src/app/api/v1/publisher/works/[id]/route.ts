import { publisherRoute } from '../../../../../../server/publisher-services.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publisherRoute(request, 'get', id);
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publisherRoute(request, 'save', id);
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publisherRoute(request, 'rename', id);
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return publisherRoute(request, 'delete', id);
}
