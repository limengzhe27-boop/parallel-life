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

/** Protected completion recovery never grants permission for a second model request. */
export type DirectorRecoveryPreparation =
  | { status: 'none' }
  | { status: 'blocked'; attempt: DirectorAttempt }
  | { status: 'stale'; attempt: DirectorAttempt; reason: 'frame_changed' | 'lease_expired' }
  | { status: 'ready'; attempt: DirectorAttempt; snapshot: DirectorSnapshot; response: unknown };
export interface DirectorRecoveryStore extends DirectorAttemptStore {
  /** Lock the world's pending slot and validate both stored and current frames before changing it. */
  prepareRecovery(ownerId: string, current: DirectorSnapshot): Promise<DirectorRecoveryPreparation>;
}
export type DirectorRecoveryResult =
  | Exclude<DirectorRecoveryPreparation, { status: 'ready' }>
  | { status: 'recovered'; attempt: DirectorAttempt; decision: DirectorDecision };
