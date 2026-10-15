import type {
  DirectorAttempt,
  DirectorDecision,
  DirectorSnapshot,
} from '../domain/director-runtime.ts';
import type { AgentAttemptStatus } from '../domain/agent-runtime.ts';
export interface DirectorAttemptStore {
  lookup(ownerId: string, worldId: string, commandId: string): Promise<DirectorAttempt | null>;
  claim(
    ownerId: string,
    input: Omit<DirectorAttempt, 'status' | 'decisionId'>,
    snapshot: DirectorSnapshot,
  ): Promise<{ attempt: DirectorAttempt; replay: boolean }>;
  mark(
    ownerId: string,
    attempt: DirectorAttempt,
    status: AgentAttemptStatus,
  ): Promise<DirectorAttempt>;
  saveResponse(
    ownerId: string,
    attempt: DirectorAttempt,
    response: unknown,
  ): Promise<DirectorAttempt>;
  readCompletion(
    ownerId: string,
    attempt: DirectorAttempt,
  ): Promise<{ found: true; snapshot: DirectorSnapshot; response: unknown } | { found: false }>;
  /** Immutable receipt replay never reinterprets an already committed decision. */
  readDecision(
    ownerId: string,
    worldId: string,
    decisionId: string,
  ): Promise<DirectorDecision | null>;
  /** Same SQL UoW: immutable decision, evaluated cursor, authored opportunities and attempt commit. No NPC state mutation. */
  commit(
    ownerId: string,
    attempt: DirectorAttempt,
    snapshot: DirectorSnapshot,
    decision: DirectorDecision,
  ): Promise<DirectorDecision>;
}
export interface DirectorDecisionModel {
  validateInput?(snapshot: DirectorSnapshot): void;
  decide(snapshot: DirectorSnapshot, signal?: AbortSignal): Promise<unknown>;
}
