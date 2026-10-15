import type {
  ActorAgentState,
  AgentAttemptStatus,
  AgentBlocker,
  AgentCandidate,
} from './agent-runtime.ts';
import type { WorldBoundary, DirectorPendingReason } from './world-awareness.ts';
/** Director-only state; never serialize this object into an NPC prompt. */
export type DirectorSnapshot = {
  schemaVersion: 1;
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  storyAt: string;
  observedThroughVersion: number;
  evaluatedThroughVersion: number;
  boundary: WorldBoundary;
  /** Authorized fictional setting and cast; never the owner's real interview/profile. */
  worldSetting?: string;
  cast?: { id: string; name: string; persona: string; relationship?: string }[];
  actorStates: ActorAgentState[];
  episodes: SharedEpisode[];
  candidates: AgentCandidate[];
  blockers: AgentBlocker[];
  changes: DirectorPendingReason[];
  observations: {
    sourceId: string;
    text: string;
    kind: 'fact' | 'speech' | 'belief' | 'plan' | 'result';
    knownByActorIds: string[];
  }[];
  /** An open conversation is attention context, not proof of player decisions or location. */
  focus: { channel: 'private' | 'group' | 'scene'; threadId: string; actorIds: string[] }[];
};
export type DirectorOpportunity = {
  id: string;
  title: string;
  description: string;
  playerImpact: string;
  participantActorIds: string[];
  placeIds: string[];
  /** Activity is a product-supported opportunity, never an already executed action. */
  activity: 'conversation' | 'meeting' | 'follow_up';
  basisSourceIds: string[];
  /** Optional authored material reference; not a deterministic plot outcome. */
  authoredEventKey?: string;
};
export type SharedEpisode = {
  schemaVersion: 1;
  worldId: string;
  id: string;
  revision: number;
  origin: { kind: 'authored' | 'director'; sourceId: string };
  status: 'proposed' | 'active' | 'resolved' | 'withdrawn';
  title: string;
  description: string;
  participantActorIds: string[];
  placeIds: string[];
  sourceEventIds: string[];
  resultIds: string[];
  /** Individual NPC goals/withdrawals do not directly close a shared episode. */
  unresolvedResponsibilityIds: string[];
  endReason?: string;
};
export type DirectorNudge = {
  actorId: string;
  candidateId: string;
  kind:
    | 'continue_own_plan'
    | 'reassess_own_responsibility'
    | 'respond_to_player'
    | 'consider_opportunity';
  basisSourceIds: string[];
};
export type DirectorDecision = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  inputHash: string;
  evaluatedThroughVersion: number;
  mode: 'quiet' | 'coordinate' | 'bounded_opportunity';
  selectedCandidateIds: string[];
  deferred: { candidateId: string; reason: string }[];
  nudges: DirectorNudge[];
  opportunities: DirectorOpportunity[];
  /** Private global audit; never forwarded as free prose to NPCs. */
  audit: { reason: string; basisSourceIds: string[] };
};
export type DirectorAttempt = {
  id: string;
  worldId: string;
  commandId: string;
  engineEpoch: number;
  expectedWorldVersion: number;
  inputHash: string;
  token: string;
  leaseUntil: string;
  status: AgentAttemptStatus;
  decisionId?: string;
};
