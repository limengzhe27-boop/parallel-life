import 'server-only';
import { PostgresOutboxScopeDiscovery } from '../modules/tasks/infrastructure/outbox-scope-discovery.ts';
import { PostgresOutbox } from '../modules/tasks/infrastructure/postgres-outbox.ts';
import {
  dispatchOutbox,
  type DispatchSummary,
} from '../modules/tasks/application/dispatch-outbox.ts';
import type { PostgresDatabase } from '../modules/storage/infrastructure/postgres.ts';
import { getServices } from './services.ts';

/** Shared server entry: the local/production launcher supplies credentials, not a
 * second queue or world engine. Discovery never grants payload access to its role. */
export function createOutboxWorker(
  options: {
    schedulerUrl?: string;
    appDb?: PostgresDatabase;
    intervalMs?: number;
  } = {},
) {
  const url = options.schedulerUrl ?? process.env.SCHEDULER_DATABASE_URL;
  if (!url) throw Error('OUTBOX_DISCOVERY_NOT_CONFIGURED');
  const intervalMs = options.intervalMs ?? 5000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000)
    throw Error('INVALID_OUTBOX_DISCOVERY_INTERVAL');
  const discovery = new PostgresOutboxScopeDiscovery(url);
  const db = options.appDb ?? getServices().db;
  const outbox = new PostgresOutbox(db);
  let nextCheck = 0;
  return {
    async drain(signal: AbortSignal): Promise<DispatchSummary> {
      const summary: DispatchSummary = {
        claimed: 0,
        submitted: 0,
        rejected: 0,
        requeued: 0,
        taskIds: [],
      };
      if (signal.aborted || Date.now() < nextCheck) return summary;
      nextCheck = Date.now() + intervalMs;
      const scopes = await discovery.read(4);
      let unavailable = false;
      for (const scope of scopes) {
        if (signal.aborted) break;
        // Payload access and writes retain the exact owner/event scoped original
        // claim, lease, bounded-attempt, task hash and unknown-result lifecycle.
        try {
          const result = await dispatchOutbox({ ...outbox.ports(scope.ownerId, scope), limit: 2 });
          summary.claimed += result.claimed;
          summary.submitted += result.submitted;
          summary.rejected += result.rejected;
          summary.requeued += result.requeued;
          summary.taskIds.push(...result.taskIds);
        } catch {
          // One owner's unavailable scope must not hide the rest of this batch.
          // Any acquired lease/task keeps the original recovery/idempotency path.
          unavailable = true;
        }
      }
      if (unavailable) throw Error('OUTBOX_SCOPE_DISPATCH_UNAVAILABLE');
      return summary;
    },
    close: () => discovery.close(),
  };
}
