/**
 * Background polls must not hammer a deployment that is explicitly unavailable.
 *
 * Only an explicit 402 (billing/paused deployment) or a short streak of 503s
 * pauses the automatic timers. Everything else keeps the existing retry policy,
 * and a single successful poll clears the gate. User-initiated reads never
 * consult this module, so manual retry still works while timers rest.
 */
import { ApiFailure } from '../api/client.ts';

const PAYMENT_RETRY_MS = 15 * 60_000;
const UNAVAILABLE_RETRY_MS = 60_000;
const UNAVAILABLE_STREAK = 3;

let blockedUntil = 0;
let unavailableStreak = 0;

export function notePollFailure(error: unknown, now = Date.now()) {
  if (!(error instanceof ApiFailure)) return;
  if (error.status === 402) {
    unavailableStreak = 0;
    blockedUntil = now + PAYMENT_RETRY_MS;
    return;
  }
  if (error.status === 503) {
    unavailableStreak += 1;
    if (unavailableStreak >= UNAVAILABLE_STREAK) blockedUntil = now + UNAVAILABLE_RETRY_MS;
  }
}

export function notePollSuccess() {
  unavailableStreak = 0;
  blockedUntil = 0;
}

export function pollingAllowed(now = Date.now()) {
  return now >= blockedUntil;
}

/** Test-only: each case starts from a clean module state. */
export function resetPollGuard() {
  blockedUntil = 0;
  unavailableStreak = 0;
}
