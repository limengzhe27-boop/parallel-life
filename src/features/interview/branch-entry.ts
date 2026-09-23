/**
 * Which branch entry the personal conversation may show.
 *
 * The entry used to appear before any conversation and before any material was
 * confirmed, so tapping it asked the model for directions with nothing to base
 * them on. The planner rejects that output and the old UI silently navigated
 * away, which looked like "the branch simply cannot be created". Keep this
 * decision pure and tested so it cannot regress.
 */
export type BranchEntryState =
  /** No assistant turn yet: nothing to build a life from. */
  | { kind: 'hidden' }
  /** A generated world exists; the conversation offers to reopen the phone. */
  | { kind: 'open-ready' }
  /** Records are waiting for the user's own confirmation before any direction work. */
  | { kind: 'confirm-records'; pending: number }
  /** Nothing to base a direction on yet; keep talking instead of calling the model. */
  | { kind: 'needs-material' }
  /** Enough confirmed material: the user may generate a branch and enter the phone. */
  | { kind: 'create'; directionCount: number };

export function branchEntryState(input: {
  /** The conversation has at least one assistant reply. */
  ready: boolean;
  /** A world was already generated for this owner. */
  hasReadyWorld: boolean;
  /** Profile facts the user explicitly confirmed. */
  confirmedCount: number;
  /** Suggested records waiting for a decision. */
  pendingCandidates: number;
  /** Directions already generated in a previous run. */
  directionCount: number;
}): BranchEntryState {
  if (!input.ready) return { kind: 'hidden' };
  if (input.hasReadyWorld) return { kind: 'open-ready' };
  if (input.confirmedCount <= 0)
    return input.pendingCandidates > 0
      ? { kind: 'confirm-records', pending: input.pendingCandidates }
      : { kind: 'needs-material' };
  return { kind: 'create', directionCount: Math.max(0, input.directionCount) };
}
