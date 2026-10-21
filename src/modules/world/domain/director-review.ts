/** Scheduling state for a global director review; never an execution or completion grant. */
export type DirectorReviewState = {
  nextReviewAt: string;
  lastReviewedAt: string;
  reviewCount: number;
  /** Latest durable attempt outcome, used for retry/recovery classification. */
  lastStatus?: string;
};

const KNOWN_RETRYABLE = new Set(['invalid_output', 'cancelled_before_send', 'stale_discarded']);
const RECOVERY_STATUSES = new Set([
  'reserved',
  'request_sent',
  'response_received',
  'unknown_after_send',
]);

export function directorFailureRetryMs(status?: string): number {
  return status && KNOWN_RETRYABLE.has(status) ? 15_000 : 60 * 60 * 1000;
}

export function nextDirectorReviewAt(storyAt: string, status?: string): string {
  const at = Date.parse(storyAt);
  if (!Number.isFinite(at)) throw Error('INVALID_DIRECTOR_REVIEW_TIME');
  return new Date(at + directorFailureRetryMs(status)).toISOString();
}

export function directorReviewDue(state: DirectorReviewState | null, now: string): boolean {
  return !state || Date.parse(state.nextReviewAt) <= Date.parse(now);
}

/** Unknown/pending work may be recovered without a new paid model call. */
export function directorRecoveryEligible(state: DirectorReviewState | null): boolean {
  return !!state?.lastStatus && RECOVERY_STATUSES.has(state.lastStatus);
}

export function emptyDirectorReviewDue(input: {
  state: DirectorReviewState | null;
  storyAt: string;
  selectedCount: number;
  retry: boolean;
  handledActorCount: number;
}): boolean {
  return (
    !input.retry &&
    input.selectedCount === 0 &&
    input.handledActorCount === 0 &&
    directorReviewDue(input.state, input.storyAt)
  );
}

export function emptyDirectorRecoveryDue(input: {
  state: DirectorReviewState | null;
  selectedCount: number;
  retry: boolean;
  handledActorCount: number;
}): boolean {
  return (
    !input.retry &&
    input.selectedCount === 0 &&
    input.handledActorCount === 0 &&
    directorRecoveryEligible(input.state)
  );
}
