/** Scheduling state for an unfinished plan; never an execution grant. */
export type PlanReviewState = {
  planId: string;
  nextReviewAt: string;
  lastReviewedAt: string;
  reviewCount: number;
};
