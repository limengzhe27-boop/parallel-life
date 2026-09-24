import { authenticated, endpoint, json } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
export const runtime = 'nodejs';
/**
 * Dispatches this life's durable outbox jobs into the task queue. Owner-scoped and
 * idempotent (the job id is the idempotency key), so the client may call it again
 * after a failure or a resume without duplicating work.
 */
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    return json(await s.drainOutbox(s.ownerId));
  });
}
