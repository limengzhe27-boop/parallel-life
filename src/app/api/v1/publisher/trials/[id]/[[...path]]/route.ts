import { publisherTrialRoute } from '../../../../../../../server/publisher-world-http.ts';
export const runtime = 'nodejs';
export const maxDuration = 120;
async function handle(
  request: Request,
  context: { params: Promise<{ id: string; path?: string[] }> },
) {
  const p = await context.params;
  return publisherTrialRoute(request, p.id, p.path ?? []);
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
