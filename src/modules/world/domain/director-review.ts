/** Scheduling state for a global director review; never an execution or completion grant. */
export type DirectorReviewState = {
  nextReviewAt: string;
  lastReviewedAt: string;
  reviewCount: number;
};
export function directorReviewDue(state: DirectorReviewState | null, storyAt: string): boolean {
  return !state || Date.parse(state.nextReviewAt) <= Date.parse(storyAt);
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
