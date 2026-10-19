import type { AgentCandidate } from './agent-runtime.ts';

/**
 * Input must be the original scheduler's eligible, priority-ordered candidates.
 * This shape check is not source authorization: collectors and execution retain that duty.
 * Select existing private observation work without delegating its personal decision to Director.
 */
export function independentObservationWork(
  eligible: readonly AgentCandidate[],
): AgentCandidate | null {
  return (
    eligible.find(
      (candidate) =>
        candidate.source === 'observation' &&
        /^observation:[a-f0-9]{64}$/.test(candidate.id) &&
        candidate.episodeId === null &&
        candidate.actionId === null &&
        candidate.resourceIds.length === 0 &&
        candidate.requiresCoordination === false &&
        candidate.channel === 'private' &&
        candidate.threadId === candidate.actorId &&
        candidate.sourceIds.length > 0 &&
        candidate.sourceIds.every((id) => /^(narrative|scene|group):[a-zA-Z0-9_:-]+$/.test(id)),
    ) ?? null
  );
}
