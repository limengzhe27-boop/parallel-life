import { setTimeout as delay } from 'node:timers/promises';
import { createWorker } from '../server/worker-composition.ts';
import { createOutboxWorker } from '../server/outbox-worker.ts';
import { getServices } from '../server/services.ts';
import { runLoop } from '../modules/tasks/application/run-loop.ts';
import { runOne } from '../modules/tasks/application/run-worker.ts';
const { queue, handlers } = createWorker();
const outbox = createOutboxWorker();
const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());
console.log('Parallel Life worker ready. Durable task and Outbox dispatch enabled.');
try {
  const result = await runLoop({
    shutdown: shutdown.signal,
    runOnce: async (signal) => {
      try {
        await outbox.drain(signal);
      } catch {
        // A temporary discovery/dispatch outage must not freeze already queued work.
        console.warn('Outbox dispatch temporarily unavailable; durable tasks remain active.');
      }
      return signal.aborted ? false : runOne(queue, handlers, signal);
    },
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
    log: (message) => console.warn(message),
  });
  console.log(
    result.drained
      ? `Worker stopped after ${result.tasksRun} task(s); in-flight work was allowed to finish.`
      : `Worker stopped after ${result.tasksRun} task(s); in-flight work was cancelled and recorded as unknown.`,
  );
} finally {
  await Promise.allSettled([queue.close(), outbox.close(), getServices().db.close()]);
}
