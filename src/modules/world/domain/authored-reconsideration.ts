import type { DirectorPendingReason } from './world-awareness.ts';

/** Only verified, committed semantic evidence concerning an event's own cast.
 * Message counts, reading, elapsed time, focus and projection revisions are not evidence.
 */
export function authoredReconsiderationEvidence(
  actorIds: readonly string[],
  reasons: readonly DirectorPendingReason[],
  throughVersion: number,
): string[] {
  const actors = new Set(actorIds);
  return [
    ...new Set(
      reasons
        .filter(
          (r) =>
            r.worldVersion <= throughVersion &&
            r.worldVersion > 0 &&
            r.ref.kind !== 'event' &&
            actors.has(r.ref.actorId) &&
            ((r.kind === 'player_decision' && r.ref.kind === 'decision') ||
              (r.kind === 'plan_changed' && r.ref.kind === 'plan') ||
              (r.kind === 'action_result' && r.ref.kind === 'action_result')),
        )
        .map((r) => r.id),
    ),
  ].sort();
}
