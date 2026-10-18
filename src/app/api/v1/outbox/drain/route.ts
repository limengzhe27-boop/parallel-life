import { authenticated, endpoint, json } from '../../../../../server/http.ts';
import { requestLimit } from '../../../../../server/limits.ts';
import { after } from 'next/server';
import { runOwnedTask } from '../../../../../server/run-task.ts';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Dispatches this life's durable outbox jobs into the task queue. Owner-scoped and
 * idempotent (the job id is the idempotency key), so the client may call it again
 * after a failure or a resume without duplicating work.
 */
export async function POST(request: Request) {
  return endpoint(async () => {
    const s = await authenticated(request);
    await requestLimit(s.db, s.ownerId);
    const drain = await s.drainOutbox(s.ownerId);
    if (drain.taskIds?.length) {
      try {
        after(async () => {
          for (const taskId of drain.taskIds) {
            try {
              await runOwnedTask(s.ownerId, taskId);
            } catch (err) {
              console.warn(
                JSON.stringify({
                  scope: 'drain-after-task-run',
                  taskId,
                  code: (err as { code?: string })?.code ?? 'FAILED',
                }),
              );
            }
          }
        });
      } catch {
        // Fall through
      }
    }
    return json(drain);
  });
}
