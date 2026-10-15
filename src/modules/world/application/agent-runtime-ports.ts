import type {
  ActorAgentState,
  AgentAction,
  AgentActionResult,
  AgentAttempt,
  AgentAttemptStatus,
  AgentBlocker,
  AgentCandidate,
  AgentIdentity,
  AgentInputReceipt,
  AgentProposal,
  AgentSource,
} from '../domain/agent-runtime.ts';

/** Snapshot reads have no projection writes or model calls. Channel input is already visibility-filtered. */
export type AgentSnapshot = {
  state: ActorAgentState;
  /** Only this authorized view may enter the model. Full state remains server-side for CAS/reduce. */
  viewState: ActorAgentState;
  redactedStateIds: string[];
  worldVersion: number;
  storyAt: string;
  /** Code-built local time and this NPC's sourced location knowledge, never global player position. */
  worldContext?: import('../domain/world-awareness.ts').AgentWorldContext;
  sources: AgentSource[];
  observations: {
    sourceId: string;
    text: string;
    kind: 'fact' | 'belief' | 'speech' | 'plan' | 'result';
  }[];
  actor: { name: string; persona: string; boundaries: string; definitionRef: string };
  channel: {
    kind: 'private' | 'group' | 'scene';
    threadId: string;
    audienceActorIds: string[];
    allowedCapabilities: string[];
  };
  input: { sourceId: string; text: string; origin: 'player' | 'wake' | 'coordination' };
};
export interface NpcAgentModel {
  /** Deterministic input/budget preflight runs before request_sent is recorded. */
  validateInput?(snapshot: AgentSnapshot): void;
  /** Raw result is durably recorded before parsing. Invalid output is a known result, not unknown. */
  decide(snapshot: AgentSnapshot, signal?: AbortSignal): Promise<unknown>;
}
/** Persistent claim is committed before any model request. Implementations release the DB connection. */
export interface AgentAttemptStore {
  lookup(ownerId: string, worldId: string, commandId: string): Promise<AgentAttempt | null>;
  claim(
    ownerId: string,
    input: AgentIdentity & {
      id: string;
      commandId: string;
      inputReceiptId: string;
      engineEpoch: number;
      expectedWorldVersion: number;
      expectedActorRevision: number;
      inputHash: string;
      token: string;
      leaseUntil: string;
    },
  ): Promise<{ attempt: AgentAttempt; replay: boolean }>;
  mark(ownerId: string, attempt: AgentAttempt, status: AgentAttemptStatus): Promise<AgentAttempt>;
  /** Store protected response, never logs. Replay after receipt cannot call the model again. */
  saveResponse(ownerId: string, attempt: AgentAttempt, response: unknown): Promise<AgentAttempt>;
  readResponse(
    ownerId: string,
    attempt: AgentAttempt,
  ): Promise<{ found: true; response: unknown } | { found: false }>;
}
export interface AgentInputStore {
  /** Acceptance is durable before the model; same command with another body must conflict. */
  accept(
    ownerId: string,
    input: AgentInputReceipt,
  ): Promise<{ receipt: AgentInputReceipt; replay: boolean }>;
}
export interface AgentStateReader {
  read(ownerId: string, identity: AgentIdentity): Promise<ActorAgentState | null>;
}
export interface AgentCandidateSource {
  collect(
    ownerId: string,
    worldId: string,
  ): Promise<{ candidates: AgentCandidate[]; blockers: AgentBlocker[] }>;
}
export type ActorNudge = {
  actorId: string;
  candidateId: string;
  kind:
    | 'continue_own_plan'
    | 'reassess_own_responsibility'
    | 'respond_to_player'
    | 'consider_opportunity';
  /** Must be a subset of this candidate's already authorized NPC sources. */
  basisSourceIds: string[];
};
export type DirectorCoordination = {
  candidateIds: string[];
  deferred: { candidateId: string; reason: string }[];
  /** Finite nudges only. Global rationale/free prose never enters an NPC input. */
  guidance: ActorNudge[];
  reason: string;
};
export interface DirectorAgent {
  coordinate(input: {
    worldId: string;
    worldVersion: number;
    storyAt: string;
    candidates: AgentCandidate[];
    blockers: AgentBlocker[];
    /** Authorized fictional observations, including relevant actor plan summaries. */
    observations: { sourceId: string; text: string }[];
  }): Promise<DirectorCoordination>;
}
export interface AgentKernel {
  /** Strict parsing and deterministic validation, without executing anything. */
  parse(snapshot: AgentSnapshot, response: unknown): AgentProposal;
  /** No model calls; validates proposals/dependencies and executes only registered capabilities. */
  commit(
    ownerId: string,
    input: {
      attempt: AgentAttempt;
      snapshot: AgentSnapshot;
      proposal: AgentProposal;
    },
  ): Promise<{ eventId: string; state: ActorAgentState; results: AgentActionResult[] }>;
}
export interface AgentCapability {
  key: string;
  validate(snapshot: AgentSnapshot, action: AgentAction): void;
  /** Deterministic effect proposal only. Kernel transaction records actual outcomes. */
  effects(snapshot: AgentSnapshot, action: AgentAction): unknown[];
}
