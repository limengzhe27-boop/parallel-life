import type { DirectorPendingReason } from './world-awareness.ts';

export type AuthoredReconsiderationReason = DirectorPendingReason & {
  placeId?: string | null;
  actorId?: string | null;
  subjectKind?: 'player' | 'actor';
};

/** Only verified, committed semantic evidence concerning an event's own cast and authenticated arrivals.
 * Message counts, reading, elapsed time, focus and projection revisions are not evidence.
 */
export function authoredReconsiderationEvidence(
  actorIds: readonly string[],
  reasons: readonly AuthoredReconsiderationReason[],
  throughVersion: number,
  placeIds: readonly string[] = [],
): string[] {
  const actors = new Set(actorIds);
  const places = new Set(placeIds.filter(Boolean));
  return [
    ...new Set(
      reasons
        .filter((r) => {
          if (r.worldVersion > throughVersion || r.worldVersion <= 0) return false;
          if (
            r.ref.kind !== 'event' &&
            actors.has(r.ref.actorId) &&
            ((r.kind === 'player_decision' && r.ref.kind === 'decision') ||
              (r.kind === 'plan_changed' && r.ref.kind === 'plan') ||
              (r.kind === 'action_result' && r.ref.kind === 'action_result'))
          ) {
            return true;
          }
          if (r.kind === 'new_condition' && r.placeId && places.has(r.placeId)) {
            if (r.subjectKind === 'player') return true;
            if (r.subjectKind === 'actor' && r.actorId && actors.has(r.actorId)) return true;
          }
          return false;
        })
        .map((r) => r.id),
    ),
  ].sort();
}
