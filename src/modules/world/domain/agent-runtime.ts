/** Persistent execution state. Recall, speech and canonical world facts are separate objects. */
export type AgentIdentity = { worldId: string; actorId: string };
export type AgentSource = {
  id: string;
  kind:
    | 'world_event'
    | 'private_message'
    | 'group_message'
    | 'scene_entry'
    | 'action_result'
    | 'authored';
  recordId: string;
  worldVersion: number;
  at: string;
  /** Server-resolved explicit response deadline, never inferred merely from model text. */
  deadlineAt?: string;
};
export type AgentBasis = { sourceIds: string[] };
export type AgentCondition =
  | { kind: 'at_or_after'; at: string; sourceId: string }
  | { kind: 'result'; actionId: string; outcome: 'succeeded' | 'failed' }
  | { kind: 'player_decision'; responsibilityId: string; decision: PlayerDecisionKind }
  | { kind: 'at_place'; placeId: string }
  | { kind: 'observation'; sourceId: string };
export type AgentGoal = AgentBasis & {
  id: string;
  summary: string;
  status: 'active' | 'deferred' | 'fulfilled' | 'withdrawn';
  resultIds: string[];
  endReason?: string;
};
export type AgentPlan = AgentBasis & {
  id: string;
  goalId: string;
  summary: string;
  status: 'active' | 'waiting' | 'blocked' | 'finished' | 'withdrawn';
  actionIds: string[];
  nextActionId: string | null;
  triggers: AgentCondition[];
  missingConditions: string[];
  supersedesPlanId?: string;
};
export type PlayerDecisionKind = 'accepted' | 'declined' | 'negotiating' | 'deferred' | 'undecided';
export type AgentPlayerDecision = {
  id: string;
  responsibilityId: string;
  kind: PlayerDecisionKind;
  sourceId: string;
  quote: string;
};
export type AgentResponsibility = AgentBasis & {
  id: string;
  subject: { kind: 'appointment' | 'matter' | 'episode' | 'request'; id: string };
  summary: string;
  status: 'open' | 'waiting' | 'deferred' | 'fulfilled' | 'withdrawn' | 'expired';
  waitingOn: 'player' | 'self' | 'world' | null;
  /** No deadline without an actual authored/observed basis. */
  deadline?: { at: string; sourceId: string };
  nextCheck: AgentCondition[];
  resolutionResultId?: string;
  endReason?: string;
};
export type AgentAction = AgentBasis & {
  id: string;
  goalId: string;
  /** Registered kernel capability; never a story-specific natural-language execution sentence. */
  capability: string;
  targetIds: string[];
  parameters: Record<string, string | number | boolean | null | string[]>;
  preconditions: AgentCondition[];
  dependsOnActionIds: string[];
  handlesResponsibilityIds: string[];
  status:
    | 'proposed'
    | 'ready'
    | 'waiting'
    | 'blocked'
    | 'executing'
    | 'succeeded'
    | 'failed'
    | 'withdrawn';
  resultId?: string;
};
export type AgentActionResult = AgentIdentity & {
  id: string;
  actionId: string;
  eventId: string;
  worldVersion: number;
  at: string;
  outcome: 'succeeded' | 'failed';
  handledResponsibilityIds: string[];
  evidenceSourceIds: string[];
};
export type AgentConversationFocus = {
  channel: 'private' | 'group' | 'scene';
  threadId: string;
  subjectId: string | null;
  questionSourceId: string | null;
  replyToActorId: string | null;
};
export type ActorAgentState = AgentIdentity & {
  schemaVersion: 1;
  revision: number;
  projectedWorldVersion: number;
  definitionRef: string;
  /** References only. Snapshot construction separately authorizes each piece of private information. */
  knowledgeSourceIds: string[];
  memoryIds: string[];
  relationshipIds: string[];
  goals: AgentGoal[];
  plans: AgentPlan[];
  actions: AgentAction[];
  responsibilities: AgentResponsibility[];
  decisions: AgentPlayerDecision[];
  focus: AgentConversationFocus | null;
};
export type AgentStatement = {
  text: string;
  /** A statement implying execution success cannot survive that execution failing. */
  dependsOnActionIds: string[];
};
/** Proposed deltas, not trusted state. Existing decisions/history are appended, not overwritten. */
export type AgentProposal = {
  statements: AgentStatement[];
  goals: AgentGoal[];
  plans: AgentPlan[];
  actions: AgentAction[];
  responsibilities: AgentResponsibility[];
  decisions: AgentPlayerDecision[];
  focus?: AgentConversationFocus | null;
};
export type AgentAttemptStatus =
  | 'reserved'
  | 'request_sent'
  | 'response_received'
  | 'invalid_output'
  | 'stale_discarded'
  | 'committed'
  | 'cancelled_before_send'
  | 'unknown_after_send';
export type AgentAttempt = AgentIdentity & {
  id: string;
  commandId: string;
  inputReceiptId: string;
  engineEpoch: number;
  expectedWorldVersion: number;
  expectedActorRevision: number;
  inputHash: string;
  token: string;
  leaseUntil: string;
  status: AgentAttemptStatus;
  eventId?: string;
};
export type AgentInputReceipt = {
  id: string;
  worldId: string;
  commandId: string;
  inputHash: string;
  channel: AgentConversationFocus['channel'];
  threadId: string;
  recipientActorId: string | null;
  expectedWorldVersion: number;
  receivedAt: string;
  origin: 'player' | 'wake' | 'coordination';
  text: string;
};
export type AgentScope =
  | { kind: 'world' }
  | { kind: 'actor'; actorId: string }
  | { kind: 'action'; actionId: string }
  | { kind: 'resource'; resourceId: string }
  | { kind: 'episode'; episodeId: string }
  | { kind: 'channel'; channel: AgentConversationFocus['channel']; threadId: string };
export type AgentBlocker = {
  scope: AgentScope;
  reason:
    | 'unknown_attempt'
    | 'paused'
    | 'waiting_condition'
    | 'cooldown'
    | 'permission'
    | 'stale_projection';
  sourceId: string;
  reconsiderOn: AgentCondition[];
};
export type AgentCandidate = AgentIdentity & {
  id: string;
  source:
    | 'opening'
    | 'authored_event'
    | 'actor_plan'
    | 'responsibility'
    | 'conversation'
    | 'action_result';
  episodeId: string | null;
  actionId: string | null;
  resourceIds: string[];
  channel: AgentConversationFocus['channel'];
  threadId: string;
  sourceIds: string[];
  expectedWorldVersion: number;
  expectedActorRevision: number;
  priority: number;
  reason: string;
  requiresCoordination: boolean;
};

export function emptyActorAgentState(
  identity: AgentIdentity,
  definitionRef: string,
  worldVersion: number,
): ActorAgentState {
  return {
    ...identity,
    schemaVersion: 1,
    revision: 0,
    projectedWorldVersion: worldVersion,
    definitionRef,
    knowledgeSourceIds: [],
    memoryIds: [],
    relationshipIds: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
    focus: null,
  };
}

/** Finite call lifecycle; unknown is never implicitly made eligible for a paid retry. */
export function transitionAgentAttempt(
  status: AgentAttemptStatus,
  next: AgentAttemptStatus,
): AgentAttemptStatus {
  const allowed: Record<AgentAttemptStatus, AgentAttemptStatus[]> = {
    reserved: ['request_sent', 'cancelled_before_send', 'stale_discarded'],
    request_sent: ['response_received', 'unknown_after_send'],
    response_received: ['invalid_output', 'stale_discarded', 'committed'],
    unknown_after_send: ['response_received', 'stale_discarded'],
    invalid_output: [],
    stale_discarded: [],
    committed: [],
    cancelled_before_send: [],
  };
  if (status !== next && !allowed[status].includes(next)) throw Error('INVALID_ATTEMPT_TRANSITION');
  return next;
}
