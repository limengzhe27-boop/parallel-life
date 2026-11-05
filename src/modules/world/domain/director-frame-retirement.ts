import { canConsiderAuthoredEvent, type DirectorSnapshot } from './director-runtime.ts';
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
  // A timed review can own only its two authored slots (no emergent slot).
  // Once the repository proves that no-response lease expired, a separately
  // authenticated disjoint window need not wait for an unrelated player action.
  // The original paid scope remains quarantined; this is not a story fact.
  const oldKeys = previous.deliberationWindow?.nodeKeys ?? [];
  const nextKeys = current.deliberationWindow?.nodeKeys ?? [];
  if (
    cause?.kind === 'periodic_review' &&
    previous.evaluationCause?.kind === 'periodic_review' &&
    cause.id !== previous.evaluationCause.id &&
    previous.worldId === current.worldId &&
    previous.engineEpoch === current.engineEpoch &&
    previous.worldVersion <= current.worldVersion &&
    !previous.nativeTurn &&
    !current.nativeTurn &&
    previous.candidates.length === 0 &&
    oldKeys.length === 2 &&
    nextKeys.length > 0 &&
    current.authoredMaterials?.source?.sourceHash &&
    current.authoredMaterials.source.sourceHash ===
      previous.authoredMaterials?.source?.sourceHash &&
    nextKeys.every((key) => !oldKeys.includes(key) && canConsiderAuthoredEvent(current, key))
  )
    return [cause.id];
  if (
    previous.worldId !== current.worldId ||
    previous.engineEpoch !== current.engineEpoch ||
    previous.worldVersion >= current.worldVersion ||
    previous.nativeTurn ||
    current.nativeTurn
  )
    return [];
  // A committed independent decision/result is global coordination work even when
  // it does not qualify an authored node. The reader authenticates the underlying
  // event; current() authenticates this exact pending range before calling us.
  const priorRefs = new Set(
    (previous.changes ?? []).map((r) =>
      JSON.stringify([r.ref.kind, 'actorId' in r.ref ? r.ref.actorId : null, r.ref.id]),
    ),
  );
  const currentIds = new Set((current.changes ?? []).map((r) => r.id));
  const independent = authenticatedReasons
    .filter(
      (r) =>
        r.worldVersion > previous.worldVersion &&
        r.worldVersion <= current.worldVersion &&
        currentIds.has(r.id) &&
        !priorRefs.has(
          JSON.stringify([r.ref.kind, 'actorId' in r.ref ? r.ref.actorId : null, r.ref.id]),
        ) &&
        ((r.kind === 'player_decision' && r.ref.kind === 'decision') ||
          (r.kind === 'action_result' && r.ref.kind === 'action_result') ||
          (r.kind === 'plan_changed' && r.ref.kind === 'plan') ||
          (r.kind === 'cross_impact' && r.ref.kind === 'event' && !!r.actorId)),
    )
    .map((r) => r.id);
  if (independent.length) return [...new Set(independent)].sort();
  if (
    !cause ||
    cause.kind === 'bootstrap' ||
    cause.kind === 'emergent_review' ||
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
