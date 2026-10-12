import { appointmentWaitRoute } from '../../../../../../../server/appointment-wait-http.ts';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return appointmentWaitRoute(request, (await context.params).id);
}
