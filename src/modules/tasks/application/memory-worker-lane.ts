import { runOne, type WorkerQueue, type TaskHandler } from './run-worker.ts';

/** One background memory job per worker, independent of interactive task execution. */
export function memoryWorkerLane(handler: TaskHandler) {
  let pending: Promise<unknown> | undefined;
  const abort = new AbortController();
  return {
    tick(queue: WorkerQueue) {
      if (pending || abort.signal.aborted) return;
      pending = runOne(queue, { memory: handler }, abort.signal)
        .catch(() => console.warn('MEMORY_WORKER_UNAVAILABLE'))
        .finally(() => {
          pending = undefined;
        });
    },
    async close() {
      abort.abort();
      await pending;
    },
  };
}
