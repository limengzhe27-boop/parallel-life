/**
 * The worker loop.
 *
 * A shutdown must not cancel work that may already have been paid for: the loop
 * stops claiming new tasks immediately, the in-flight task keeps an un-aborted
 * signal and gets a bounded grace window to commit its result, and only after
 * that window is the task cancelled (which is reported as an unknown outcome,
 * because the upstream call may already have completed).
 */
export type LoopDeps = {
  runOnce: (signal: AbortSignal) => Promise<boolean>;
  shutdown: AbortSignal;
  idleDelayMs?: number;
  drainMs?: number;
  /** Injected by the caller: the application layer must not reach for node built-ins. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (message: string) => void;
};
export type LoopResult = { reason: 'shutdown'; drained: boolean; tasksRun: number };

export async function runLoop(deps: LoopDeps): Promise<LoopResult> {
  const idleDelayMs = deps.idleDelayMs ?? 1000;
  const drainMs = deps.drainMs ?? 20_000;
  const sleep = deps.sleep;
  const work = new AbortController();
  let shutdownRequested = deps.shutdown.aborted;
  let drainTimer: NodeJS.Timeout | undefined;
  let drained = true;
  let tasksRun = 0;

  const requestShutdown = () => {
    shutdownRequested = true;
    /* Only cancel in-flight work after the grace window. */
    drainTimer = setTimeout(() => {
      drained = false;
      work.abort();
    }, drainMs);
  };
  deps.shutdown.addEventListener('abort', requestShutdown, { once: true });
  if (shutdownRequested) requestShutdown();

  try {
    while (!shutdownRequested) {
      let worked = false;
      try {
        worked = await deps.runOnce(work.signal);
      } catch {
        if (shutdownRequested) break;
        deps.log?.('Worker connection temporarily unavailable; queue remains persisted.');
        await sleep(3000, work.signal).catch(() => {});
        continue;
      }
      if (worked) tasksRun += 1;
      else if (!shutdownRequested) await sleep(idleDelayMs, work.signal).catch(() => {});
    }
  } finally {
    if (drainTimer) clearTimeout(drainTimer);
    deps.shutdown.removeEventListener('abort', requestShutdown);
  }
  return { reason: 'shutdown', drained, tasksRun };
}
