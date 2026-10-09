import type { TaskLease } from '../modules/tasks/domain/types.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
type Handler = (lease: TaskLease, signal: AbortSignal) => Promise<void>;
/** One consumer for world-scoped leases; never guess a channel from malformed input. */
export function worldTaskDispatcher(handlers: { scene: Handler; group: Handler }) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    if (lease.kind !== 'world' || !lease.input || typeof lease.input !== 'object')
      throw new DomainError('INVALID_COMMAND');
    const input = lease.input as { type?: unknown; channel?: unknown };
    if (input.type === 'scene' && input.channel === undefined) return handlers.scene(lease, signal);
    if (input.channel === 'group' && input.type === undefined) return handlers.group(lease, signal);
    throw new DomainError('INVALID_COMMAND', 'Unknown or ambiguous world task channel');
  };
}
