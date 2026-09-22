import type { TaskLease, TaskOutcome } from '../domain/types.ts';
export interface WorkerQueue {
  claim(kinds: string[]): Promise<TaskLease | null>;
  renew(task: TaskLease): Promise<boolean>;
  finish(task: TaskLease, outcome: TaskOutcome): Promise<void>;
}
export type TaskHandler = (task: TaskLease, signal: AbortSignal) => Promise<void>;
/** Handler commits its result and terminal status atomically; errors never trigger automatic paid retries. */
export async function runOne(
  queue: WorkerQueue,
  handlers: Record<string, TaskHandler>,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return false;
  const task = await queue.claim(Object.keys(handlers));
  if (!task) return false;
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      if (!(await queue.renew(task))) abort.abort();
    } catch {
      abort.abort();
    } finally {
      renewing = false;
    }
  }, 20000);
  try {
    await handlers[task.kind]!(task, combined);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const uncertain = combined.aborted || code === 'TIMEOUT' || code === 'UPSTREAM_FAILED';
    const outcome: TaskOutcome = {
      status: uncertain ? 'unknown' : 'failed',
      errorCode: uncertain
        ? 'UNKNOWN'
        : code === 'INVALID_RESPONSE'
          ? 'INVALID_AI_OUTPUT'
          : 'AI_FAILED',
    };
    try {
      await queue.finish(task, outcome);
    } catch {
      /* A cancelled or fenced task must never receive a late result. */
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
