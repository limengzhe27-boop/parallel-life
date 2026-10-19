import type { ActorContinuation } from './actor-continuation.ts';

/**
 * Admission to reconsider a personal arrangement, never permission to execute a
 * blocked plan, contact the player, or treat silence as consent. The existing
 * scheduler separately checks time, budgets, priorities and outstanding calls.
 */
export function continuationReviewAdmission(input: {
  continuation: ActorContinuation | undefined;
  currentBasisHash: string;
  paidBasisHashes: readonly string[];
}): 'eligible' | 'already_considered' {
  // A changed or legacy state still uses the original review-family authority.
  if (!input.continuation || input.continuation.basisHash !== input.currentBasisHash)
    return 'eligible';
  // Waiting and having no current intent are decisions about execution, not a
  // permanent ban on reconsidering one's own arrangements. Each unchanged basis
  // gets at most one paid review, including reviews with unknown/invalid results.
  return input.paidBasisHashes.includes(input.currentBasisHash) ? 'already_considered' : 'eligible';
}
