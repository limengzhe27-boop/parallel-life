import {
  authoredDirectorSourceHandle,
  authoredMaterialCanonicalJson,
} from './authored-agent-material.ts';
import { validActorStagingIntents } from './actor-known-topic.ts';
import {
  canConsiderAuthoredEvent,
  validDirectorAuthoredAssessments,
  type DirectorDecision,
  type DirectorSnapshot,
} from './director-runtime.ts';

export type DirectorHandoffRejection =
  | 'invalid_input'
  | 'world_or_epoch_changed'
  | 'version_or_time_regressed'
  | 'not_future_authored_only'
  | 'author_source_changed'
  | 'world_boundary_changed'
  | 'cast_changed'
  | 'event_ineligible'
  | 'event_already_applied'
  | 'opportunity_scope_changed'
  | 'non_author_basis';

/** Hash this data in infrastructure; the domain neither hashes nor authorizes persistence. */
export type DirectorHandoffReadSet = {
  kind: 'authored_future_handoff_revalidation_v1';
  worldId: string;
  engineEpoch: number;
  originalWorldVersion: number;
  currentWorldVersion: number;
  currentStoryAt: string;
  originalDecision: DirectorDecision;
  source: NonNullable<NonNullable<DirectorSnapshot['authoredMaterials']>['source']>;
  boundary: DirectorSnapshot['boundary'];
  cast: NonNullable<DirectorSnapshot['cast']>;
  opportunities: {
    id: string;
    nodeKey: string;
    nodeHash: string;
    originalQualification: NonNullable<DirectorSnapshot['authoredEligibility']>[number];
    currentQualification: NonNullable<DirectorSnapshot['authoredEligibility']>[number];
  }[];
};
export type DirectorHandoffRevalidation =
  | { allowed: false; reason: DirectorHandoffRejection }
  | { allowed: true; readSet: DirectorHandoffReadSet };

const same = (a: unknown, b: unknown) =>
  authoredMaterialCanonicalJson(a) === authoredMaterialCanonicalJson(b);
const sorted = (ids: readonly string[]) => [...ids].sort();
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
const nonempty = (value: string) => typeof value === 'string' && value.trim().length > 0;

/**
 * Revalidate an ENTIRE already parsed arrangement, never reinterpret an old wire
 * response with today's source directory or select the convenient subset. This
 * grants only delivery of future tasks to independent NPCs. A caller must still
 * authenticate the protected raw/attempt, lock the current frame, save an immutable
 * application receipt and use the original Director/NPC transaction boundaries.
 */
export function revalidateDirectorHandoff(input: {
  original: DirectorSnapshot;
  current: DirectorSnapshot;
  decision: DirectorDecision;
}): DirectorHandoffRevalidation {
  try {
    return evaluate(input);
  } catch {
    // The normal parser validates canonical shapes. A malformed recovery input
    // is nevertheless a refusal, never permission to relax the original parser.
    return { allowed: false, reason: 'invalid_input' };
  }
}

function evaluate({
  original,
  current,
  decision,
}: Parameters<typeof revalidateDirectorHandoff>[0]): DirectorHandoffRevalidation {
  const deny = (reason: DirectorHandoffRejection): DirectorHandoffRevalidation => ({
    allowed: false,
    reason,
  });
  if (
    original.schemaVersion !== 1 ||
    current.schemaVersion !== 1 ||
    decision.schemaVersion !== 1 ||
    !Number.isSafeInteger(original.worldVersion) ||
    !Number.isSafeInteger(current.worldVersion) ||
    original.worldVersion < 0 ||
    current.worldVersion < 0 ||
    !nonempty(decision.id) ||
    !nonempty(decision.inputHash)
  )
    return deny('invalid_input');
  if (
    original.worldId !== current.worldId ||
    decision.worldId !== original.worldId ||
    original.engineEpoch !== current.engineEpoch ||
    decision.engineEpoch !== original.engineEpoch ||
    !Number.isSafeInteger(current.engineEpoch) ||
    current.engineEpoch < 2 ||
    original.boundary.worldId !== original.worldId ||
    current.boundary.worldId !== current.worldId
  )
    return deny('world_or_epoch_changed');
  if (
    decision.worldVersion !== original.worldVersion ||
    current.worldVersion < original.worldVersion ||
    !Number.isFinite(Date.parse(original.storyAt)) ||
    !Number.isFinite(Date.parse(current.storyAt)) ||
    Date.parse(current.storyAt) < Date.parse(original.storyAt)
  )
    return deny('version_or_time_regressed');
  if (
    original.nativeTurn ||
    current.nativeTurn ||
    decision.selectedCandidateIds.length ||
    decision.nudges.length ||
    !decision.opportunities.length ||
    decision.mode !== 'bounded_opportunity' ||
    !unique(decision.opportunities.map((o) => o.id)) ||
    decision.opportunities.some(
      (o) =>
        !nonempty(o.authoredEventKey ?? '') ||
        !o.stagingIntents?.length ||
        !validActorStagingIntents(o) ||
        (o.actorTopics !== undefined && o.actorTopics.length > 0),
    ) ||
    !validDirectorAuthoredAssessments(original, decision)
  )
    return deny('not_future_authored_only');
  const oldCatalog = original.authoredMaterials,
    catalog = current.authoredMaterials;
  if (
    !oldCatalog?.source ||
    !catalog?.source ||
    !same(oldCatalog.source, catalog.source) ||
    oldCatalog.source.worldId !== original.worldId ||
    oldCatalog.world.worldId !== original.worldId ||
    catalog.world.worldId !== current.worldId ||
    oldCatalog.world.engineEpoch !== original.engineEpoch ||
    catalog.world.engineEpoch !== current.engineEpoch ||
    oldCatalog.world.worldVersion !== original.worldVersion ||
    catalog.world.worldVersion !== current.worldVersion ||
    !same({ ...oldCatalog, world: null }, { ...catalog, world: null }) ||
    !same(original.worldSetting ?? null, current.worldSetting ?? null)
  )
    return deny('author_source_changed');
  const boundaryScope = (s: DirectorSnapshot) => ({
    actors: sorted(s.boundary.actorIds),
    places: sorted(s.boundary.placeIds),
    capabilities: sorted(s.boundary.capabilityIds),
    extension: s.boundary.extensionPermission,
  });
  if (
    current.boundary.extensionPermission !== 'none' ||
    !same(boundaryScope(original), boundaryScope(current))
  )
    return deny('world_boundary_changed');
  if (
    !original.cast ||
    !current.cast ||
    !unique(original.cast.map((a) => a.id)) ||
    !unique(current.cast.map((a) => a.id)) ||
    !same(
      [...original.cast].sort((a, b) => a.id.localeCompare(b.id)),
      [...current.cast].sort((a, b) => a.id.localeCompare(b.id)),
    )
  )
    return deny('cast_changed');
  const authorSources = new Set(catalog.materials.map(authoredDirectorSourceHandle));
  if (decision.audit.basisSourceIds.some((id) => !authorSources.has(id)))
    return deny('non_author_basis');
  const opportunities: DirectorHandoffReadSet['opportunities'] = [];
  for (const opportunity of decision.opportunities) {
    const key = opportunity.authoredEventKey!;
    if (!canConsiderAuthoredEvent(original, key) || !canConsiderAuthoredEvent(current, key))
      return deny('event_ineligible');
    if (current.episodes.some((ep) => ep.id === opportunity.id))
      return deny('event_already_applied');
    const oldMaterial = oldCatalog.materials.find((m) => m.ref.nodeKey === key)!;
    const material = catalog.materials.find((m) => m.ref.nodeKey === key)!;
    if (!same(oldMaterial.ref, material.ref)) return deny('author_source_changed');
    const sourceId = authoredDirectorSourceHandle(material);
    if (opportunity.basisSourceIds.length !== 1 || opportunity.basisSourceIds[0] !== sourceId)
      return deny('non_author_basis');
    const actors = material.participantRefs.flatMap((r) =>
      r.status === 'resolved' && r.actorId ? [r.actorId] : [],
    );
    const places = material.placeRefs.flatMap((r) =>
      r.status === 'resolved' && r.availableInWorld && r.placeId ? [r.placeId] : [],
    );
    if (
      !opportunity.participantActorIds.length ||
      !unique(opportunity.participantActorIds) ||
      !unique(opportunity.placeIds) ||
      opportunity.participantActorIds.some(
        (id) =>
          !actors.includes(id) ||
          !current.boundary.actorIds.includes(id) ||
          !current.cast!.some((a) => a.id === id),
      ) ||
      opportunity.placeIds.some(
        (id) => !places.includes(id) || !current.boundary.placeIds.includes(id),
      )
    )
      return deny('opportunity_scope_changed');
    opportunities.push({
      id: opportunity.id,
      nodeKey: key,
      nodeHash: material.ref.nodeHash,
      originalQualification: original.authoredEligibility!.find((q) => q.nodeKey === key)!,
      currentQualification: current.authoredEligibility!.find((q) => q.nodeKey === key)!,
    });
  }
  return {
    allowed: true,
    readSet: structuredClone({
      kind: 'authored_future_handoff_revalidation_v1',
      worldId: current.worldId,
      engineEpoch: current.engineEpoch,
      originalWorldVersion: original.worldVersion,
      currentWorldVersion: current.worldVersion,
      currentStoryAt: current.storyAt,
      originalDecision: decision,
      source: catalog.source,
      boundary: current.boundary,
      cast: current.cast,
      opportunities,
    }),
  };
}
