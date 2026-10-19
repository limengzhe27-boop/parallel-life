import type { DirectorSnapshot } from './director-runtime.ts';
import {
  authoredReconsiderationEvidence,
  type AuthoredReconsiderationReason,
} from './authored-reconsideration.ts';

/** Ends obsolete execution permission, never resolves or retries the paid call. */
export function directorFrameRetirementEvidence(
  previous: DirectorSnapshot,
  current: DirectorSnapshot,
  authenticatedReasons: readonly AuthoredReconsiderationReason[],
): string[] {
  const cause = current.evaluationCause;
  if (
    previous.worldId !== current.worldId ||
    previous.engineEpoch !== current.engineEpoch ||
    previous.worldVersion >= current.worldVersion ||
    previous.nativeTurn ||
    current.nativeTurn ||
    !cause ||
    cause.kind === 'bootstrap' ||
    cause.id === previous.evaluationCause?.id ||
    !current.authoredMaterials?.source ||
    current.authoredMaterials.source.sourceHash !== previous.authoredMaterials?.source?.sourceHash
  )
    return [];
  const keys =
    cause.kind === 'opening_context'
      ? [current.authoredMaterials.openingEventKey]
      : cause.qualifications.map((q) => q.nodeKey);
  const relevant = authenticatedReasons.filter((r) => r.worldVersion > previous.worldVersion);
  return [
    ...new Set(
      current.authoredMaterials.materials
        .filter((m) => keys.includes(m.ref.nodeKey))
        .flatMap((m) =>
          authoredReconsiderationEvidence(
            m.participantRefs.flatMap((a) =>
              a.status === 'resolved' && a.actorId ? [a.actorId] : [],
            ),
            relevant,
            current.worldVersion,
            m.placeRefs.flatMap((p) =>
              p.status === 'resolved' && p.availableInWorld && p.placeId ? [p.placeId] : [],
            ),
          ),
        ),
    ),
  ].sort();
}
