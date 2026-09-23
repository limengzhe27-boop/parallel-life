import { setTimeout as delay } from 'node:timers/promises';
import { createWorker } from '../server/worker-composition.ts';
import { runLoop } from '../modules/tasks/application/run-loop.ts';
import { runOne } from '../modules/tasks/application/run-worker.ts';
const { queue, handlers } = createWorker();
const shutdown = new AbortController();
process.on('SIGINT', () => shutdown.abort());
process.on('SIGTERM', () => shutdown.abort());
console.log('Parallel Life worker ready. Interview tasks enabled.');
const result = await runLoop({
  shutdown: shutdown.signal,
  runOnce: (signal) => runOne(queue, handlers, signal),
  sleep: (ms, signal) => delay(ms, undefined, { signal }),
  log: (message) => console.warn(message),
});
console.log(
  result.drained
    ? `Worker stopped after ${result.tasksRun} task(s); in-flight work was allowed to finish.`
    : `Worker stopped after ${result.tasksRun} task(s); in-flight work was cancelled and recorded as unknown.`,
);
await queue.close();
