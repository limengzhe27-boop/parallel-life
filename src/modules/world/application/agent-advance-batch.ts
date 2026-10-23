import type { AdvanceWorkRef } from '../domain/advance-operation.ts';
import type { AdvanceResult } from './advance-world.ts';

export type AgentAdvanceBatchPolicy = {
  maxActors: number;
  maxModelCalls: number;
  maxSteps: number;
  /** Stop starting work at this boundary; never abort an already sent paid request. */
  maxElapsedMs: number;
};
export const DEFAULT_AGENT_ADVANCE_BATCH_POLICY: AgentAdvanceBatchPolicy = {
  maxActors: 3,
  maxModelCalls: 6,
  maxSteps: 8,
  maxElapsedMs: 45_000,
};
export function agentAdvanceBatchPolicy(input: Partial<AgentAdvanceBatchPolicy> = {}) {
  const policy = { ...DEFAULT_AGENT_ADVANCE_BATCH_POLICY, ...input };
  for (const [key, max] of Object.entries({
    maxActors: 8,
    maxModelCalls: 16,
    maxSteps: 24,
    maxElapsedMs: 90_000,
  })) {
    const value = policy[key as keyof AgentAdvanceBatchPolicy];
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw Error('INVALID_AGENT_BATCH_POLICY');
  }
  return Object.freeze(policy);
}
/** Request-local fairness/budget; all durable work and idempotency remain in the original stores. */
export type AgentAdvanceBatchContext = {
  readonly handledActorIds: Set<string>;
  trackWork?(work: AdvanceWorkRef): Promise<void>;
  canStartModel(): boolean;
  beginDirectorAssessment(): boolean;
  /** Preserve a protected paid read frame; do not start another step in this batch. */
  yieldAfterStep(): void;
  /** Reserve before accepting fresh work; release in finally, including no-call recovery. */
  reserveModel(): { release(): void } | null;
  modelStarted(): void;
  actorStarted(actorId: string): void;
};
/** A shared provider 5xx is not an individual character decision; stop buying this batch. */
export function actorAdvanceFailureScope(error: unknown): 'actor' | 'model' {
  const e = error as { code?: unknown; stage?: unknown; httpStatus?: unknown } | null;
  return e?.code === 'UPSTREAM_FAILED' &&
    e.stage === 'response' &&
    typeof e.httpStatus === 'number' &&
    e.httpStatus >= 500 &&
    e.httpStatus <= 599
    ? 'model'
    : 'actor';
}
/** Constructed by composition only after the original durable attempt confirms this scope. */
export class ActorAdvanceBlocked extends Error {
  readonly original: unknown;
  readonly attemptStatus: 'unknown_after_send' | 'invalid_output' | 'cancelled_before_send';
  readonly scope: 'actor' | 'model';
  constructor(
    original: unknown,
    attemptStatus: 'unknown_after_send' | 'invalid_output' | 'cancelled_before_send',
    scope: 'actor' | 'model' = 'actor',
  ) {
    super('ACTOR_ADVANCE_BLOCKED', { cause: original });
    this.original = original;
    this.attemptStatus = attemptStatus;
    this.scope = scope;
  }
}
export class AgentAdvanceDeferred extends Error {
  readonly original: unknown;
  constructor(original: unknown) {
    super('AGENT_ADVANCE_DEFERRED', { cause: original });
    this.original = original;
  }
}
/** Internal only: the world moved between the pre-read and the read transaction. */
export const ADVANCE_READ_STALE = 'ADVANCE_READ_STALE';
export function advanceReadStale() {
  return Object.assign(Error(ADVANCE_READ_STALE), { code: ADVANCE_READ_STALE });
}
/**
 * Retry exactly one stale pre-read. This is narrower than VERSION_CONFLICT:
 * a real commit conflict or a paid/unknown attempt must still surface unchanged.
 */
export async function retryAdvanceReadOnce<T>(run: () => Promise<T>, onRetry?: () => void) {
  let retried = false;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (retried || (error as { code?: unknown } | null)?.code !== ADVANCE_READ_STALE) throw error;
      retried = true;
      onRetry?.();
    }
  }
}
export async function runAgentAdvanceBatch(
  step: (context: AgentAdvanceBatchContext) => Promise<AdvanceResult | null>,
  policy: AgentAdvanceBatchPolicy,
  now: () => number = Date.now,
  trackWork?: (work: AdvanceWorkRef) => Promise<void>,
): Promise<AdvanceResult | null> {
  const startedAt = now(),
    handledActorIds = new Set<string>();
  let directorConsidered = false,
    yielded = false;
  let modelCalls = 0,
    aggregate: AdvanceResult | null = null;
  const reservations = new Set<object>();
  const context: AgentAdvanceBatchContext = {
    handledActorIds,
    trackWork,
    yieldAfterStep() {
      yielded = true;
    },
    beginDirectorAssessment() {
      if (directorConsidered) return false;
      directorConsidered = true;
      return true;
    },
    canStartModel: () =>
      modelCalls + reservations.size < policy.maxModelCalls &&
      now() - startedAt < policy.maxElapsedMs,
    reserveModel() {
      if (!context.canStartModel()) return null;
      const reservation = {};
      reservations.add(reservation);
      return {
        release() {
          reservations.delete(reservation);
        },
      };
    },
    modelStarted() {
      const reserved = reservations.values().next();
      if (!reserved.done) {
        reservations.delete(reserved.value);
        modelCalls++;
        return;
      }
      if (!context.canStartModel())
        throw Object.assign(Error('AGENT_BATCH_BUDGET'), {
          code: 'INVALID_CONFIG',
          stage: 'request',
          responseOutcome: 'not_sent',
          batchYield: true,
        });
      modelCalls++;
    },
    actorStarted(actorId) {
      handledActorIds.add(actorId);
    },
  };
  for (let index = 0; index < policy.maxSteps; index++) {
    const beforeActors = handledActorIds.size,
      beforeModels = modelCalls;
    let result: AdvanceResult | null;
    try {
      result = await step(context);
    } catch (error) {
      if (error instanceof AgentAdvanceDeferred) {
        if (aggregate) return aggregate;
        throw error.original;
      }
      // Only a named actor attempt can be isolated. Never swallow authorization,
      // storage or global failures, nor retry the actor whose result is unknown.
      if (handledActorIds.size <= beforeActors || !(error instanceof ActorAdvanceBlocked))
        throw error;
      if (error.scope === 'model') {
        if (aggregate) return aggregate;
        throw error.original;
      }
      if (!context.canStartModel() || handledActorIds.size >= policy.maxActors) {
        if (aggregate) return aggregate;
        throw error.original;
      }
      continue;
    }
    if (result === null) return aggregate;
    aggregate = aggregate
      ? {
          ...result,
          storyNow:
            Date.parse(result.storyNow) > Date.parse(aggregate.storyNow)
              ? result.storyNow
              : aggregate.storyNow,
          played: aggregate.played + result.played,
          folded: aggregate.folded + result.folded,
          actors: [...new Set([...aggregate.actors, ...result.actors])],
          changed: !!aggregate.changed || !!result.changed,
          ...(result.worldVersion === undefined && aggregate.worldVersion !== undefined
            ? { worldVersion: aggregate.worldVersion }
            : {}),
          summary: result.summary ?? aggregate.summary,
        }
      : result;
    if (
      yielded ||
      (!result.changed && beforeModels === modelCalls && beforeActors === handledActorIds.size) ||
      handledActorIds.size >= policy.maxActors ||
      !context.canStartModel()
    )
      break;
  }
  return aggregate;
}
