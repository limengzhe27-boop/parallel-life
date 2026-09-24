import { OUTBOX_EXECUTORS, type OutboxJob } from '../domain/outbox.ts';

export type OutboxPort = {
  claim(limit: number): Promise<OutboxJob[]>;
  submitted(job: OutboxJob, taskId: string): Promise<void>;
  rejected(job: OutboxJob, reason: string): Promise<void>;
};
export type OutboxTaskPort = {
  /** Idempotent by the job's own id; returns the task created (or already present). */
  submit(job: OutboxJob): Promise<{ taskId: string; duplicate: boolean }>;
};
export type DispatchSummary = { claimed: number; submitted: number; rejected: number };

/**
 * Turns durable outbox jobs into queued tasks.
 *
 * The job id is the idempotency key, so re-dispatching after a crash or a lost
 * lease cannot queue the same work twice. A job whose type has no executor, or
 * whose payload is unusable, is rejected with a reason instead of being retried
 * forever — a silent drop would look like "nothing happened" in the phone.
 */
export async function dispatchOutbox(
  deps: { outbox: OutboxPort; tasks: OutboxTaskPort; limit?: number },
  log?: (message: string) => void,
): Promise<DispatchSummary> {
  const jobs = await deps.outbox.claim(deps.limit ?? 20);
  const summary: DispatchSummary = { claimed: jobs.length, submitted: 0, rejected: 0 };
  for (const job of jobs) {
    const executor = OUTBOX_EXECUTORS[job.payload.type];
    if (!executor) {
      await deps.outbox.rejected(job, `NO_EXECUTOR:${job.payload.type}`.slice(0, 200));
      summary.rejected += 1;
      log?.(`outbox job ${job.id} rejected: no executor for ${job.payload.type}`);
      continue;
    }
    let scopeId: string;
    try {
      scopeId = executor.scopeOf(job.payload);
    } catch (error) {
      await deps.outbox.rejected(job, String((error as Error).message).slice(0, 200));
      summary.rejected += 1;
      continue;
    }
    if (scopeId !== job.payload.requestId) {
      await deps.outbox.rejected(job, 'SCOPE_MISMATCH');
      summary.rejected += 1;
      continue;
    }
    try {
      const task = await deps.tasks.submit(job);
      await deps.outbox.submitted(job, task.taskId);
      summary.submitted += 1;
    } catch (error) {
      const reason = String((error as { code?: string })?.code ?? (error as Error).message);
      await deps.outbox.rejected(job, reason.slice(0, 200));
      summary.rejected += 1;
      log?.(`outbox job ${job.id} not dispatched: ${reason}`);
    }
  }
  return summary;
}
