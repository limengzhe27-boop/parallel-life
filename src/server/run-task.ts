import 'server-only';
import { createWorker } from './worker-composition.ts';
import { runOne } from '../modules/tasks/application/run-worker.ts';
/** Work stays within the HTTP lifetime; SQL leases fence duplicate requests and lost responses. */
export async function runOwnedTask(ownerId: string, taskId: string) {
  const { queue, handlers } = createWorker();
  try {
    await runOne(
      {
        claim: (kinds) => queue.claimForOwner(taskId, ownerId, kinds),
        renew: (lease) => queue.renew(lease),
        finish: (lease, outcome) => queue.finish(lease, outcome),
      },
      handlers,
      AbortSignal.timeout(110000),
    );
  } finally {
    await queue.close();
  }
}
