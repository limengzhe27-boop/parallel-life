import { publisherStartTrialRoute } from '../../../../../../../server/publisher-world-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publisherStartTrialRoute(request, (await context.params).id, true);
}
