/** Derived references to this actor's existing state; no private transcript or new execution authority. */
export type EpisodeFollowUpContext = {
  requestId: string;
  episodeId: string;
  choice: import('./agent-narrative.ts').EpisodeParticipationDecision['choice'];
  followUp: 'none' | 'open' | 'terminal';
  goalIds: string[];
  planIds: string[];
  responsibilityIds: string[];
  readyPlanIds: string[];
  readyResponsibilityIds: string[];
};
