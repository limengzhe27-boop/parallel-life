import { worldTimeWaitRoute } from '../../../../../../../server/world-time-http.ts';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return worldTimeWaitRoute(request, (await context.params).id);
}
