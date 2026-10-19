import type { AgentCandidate } from '../domain/agent-runtime.ts';
/** Candidates are JSON data; object property order is not part of their identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameValue(v, b[i]))
    );
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.entries(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      ([key, value]) =>
        Object.hasOwn(b, key) && sameValue(value, (b as Record<string, unknown>)[key]),
    )
  );
}
export type DirectorCandidateFrame = {
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  candidates: readonly AgentCandidate[];
};
/** Scheduling scope only. The original snapshot reader and commit still authorize every source. */
export function admitDirectorCandidates(input: {
  current: DirectorCandidateFrame;
  pending: DirectorCandidateFrame | null;
  qualifiedOpeningAtBootstrap: boolean;
  explicitRetry: boolean;
}) {
  const { current, pending } = input;
  const keep = (candidates: readonly AgentCandidate[]) => ({
    candidates: [...candidates],
    deferredInitializationIds: current.candidates
      .filter((c) => !candidates.some((saved) => saved.id === c.id))
      .map((c) => c.id),
  });
  if (pending) {
    // Preserve an already paid frame when only fallback initialization slots
    // differ. Never omit another new condition, replace a saved candidate, or
    // disguise a changed world/epoch as a reusable response.
    const sameWorld =
      pending.worldId === current.worldId &&
      pending.engineEpoch === current.engineEpoch &&
      pending.worldVersion === current.worldVersion;
    const preserved =
      sameWorld &&
      pending.candidates.every((saved) =>
        current.candidates.some((c) => c.id === saved.id && sameValue(c, saved)),
      );
    const extras = current.candidates.filter(
      (c) => !pending.candidates.some((saved) => saved.id === c.id),
    );
    return preserved && extras.every((c) => c.source === 'agenda_initialize')
      ? keep(pending.candidates.map((saved) => current.candidates.find((c) => c.id === saved.id)!))
      : keep(current.candidates);
  }
  return input.qualifiedOpeningAtBootstrap && !input.explicitRetry
    ? keep(current.candidates.filter((c) => c.source !== 'agenda_initialize'))
    : keep(current.candidates);
}
