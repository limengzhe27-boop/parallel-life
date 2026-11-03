import { ApiFailure } from '../api/client.ts';

const PAYMENT_RETRY_MS = 15 * 60_000;
const UNAVAILABLE_RETRY_MS = 60_000;
const UNAVAILABLE_STREAK = 3;
type PollScope = 'world' | 'clock' | 'advance';
const unavailable = new Map<PollScope, { streak: number; until: number }>();
let payment: { scope: PollScope; until: number } | undefined;

/** Route failures back off their own work. A deployment-level 402 pauses all
 * automatic polls; another healthy route cannot clear either failure. */
export function notePollFailure(scope: PollScope, error: unknown, now = Date.now()) {
  if (!(error instanceof ApiFailure)) return;
  if (error.status === 402) {
    payment = { scope, until: now + PAYMENT_RETRY_MS };
    return;
  }
  if (error.status === 503) {
    const previous = unavailable.get(scope);
    const streak = (previous?.streak ?? 0) + 1;
    unavailable.set(scope, {
      streak,
      until: streak >= UNAVAILABLE_STREAK ? now + UNAVAILABLE_RETRY_MS : 0,
    });
  }
}

export function notePollSuccess(scope: PollScope) {
  unavailable.delete(scope);
  // A manual retry of the affected service can confirm that it recovered.
  if (payment?.scope === scope) payment = undefined;
}

export function pollingAllowed(scope: PollScope, now = Date.now()) {
  return now >= (payment?.until ?? 0) && now >= (unavailable.get(scope)?.until ?? 0);
}

/** Speed up observation of pending media for a bounded real-time window. Story
 * timestamps never decide whether a media job has timed out or failed. */
export function worldPollDelay(hasPendingMedia: boolean, observedAt: number, now = Date.now()) {
  return hasPendingMedia && now - observedAt < 5 * 60_000 ? 3_000 : 10_000;
}

export function resetPollGuard() {
  unavailable.clear();
  payment = undefined;
}
