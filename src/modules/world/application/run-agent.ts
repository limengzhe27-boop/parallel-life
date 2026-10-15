import type { AgentAttempt } from '../domain/agent-runtime.ts';
import type {
  AgentAttemptStore,
  AgentKernel,
  AgentSnapshot,
  NpcAgentModel,
} from './agent-runtime-ports.ts';

export class AgentRunError extends Error {
  readonly code: 'ATTEMPT_PENDING' | 'ATTEMPT_UNKNOWN' | 'ATTEMPT_INVALID' | 'ATTEMPT_STALE';
  constructor(code: 'ATTEMPT_PENDING' | 'ATTEMPT_UNKNOWN' | 'ATTEMPT_INVALID' | 'ATTEMPT_STALE') {
    super(code);
    this.code = code;
  }
}

/** Claim -> request -> protected response -> kernel. No database transaction surrounds the model. */
export async function runNpcAgent(
  deps: { attempts: AgentAttemptStore; model: NpcAgentModel; kernel: AgentKernel },
  ownerId: string,
  claim: Parameters<AgentAttemptStore['claim']>[1],
  snapshot: AgentSnapshot,
  signal?: AbortSignal,
) {
  if (
    snapshot.state.worldId !== claim.worldId ||
    snapshot.state.actorId !== claim.actorId ||
    snapshot.input.sourceId !== claim.inputReceiptId ||
    snapshot.worldVersion !== claim.expectedWorldVersion ||
    snapshot.state.revision !== claim.expectedActorRevision
  )
    throw new AgentRunError('ATTEMPT_STALE');
  deps.model.validateInput?.(snapshot);
  let { attempt, replay } = await deps.attempts.claim(ownerId, claim);
  let response: unknown;
  if (replay) {
    // Even reserved replay may be another live caller. Never steal or re-send implicitly.
    if (attempt.status === 'unknown_after_send') throw new AgentRunError('ATTEMPT_UNKNOWN');
    if (attempt.status === 'invalid_output') throw new AgentRunError('ATTEMPT_INVALID');
    if (attempt.status === 'stale_discarded' || attempt.status === 'cancelled_before_send')
      throw new AgentRunError('ATTEMPT_STALE');
    if (attempt.status !== 'response_received' && attempt.status !== 'committed')
      throw new AgentRunError('ATTEMPT_PENDING');
    response = await deps.attempts.readResponse(ownerId, attempt);
    if (response === null) throw new AgentRunError('ATTEMPT_UNKNOWN');
  } else {
    if (signal?.aborted) {
      await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send');
      throw signal.reason ?? Error('CANCELLED');
    }
    attempt = await deps.attempts.mark(ownerId, attempt, 'request_sent');
    try {
      response = await deps.model.decide(snapshot, signal);
      attempt = await deps.attempts.saveResponse(ownerId, attempt, response);
    } catch (error) {
      // Conservatively retain uncertainty if response storage or transport failed after send.
      // A failing mark must not trigger another model invocation or hide the original failure.
      await deps.attempts.mark(ownerId, attempt, 'unknown_after_send').catch(() => {});
      throw error;
    }
  }
  if (attempt.status === 'stale_discarded') throw new AgentRunError('ATTEMPT_STALE');
  let proposal;
  try {
    proposal = deps.kernel.parse(snapshot, response);
  } catch (error) {
    if (attempt.status !== 'committed')
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
  try {
    // Implementations replay a committed receipt first and atomically commit all kernel objects.
    return await deps.kernel.commit(ownerId, { attempt, snapshot, proposal });
  } catch (error) {
    if (attempt.status !== 'committed' && isKnownConflict(error))
      await deps.attempts.mark(ownerId, attempt, 'stale_discarded');
    // A received response stays recoverable after a storage failure, without another paid request.
    throw error;
  }
}

function isKnownConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    [
      'VERSION_CONFLICT',
      'AGENT_REVISION_CONFLICT',
      'ENGINE_EPOCH_CONFLICT',
      'ATTEMPT_STALE',
    ].includes(String((error as { code?: unknown }).code ?? (error as Error).message))
  );
}

export function attemptNeedsUserRecovery(attempt: AgentAttempt): boolean {
  return attempt.status === 'unknown_after_send';
}
