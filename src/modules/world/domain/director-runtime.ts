import type {
  ActorAgentState,
  AgentAttemptStatus,
  AgentBlocker,
  AgentCandidate,
} from './agent-runtime.ts';
import type { WorldBoundary, DirectorPendingReason } from './world-awareness.ts';
import type { AuthoredAgentMaterialCatalog } from './authored-agent-material.ts';
/** Bound author direction for ONE NPC, not the player or a fact/knowledge grant.
 * Every module is a stable server-side excerpt (at most 4000 characters), not a
 * claim that the complete author manuscript was loaded into the model input.
 */
export type DirectorActorDirectionMaterial = {
  actorId: string;
  modules: Partial<
    Record<'lifeContext' | 'traits' | 'drives' | 'behavior' | 'relationships', string>
  >;
};
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
  /** Explicitly admitted causal wake, separate from an actor candidate or elapsed polling time. */
  evaluationCause?: import('./agent-narrative.ts').DirectorEvaluationCause;
  /** Authorized fictional setting and cast; never the owner's real interview/profile. */
  worldSetting?: string;
  openingContextAuthority?: import('./narrative-opening-context.ts').OpeningContextAuthority;
  /** Full immutable director-only author material; participant references never grant NPC knowledge. */
  authoredMaterials?: AuthoredAgentMaterialCatalog;
  authoredEligibility?: {
    nodeKey: string;
    nodeHash: string;
    status: 'eligible' | 'blocked' | 'expired' | 'already_presented';
    reasons: import('./authored-event-eligibility.ts').AuthoredEligibilityReason[];
    basisSourceIds: string[];
    qualificationKey: string;
  }[];
  occupiedAuthoredEventKeys?: string[];
  /** Exact paid deliberation scope; absent only on protected legacy snapshots. */
  deliberationWindow?: { version: 1; nodeKeys: string[] };
  cast?: { id: string; name: string; persona: string; relationship?: string }[];
  /** Optional on older protected snapshots; stable actorId binding, never array/name inference. */
  actorDirectionMaterials?: DirectorActorDirectionMaterial[];
  actorStates: ActorAgentState[];
  actorKnownTopics?: import('./actor-known-topic.ts').ActorKnownTopic[];
  /** One accepted native player turn needing semantic speaker coordination. */
  nativeTurn?: {
    taskId: string;
    inputReceiptId: string;
    channel: 'group' | 'scene';
    threadId: string;
  };
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
  /** A legacy/unscoped active conversation is still attention, not permission to guess its NPC. */
  conversationWithoutTarget?: boolean;
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
  actorTopics?: import('./actor-known-topic.ts').ActorTopicSelection[];
  /** Director-created future interaction proposal, not fact disclosure or an actor decision. */
  stagingIntents?: { actorId: string; kind: 'future_task'; task: string }[];
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
  /** Explicit assessments only in v4+; absent on protected historical decisions. */
  authoredAssessments?: {
    nodeKey: string;
    nodeHash: string;
    qualificationKey: string;
    decision: 'consider' | 'defer';
    reason: string;
  }[];
  /** Private global audit; never forwarded as free prose to NPCs. */
  openingContext?: import('./narrative-opening-context.ts').OpeningContextReview;
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

/** Author intent can be considered only with actual qualified, unoccupied source evidence. */
export function canConsiderAuthoredEvent(snapshot: DirectorSnapshot, nodeKey: string): boolean {
  const materials =
    snapshot.authoredMaterials?.materials.filter((m) => m.ref.nodeKey === nodeKey) ?? [];
  const matches = snapshot.authoredEligibility?.filter((item) => item.nodeKey === nodeKey) ?? [];
  return (
    materials.length === 1 &&
    matches.length === 1 &&
    matches[0]!.nodeHash === materials[0]!.ref.nodeHash &&
    matches[0]!.status === 'eligible' &&
    !snapshot.occupiedAuthoredEventKeys?.includes(nodeKey)
  );
}

/** Stable scope from authenticated eligibility/wake, never actor revisions or elapsed polling. */
export function selectDirectorDeliberationWindow(
  snapshot: DirectorSnapshot,
): NonNullable<DirectorSnapshot['deliberationWindow']> {
  let eligible = (snapshot.authoredEligibility ?? []).filter((q) =>
    canConsiderAuthoredEvent(snapshot, q.nodeKey),
  );
  const cause = snapshot.evaluationCause;
  if (snapshot.nativeTurn || !cause || cause.kind === 'opening_context') eligible = [];
  else if (cause.kind === 'bootstrap') {
    const openings = new Set(
      snapshot.authoredMaterials?.materials
        .filter((m) => m.role === 'opening')
        .map((m) => m.ref.nodeKey),
    );
    const opening = eligible.filter((q) => openings.has(q.nodeKey));
    if (opening.length) eligible = opening;
  } else {
    eligible = eligible.filter((q) =>
      cause.qualifications.some(
        (u) =>
          u.nodeKey === q.nodeKey &&
          u.nodeHash === q.nodeHash &&
          u.qualificationKey === q.qualificationKey,
      ),
    );
  }
  return {
    version: 1,
    nodeKeys: eligible
      .map((q) => q.nodeKey)
      .sort()
      .slice(0, 2),
  };
}
export function validDirectorDeliberationWindow(snapshot: DirectorSnapshot): boolean {
  if (snapshot.deliberationWindow === undefined) return true;
  return (
    snapshot.deliberationWindow.version === 1 &&
    JSON.stringify(snapshot.deliberationWindow.nodeKeys) ===
      JSON.stringify(selectDirectorDeliberationWindow(snapshot).nodeKeys)
  );
}
export function isDirectorDeliberationEvent(snapshot: DirectorSnapshot, nodeKey: string): boolean {
  return (
    canConsiderAuthoredEvent(snapshot, nodeKey) &&
    (snapshot.deliberationWindow === undefined ||
      snapshot.deliberationWindow.nodeKeys.includes(nodeKey))
  );
}

/** Seeing a catalogue is not an assessment. No implicit conversion of historical decisions. */
export function validDirectorAuthoredAssessments(
  snapshot: DirectorSnapshot,
  decision: Pick<DirectorDecision, 'authoredAssessments' | 'opportunities'>,
): boolean {
  if (!validDirectorDeliberationWindow(snapshot)) return false;
  if (decision.authoredAssessments === undefined) return snapshot.deliberationWindow === undefined;
  const eligible =
    snapshot.authoredEligibility?.filter((q) => isDirectorDeliberationEvent(snapshot, q.nodeKey)) ??
    [];
  const assessments = decision.authoredAssessments;
  if (
    assessments.length !== eligible.length ||
    new Set(assessments.map((a) => a.nodeKey)).size !== assessments.length
  )
    return false;
  for (const a of assessments) {
    const q = eligible.find((q) => q.nodeKey === a.nodeKey);
    const hasOpportunity = decision.opportunities.some((o) => o.authoredEventKey === a.nodeKey);
    if (
      !q ||
      q.nodeHash !== a.nodeHash ||
      q.qualificationKey !== a.qualificationKey ||
      !a.reason.trim() ||
      !['consider', 'defer'].includes(a.decision) ||
      (a.decision === 'consider') !== hasOpportunity
    )
      return false;
  }
  return decision.opportunities.every(
    (o) =>
      o.authoredEventKey === undefined ||
      assessments.some((a) => a.nodeKey === o.authoredEventKey && a.decision === 'consider'),
  );
}

/** Speaker selection is coordination, not permission to add a new event or write NPC dialogue. */
export function validNativeTurnDecision(
  snapshot: DirectorSnapshot,
  decision: Pick<DirectorDecision, 'mode' | 'selectedCandidateIds' | 'nudges' | 'opportunities'>,
): boolean {
  if (!snapshot.nativeTurn) return true;
  return (
    decision.mode !== 'bounded_opportunity' &&
    decision.opportunities.length === 0 &&
    decision.nudges.length === 0 &&
    decision.selectedCandidateIds.length <= 1 &&
    decision.selectedCandidateIds.every((id) =>
      snapshot.candidates.some(
        (c) =>
          c.id === id &&
          c.channel === snapshot.nativeTurn!.channel &&
          c.threadId === snapshot.nativeTurn!.threadId &&
          c.source === 'conversation' &&
          c.sourceIds.includes(snapshot.nativeTurn!.inputReceiptId),
      ),
    )
  );
}
