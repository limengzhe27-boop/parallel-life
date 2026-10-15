import type { DirectorAttempt, DirectorSnapshot } from '../domain/director-runtime.ts';
import type {
  DirectorAttemptStore,
  DirectorDecisionModel,
  DirectorRecoveryStore,
  DirectorRecoveryResult,
} from './director-runtime-ports.ts';
import type { DirectorDecision } from '../domain/director-runtime.ts';
export async function runDirectorAgent(
  deps: {
    attempts: DirectorAttemptStore;
    model: DirectorDecisionModel;
    parse: (snapshot: DirectorSnapshot, raw: unknown, attempt: DirectorAttempt) => DirectorDecision;
  },
  ownerId: string,
  claim: Omit<DirectorAttempt, 'status' | 'decisionId'>,
  snapshot: DirectorSnapshot,
  signal?: AbortSignal,
) {
  let execution = structuredClone(snapshot),
    raw: unknown;
  const previous = await deps.attempts.lookup(ownerId, claim.worldId, claim.commandId);
  if (
    previous &&
    (previous.inputHash !== claim.inputHash ||
      previous.engineEpoch !== claim.engineEpoch ||
      previous.expectedWorldVersion !== claim.expectedWorldVersion)
  )
    throw Object.assign(Error('DIRECTOR_COMMAND_CONFLICT'), { code: 'DIRECTOR_COMMAND_CONFLICT' });
  if (previous?.status === 'committed') {
    const decision = previous.decisionId
      ? await deps.attempts.readDecision(ownerId, previous.worldId, previous.decisionId)
      : null;
    if (!decision) throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
    return decision;
  }
  if (!previous) deps.model.validateInput?.(execution);
  if (
    previous &&
    [
      'reserved',
      'request_sent',
      'unknown_after_send',
      'invalid_output',
      'stale_discarded',
      'cancelled_before_send',
    ].includes(previous.status)
  )
    throw Object.assign(Error('DIRECTOR_ATTEMPT_NOT_RETRYABLE'), {
      code: previous.status === 'unknown_after_send' ? 'UNKNOWN' : 'INVALID_STATE',
    });
  if (previous) {
    const saved = await deps.attempts.readCompletion(ownerId, previous);
    if (!saved.found) throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
    execution = saved.snapshot;
    raw = saved.response;
  }
  let { attempt, replay } = await deps.attempts.claim(ownerId, previous ?? claim, execution);
  // Another caller may have claimed or finished after lookup. Treat the claim's
  // durable status as authoritative; never parse undefined or resend its request.
  if (replay) {
    if (attempt.status === 'committed') {
      const decision = attempt.decisionId
        ? await deps.attempts.readDecision(ownerId, attempt.worldId, attempt.decisionId)
        : null;
      if (!decision) throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
      return decision;
    }
    if (attempt.status !== 'response_received')
      throw Object.assign(Error('DIRECTOR_ATTEMPT_NOT_RETRYABLE'), {
        code: attempt.status === 'unknown_after_send' ? 'UNKNOWN' : 'INVALID_STATE',
      });
    const saved = await deps.attempts.readCompletion(ownerId, attempt);
    if (!saved.found) throw Object.assign(Error('DIRECTOR_RESULT_NOT_FOUND'), { code: 'UNKNOWN' });
    execution = saved.snapshot;
    raw = saved.response;
  }
  if (!replay) {
    if (signal?.aborted) {
      await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send');
      throw signal.reason ?? Error('CANCELLED');
    }
    try {
      attempt = await deps.attempts.mark(ownerId, attempt, 'request_sent');
    } catch (error) {
      if (isKnownConflict(error))
        await deps.attempts.mark(ownerId, attempt, 'stale_discarded').catch(() => {});
      throw error;
    }
    try {
      raw = await deps.model.decide(execution, signal);
      attempt = await deps.attempts.saveResponse(ownerId, attempt, raw);
    } catch (error) {
      await deps.attempts.mark(ownerId, attempt, 'unknown_after_send').catch(() => {});
      throw error;
    }
  }
  if (attempt.status === 'stale_discarded')
    throw Object.assign(Error('DIRECTOR_STALE'), { code: 'VERSION_CONFLICT' });
  if (attempt.status === 'invalid_output')
    throw Object.assign(Error('INVALID_DIRECTOR_RESULT'), { code: 'INVALID_DIRECTOR_PROPOSAL' });
  let decision: DirectorDecision;
  try {
    decision = deps.parse(execution, raw, attempt);
  } catch (error) {
    if (attempt.status !== 'committed')
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
  try {
    return await deps.attempts.commit(ownerId, attempt, execution, decision);
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? (error as Error)?.message);
    if (attempt.status !== 'committed' && isKnownConflict(error))
      await deps.attempts.mark(ownerId, attempt, 'stale_discarded');
    else if (attempt.status !== 'committed' && code.startsWith('INVALID_DIRECTOR_'))
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
}
function isKnownConflict(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? (error as Error)?.message);
  return [
    'VERSION_CONFLICT',
    'ENGINE_EPOCH_CONFLICT',
    'DIRECTOR_REVISION_CONFLICT',
    'DIRECTOR_CURSOR_CONFLICT',
    'DIRECTOR_PENDING_RANGE_INCOMPLETE',
    'DIRECTOR_ACTOR_STATE_CONFLICT',
    'DIRECTOR_BOUNDARY_CONFLICT',
    'DIRECTOR_EPISODE_CONFLICT',
    'DIRECTOR_CANDIDATE_CONFLICT',
    'DIRECTOR_CLOCK_CONFLICT',
    'DIRECTOR_CAST_CONFLICT',
    'DIRECTOR_ATTENTION_CONFLICT',
    'DIRECTOR_ATTEMPT_STALE',
    'DIRECTOR_EPISODE_ID_CONFLICT',
  ].includes(code);
}

/** Resolve the existing world slot before choosing a new command. This helper has no model port. */
export async function recoverDirectorAgent(
  deps: {
    attempts: DirectorRecoveryStore;
    parse: (snapshot: DirectorSnapshot, raw: unknown, attempt: DirectorAttempt) => DirectorDecision;
  },
  ownerId: string,
  current: DirectorSnapshot,
): Promise<DirectorRecoveryResult> {
  const pending = await deps.attempts.prepareRecovery(ownerId, current);
  if (pending.status !== 'ready') return pending;
  const { attempt, snapshot, response } = pending;
  let decision: DirectorDecision;
  try {
    decision = deps.parse(snapshot, response, attempt);
  } catch (error) {
    await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
  try {
    const saved = await deps.attempts.commit(ownerId, attempt, snapshot, decision);
    return {
      status: 'recovered',
      attempt: { ...attempt, status: 'committed', decisionId: saved.id },
      decision: saved,
    };
  } catch (error) {
    if (isKnownConflict(error)) {
      const stale = await deps.attempts.mark(ownerId, attempt, 'stale_discarded');
      return { status: 'stale', attempt: stale, reason: 'frame_changed' };
    }
    const code = String((error as { code?: unknown })?.code ?? (error as Error)?.message);
    if (code.startsWith('INVALID_DIRECTOR_'))
      await deps.attempts.mark(ownerId, attempt, 'invalid_output');
    throw error;
  }
}
