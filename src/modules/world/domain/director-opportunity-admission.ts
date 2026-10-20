/** Eligibility is not demand: unreviewed catalogue entries cannot keep buying scans. */
export function admitDirectorOpportunity(input: {
  previouslyAssessed: boolean;
  hasPriorPaidAssessment: boolean;
  hasOutstandingWork: boolean;
  hasRelatedNewEvidence: boolean;
  hasIndependentNewEvidence: boolean;
  hasNewlyReleasedEpisode: boolean;
  /** A confirmed quiet review can continue its finite, unassessed catalogue. */
  hasConfirmedQuietPredecessor?: boolean;
  /** Existing authored conditions became eligible since the previous assessment. */
  hasNewlyQualifiedEpisode?: boolean;
}): boolean {
  if (!input.hasPriorPaidAssessment) return true;
  // A changed context for an already assessed event remains eligible even while
  // another event is active. This is not permission to retry a paid context.
  if (input.previouslyAssessed) return input.hasRelatedNewEvidence;
  if (input.hasNewlyQualifiedEpisode) return true;
  if (input.hasIndependentNewEvidence || input.hasNewlyReleasedEpisode) return true;
  if (!input.hasOutstandingWork && input.hasConfirmedQuietPredecessor) return true;
  // An actual new personal plan can create demand when nothing is waiting on
  // the player; merely renaming the remaining catalogue cannot.
  return !input.hasOutstandingWork && input.hasRelatedNewEvidence;
}
