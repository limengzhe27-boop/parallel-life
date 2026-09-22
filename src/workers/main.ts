import { setTimeout as delay } from 'node:timers/promises';
import { createWorker } from '../server/worker-composition.ts';
import { runOne } from '../modules/tasks/application/run-worker.ts';
const { queue, handlers } = createWorker();
const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());
console.log('Parallel Life worker ready. Interview tasks enabled.');
try {
  while (!stop.signal.aborted) {
    try {
      const worked = await runOne(queue, handlers, stop.signal);
      if (!worked) await delay(1000, undefined, { signal: stop.signal });
    } catch {
      if (!stop.signal.aborted) {
        console.warn('Worker connection temporarily unavailable; queue remains persisted.');
        await delay(3000, undefined, { signal: stop.signal }).catch(() => {});
      }
    }
  }
} finally {
  await queue.close();
}
