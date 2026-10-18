import { worldMessageRoute } from '../../../../../../server/world-message-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 240;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return worldMessageRoute(request, (await context.params).id);
}
