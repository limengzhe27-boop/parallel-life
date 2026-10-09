import { ErrorCode } from '../../../contracts/api.ts';
import type { TaskLease, TaskOutcome } from '../domain/types.ts';

const ERROR_CODE_LIST = ErrorCode.options;
const ERROR_CODES = new Set<string>(ERROR_CODE_LIST);
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
  const started = performance.now();
  const abort = new AbortController();
  const combined = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    /* Never renew a lease for work we have already abandoned. */
    if (combined.aborted) return;
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
    const failure = error as {
      code?: string;
      model?: string;
      promptVersion?: string;
      durationMs?: number;
      upstreamDurationMs?: number;
      stage?: unknown;
      httpStatus?: unknown;
    };
    /*
     * A swallowed handler error is undiagnosable: a domain rule violation and an
     * upstream outage both surfaced as the same opaque "AI_FAILED". Log only
     * operational metadata — never user text or upstream bodies.
     */
    const detail =
      (error as Error)?.name === 'DomainError'
        ? String((error as Error).message).slice(0, 120)
        : ((error as { code?: string })?.code ??
          (error as { code?: string; constraint?: string })?.constraint ??
          (error as Error)?.name);
    /* Our own shutdown cancelled the call: the upstream may still have completed,
       so the outcome is unknown (never a silent failure and never auto-retried). */
    const uncertain =
      combined.aborted ||
      failure.code === 'CANCELLED' ||
      failure.code === 'TIMEOUT' ||
      failure.code === 'UPSTREAM_FAILED';
    const timing = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2147483647
        ? Math.round(value)
        : undefined;
    const durationMs = timing(failure.durationMs) ?? Math.round(performance.now() - started);
    const stage =
      typeof failure.stage === 'string' &&
      ['request', 'response', 'parse', 'stream', 'proposal'].includes(failure.stage)
        ? failure.stage
        : undefined;
    const httpStatus =
      typeof failure.httpStatus === 'number' &&
      Number.isInteger(failure.httpStatus) &&
      failure.httpStatus >= 100 &&
      failure.httpStatus <= 599
        ? failure.httpStatus
        : undefined;
    const outcome: TaskOutcome = {
      status: uncertain ? 'unknown' : 'failed',
      errorCode: uncertain
        ? 'UNKNOWN'
        : failure.code === 'INVALID_RESPONSE'
          ? 'INVALID_AI_OUTPUT'
          : failure.code === 'TRUNCATED'
            ? 'AI_TRUNCATED'
            : /* A handler that knows its own reason (e.g. a capability that is not
                 wired yet) must not be reported as a model failure. */
              ERROR_CODES.has(failure.code ?? '')
              ? (failure.code as (typeof ERROR_CODE_LIST)[number])
              : 'AI_FAILED',
      /* Keep failure diagnostics as observable as success: which model and prompt ran, and how long. */
      ...(failure.model ? { model: failure.model } : {}),
      ...(failure.promptVersion ? { promptVersion: failure.promptVersion } : {}),
      durationMs,
    };
    console.error(
      JSON.stringify({
        taskId: task.id,
        kind: task.kind,
        status: outcome.status,
        errorCode: outcome.errorCode,
        detail,
        durationMs,
        ...(stage ? { stage } : {}),
        ...(httpStatus ? { httpStatus } : {}),
        ...(timing(failure.upstreamDurationMs) !== undefined
          ? { upstreamDurationMs: timing(failure.upstreamDurationMs) }
          : {}),
      }),
    );
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
