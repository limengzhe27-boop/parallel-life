/** Transport receipts observe original work; they never authorize a new Agent decision. */
export type AdvanceWorkRef = { kind: 'npc' | 'director'; commandId: string };
export type AdvanceWorkState = AdvanceWorkRef & {
  status:
    | 'not_started'
    | 'reserved'
    | 'request_sent'
    | 'response_received'
    | 'committed'
    | 'unknown_after_send'
    | 'invalid_output'
    | 'stale_discarded'
    | 'cancelled_before_send';
};
export type AdvanceOperationState = 'running' | 'complete' | 'recoverable' | 'unknown' | 'failed';
export function advanceOperationState(input: {
  finished: boolean;
  succeeded: boolean;
  leaseActive: boolean;
  work: AdvanceWorkState[];
}): AdvanceOperationState {
  // Do not call a partially executed batch complete while its original caller can still add work.
  if (!input.finished && input.leaseActive) return 'running';
  if (input.work.some((w) => w.status === 'response_received')) return 'recoverable';
  if (input.work.some((w) => ['unknown_after_send', 'request_sent', 'reserved'].includes(w.status)))
    return 'unknown';
  if (
    input.work.some((w) =>
      ['invalid_output', 'stale_discarded', 'cancelled_before_send'].includes(w.status),
    )
  )
    return 'failed';
  if (
    input.succeeded ||
    ((input.finished || !input.leaseActive) &&
      input.work.length > 0 &&
      input.work.every((w) => w.status === 'committed'))
  )
    return 'complete';
  return 'failed';
}
