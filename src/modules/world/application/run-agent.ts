import type { AgentAttempt } from '../domain/agent-runtime.ts';
import {
  ACTOR_EPISODE_INTENT_PREFIX,
  isActorEpisodeConsiderationInput,
} from '../domain/actor-episode-intent.ts';
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
  snapshot: AgentSnapshot | null,
  signal?: AbortSignal,
) {
  let executionSnapshot = snapshot ? structuredClone(snapshot) : null;
  if (executionSnapshot) {
    assertSnapshotIdentity(executionSnapshot, claim);
    deps.model.validateInput?.(executionSnapshot);
  }
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
    const stored = await deps.attempts.readResponse(ownerId, attempt);
    if (!stored.found) throw new AgentRunError('ATTEMPT_UNKNOWN');
    const saved = stored.response as {
      kind?: unknown;
      schemaVersion?: unknown;
      snapshot?: AgentSnapshot;
      response?: unknown;
    } | null;
    if (
      !saved ||
      saved.kind !== 'npc_agent_completion' ||
      saved.schemaVersion !== 1 ||
      !saved.snapshot
    ) {
      if (attempt.status !== 'committed')
        await deps.attempts.mark(ownerId, attempt, 'invalid_output');
      throw new AgentRunError('ATTEMPT_INVALID');
    }
    executionSnapshot = saved.snapshot;
    assertSnapshotIdentity(executionSnapshot, claim);
    response = saved.response;
  } else {
    if (!executionSnapshot) {
      await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send');
      throw new AgentRunError('ATTEMPT_INVALID');
    }
    if (signal?.aborted) {
      await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send');
      throw signal.reason ?? Error('CANCELLED');
    }
    try {
      if (
        executionSnapshot.episodeManifest !== undefined ||
        isActorEpisodeConsiderationInput(executionSnapshot.input) ||
        executionSnapshot.sources.some((source) =>
          source.id.startsWith(ACTOR_EPISODE_INTENT_PREFIX),
        )
      ) {
        if (!deps.attempts.markRequestSentWithSources)
          throw Object.assign(Error('INPUT_SCOPE_FORBIDDEN'), { code: 'INPUT_SCOPE_FORBIDDEN' });
        attempt = await deps.attempts.markRequestSentWithSources(
          ownerId,
          attempt,
          executionSnapshot,
        );
      } else attempt = await deps.attempts.mark(ownerId, attempt, 'request_sent');
    } catch (error) {
      // A known pre-send fence rejection must not leave a reserved actor permanently busy.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['EPISODE_DELIVERY_DEFERRED', 'NPC_DELIVERY_DEFERRED'].includes(String(error.code))
      )
        await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send').catch(() => {});
      else if (isKnownConflict(error))
        await deps.attempts.mark(ownerId, attempt, 'stale_discarded').catch(() => {});
      throw error;
    }
    try {
      response = await deps.model.decide(executionSnapshot, signal);
      attempt = await deps.attempts.saveResponse(ownerId, attempt, {
        kind: 'npc_agent_completion',
        schemaVersion: 1,
        snapshot: executionSnapshot,
        response,
      });
    } catch (error) {
      // Conservatively retain uncertainty if response storage or transport failed after send.
      // A failing mark must not trigger another model invocation or hide the original failure.
      await deps.attempts.mark(ownerId, attempt, 'unknown_after_send').catch(() => {});
      throw error;
    }
  }
  if (attempt.status === 'stale_discarded') throw new AgentRunError('ATTEMPT_STALE');
  if (attempt.status === 'invalid_output') throw new AgentRunError('ATTEMPT_INVALID');
  if (!executionSnapshot) throw new AgentRunError('ATTEMPT_INVALID');
  let proposal;
  try {
    proposal = deps.kernel.parse(executionSnapshot, response);
  } catch (error) {
    if (attempt.status !== 'committed')
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
  try {
    // Implementations replay a committed receipt first and atomically commit all kernel objects.
    return await deps.kernel.commit(ownerId, { attempt, snapshot: executionSnapshot, proposal });
  } catch (error) {
    if (attempt.status !== 'committed' && isKnownConflict(error))
      await deps.attempts.mark(ownerId, attempt, 'stale_discarded');
    else if (attempt.status !== 'committed' && isKnownInvalid(error))
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    // A received response stays recoverable after a storage failure, without another paid request.
    throw error;
  }
}
function assertSnapshotIdentity(
  snapshot: AgentSnapshot,
  claim: Parameters<AgentAttemptStore['claim']>[1],
) {
  if (
    !snapshot.state ||
    !snapshot.input ||
    snapshot.state.worldId !== claim.worldId ||
    snapshot.state.actorId !== claim.actorId ||
    snapshot.input.sourceId !== claim.inputReceiptId ||
    snapshot.worldVersion !== claim.expectedWorldVersion ||
    snapshot.state.revision !== claim.expectedActorRevision
  )
    throw new AgentRunError('ATTEMPT_STALE');
}
function isKnownInvalid(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    ['INVALID_AGENT_PROPOSAL', 'INVALID_PROPOSAL'].includes(
      String((error as { code?: unknown }).code),
    )
  );
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
      'INPUT_SCOPE_FORBIDDEN',
    ].includes(String((error as { code?: unknown }).code ?? (error as Error).message))
  );
}

export function attemptNeedsUserRecovery(attempt: AgentAttempt): boolean {
  return attempt.status === 'unknown_after_send';
}
