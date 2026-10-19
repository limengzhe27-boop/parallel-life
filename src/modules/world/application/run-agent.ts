import { attachAgentFailure } from './agent-failure-diagnostic.ts';
import { isOwnAgendaReviewInput } from '../domain/own-agenda-review.ts';
import { isAgendaInitializeInput } from '../domain/actor-agenda-initialization.ts';
import { modelRequestRejection, modelRequestNotSent } from '../../ai/application/ports.ts';
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

export type AgentRunPhaseTimings = {
  modelTotalMs: number;
  responsePersistMs: number;
  decodeCompileMs: number;
  persistAndDecodeWallMs: number;
  kernelCommitMs: number;
};

/** Claim -> request -> protected response -> kernel. No database transaction surrounds the model. */
export async function runNpcAgent(
  deps: {
    attempts: AgentAttemptStore;
    model: NpcAgentModel;
    kernel: AgentKernel;
    onPhaseTiming?: (timings: AgentRunPhaseTimings) => void;
  },
  ownerId: string,
  claim: Parameters<AgentAttemptStore['claim']>[1],
  snapshot: AgentSnapshot | null,
  signal?: AbortSignal,
) {
  const phaseTimings: AgentRunPhaseTimings = {
    modelTotalMs: 0,
    responsePersistMs: 0,
    decodeCompileMs: 0,
    persistAndDecodeWallMs: 0,
    kernelCommitMs: 0,
  };
  try {
    let executionSnapshot = snapshot ? structuredClone(snapshot) : null;
    if (executionSnapshot) {
      assertSnapshotIdentity(executionSnapshot, claim);
      try {
        deps.model.validateInput?.(executionSnapshot);
      } catch (error) {
        attachAgentFailure(error, 'preflight', claim);
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 'NPC_AGENT_SNAPSHOT_LIMIT' || code === 'NPC_AGENT_INVALID_SNAPSHOT') {
          // Accepted input needs a durable terminal receipt even when no request was sent.
          // Never replace an existing/in-flight attempt with a local preflight verdict.
          const failed = await deps.attempts.claim(ownerId, claim);
          if (!failed.replay)
            await deps.attempts.mark(ownerId, failed.attempt, 'cancelled_before_send');
        }
        throw error;
      }
    }
    let { attempt, replay } = await deps.attempts.claim(ownerId, claim);
    let response: unknown;
    let preparedClones: { snapshot: AgentSnapshot; response: unknown } | null = null;
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
      const suppliedContext = deps.model.describeSuppliedContext?.(executionSnapshot);
      try {
        if (
          executionSnapshot.actorObservationInbox !== undefined ||
          executionSnapshot.sceneObservationContext !== undefined ||
          !!executionSnapshot.episodeResults?.length ||
          !!executionSnapshot.episodeFollowUps?.length ||
          executionSnapshot.episodeManifest !== undefined ||
          isActorEpisodeConsiderationInput(executionSnapshot.input) ||
          isAgendaInitializeInput(executionSnapshot.input) ||
          isOwnAgendaReviewInput(executionSnapshot.input) ||
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
        attachAgentFailure(error, 'send', attempt);
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
        if (
          isOwnAgendaReviewInput(executionSnapshot.input) &&
          !['EPISODE_DELIVERY_DEFERRED', 'NPC_DELIVERY_DEFERRED'].includes(
            String((error as { code?: unknown })?.code),
          ) &&
          !isKnownConflict(error)
        )
          await deps.attempts.mark(ownerId, attempt, 'cancelled_before_send');
        throw error;
      }
      if (
        attempt.status === 'cancelled_before_send' &&
        isOwnAgendaReviewInput(executionSnapshot.input)
      )
        throw Object.assign(Error('OWN_AGENDA_BUDGET_WAIT'), { code: 'OWN_AGENDA_BUDGET_WAIT' });
      let responseObtained = false;
      try {
        const tModel0 = performance.now();
        response = await deps.model.decide(executionSnapshot, signal);
        phaseTimings.modelTotalMs = performance.now() - tModel0;
        responseObtained = true;
        const tPersist0 = performance.now();
        const savePromise = deps.attempts
          .saveResponse(ownerId, attempt, {
            kind: 'npc_agent_completion',
            schemaVersion: 1,
            snapshot: executionSnapshot,
            ...(suppliedContext ? { suppliedContext } : {}),
            response,
          })
          .then(
            (saved) => {
              phaseTimings.responsePersistMs = performance.now() - tPersist0;
              return { ok: true as const, saved };
            },
            (saveError) => {
              phaseTimings.responsePersistMs = performance.now() - tPersist0;
              return { ok: false as const, saveError };
            },
          );
        // Overlap pure snapshot/response clone preparation with saveResponse I/O,
        // while keeping kernel.parse strictly after saveResponse's epoch/stale fence.
        preparedClones = {
          snapshot: structuredClone(executionSnapshot),
          response: structuredClone(response),
        };
        const saveOutcome = await savePromise;
        if (!saveOutcome.ok) throw saveOutcome.saveError;
        attempt = saveOutcome.saved;
      } catch (error) {
        attachAgentFailure(error, responseObtained ? 'response_store' : 'model', attempt);
        // Conservatively retain uncertainty if response storage or transport failed after send.
        // A failing mark must not trigger another model invocation or hide the original failure.
        const rejection = modelRequestRejection(error);
        const notSent = modelRequestNotSent(error);
        if (rejection || notSent) {
          try {
            const saved = await deps.attempts.saveResponse(ownerId, attempt, {
              kind: notSent ? 'model_preflight_rejection' : 'model_request_rejection',
              schemaVersion: 1,
              ...(rejection ?? {}),
            });
            await deps.attempts.mark(ownerId, saved, 'invalid_output');
          } catch {
            await deps.attempts.mark(ownerId, attempt, 'unknown_after_send').catch(() => {});
          }
        } else await deps.attempts.mark(ownerId, attempt, 'unknown_after_send').catch(() => {});
        throw error;
      }
    }
    if (attempt.status === 'stale_discarded') throw new AgentRunError('ATTEMPT_STALE');
    if (attempt.status === 'invalid_output') throw new AgentRunError('ATTEMPT_INVALID');
    if (!executionSnapshot) throw new AgentRunError('ATTEMPT_INVALID');
    let proposal: ReturnType<AgentKernel['parse']>;
    try {
      const tDecode0 = performance.now();
      const clones = preparedClones ?? {
        snapshot: structuredClone(executionSnapshot),
        response: structuredClone(response),
      };
      proposal = deps.kernel.parse(clones.snapshot, clones.response);
      phaseTimings.decodeCompileMs = performance.now() - tDecode0;
      phaseTimings.persistAndDecodeWallMs =
        phaseTimings.responsePersistMs + phaseTimings.decodeCompileMs;
    } catch (error) {
      phaseTimings.persistAndDecodeWallMs =
        phaseTimings.responsePersistMs + phaseTimings.decodeCompileMs;
      attachAgentFailure(error, 'decode', attempt);
      if (attempt.status !== 'committed')
        await deps.attempts.mark(ownerId, attempt, 'invalid_output');
      throw error;
    }
    try {
      // Implementations replay a committed receipt first and atomically commit all kernel objects.
      const tCommit0 = performance.now();
      const committed = await deps.kernel.commit(ownerId, {
        attempt,
        snapshot: executionSnapshot,
        proposal,
      });
      phaseTimings.kernelCommitMs = performance.now() - tCommit0;
      return committed;
    } catch (error) {
      attachAgentFailure(error, 'commit', attempt);
      if (attempt.status !== 'committed' && isKnownConflict(error))
        await deps.attempts.mark(ownerId, attempt, 'stale_discarded');
      else if (attempt.status !== 'committed' && isKnownInvalid(error))
        await deps.attempts.mark(ownerId, attempt, 'invalid_output');
      // A received response stays recoverable after a storage failure, without another paid request.
      throw error;
    }
  } finally {
    deps.onPhaseTiming?.(phaseTimings);
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
      'EPISODE_LIFECYCLE_SOURCE_CONFLICT',
      'EPISODE_RESULT_SOURCE_CONFLICT',
      'SCENE_OBSERVATION_SOURCE_CONFLICT',
      'GROUP_OBSERVATION_SOURCE_CONFLICT',
      'ACTOR_OBSERVATION_INBOX_CONFLICT',
      'SCENE_OBSERVATION_CONSUMPTION_SCOPE_CONFLICT',
      'ACTOR_SCENE_OBSERVATION_VERSION_CONFLICT',
      'ACTOR_GROUP_OBSERVATION_VERSION_CONFLICT',
    ].includes(String((error as { code?: unknown }).code ?? (error as Error).message))
  );
}

export function attemptNeedsUserRecovery(attempt: AgentAttempt): boolean {
  return attempt.status === 'unknown_after_send';
}
