import type { DirectorActorDirectionMaterial } from './director-runtime.ts';
import type { AuthoredAgentMaterialCatalog } from './authored-agent-material.ts';
import type { WorldState, Fact } from './types.ts';
export type OpeningKnowledgeModule = keyof DirectorActorDirectionMaterial['modules'];
/** A once-per-source execution permission. It never grants an NPC the full author manuscript. */
export type OpeningContextAuthority = {
  policy: 'opening_context_v1';
  reviewKey: string;
  nodeKey: string;
  nodeHash: string;
  sourceHash: string;
  initialAt: string;
  sourceField: 'script' | 'editorialIntent';
  sourceExcerpt: string;
  actorKnowledge: {
    actorId: string;
    definitionSourceId: string;
    modules: DirectorActorDirectionMaterial['modules'];
  }[];
};
export type OpeningContextReview = {
  reviewKey: string;
  disposition: 'confirm' | 'defer';
  reason: string;
  premises: {
    actorId: string;
    kind: 'opening_information';
    field: 'script' | 'editorialIntent';
    quote: string;
    knowledge: { module: OpeningKnowledgeModule; quote: string };
  }[];
};
export type NarrativeContextBasis = {
  policy: 'opening_context_v1';
  nodeKey: string;
  nodeHash: string;
  sourceHash: string;
  field: 'script' | 'editorialIntent';
  quote: string;
  decisionId: string;
  knowledge: {
    actorId: string;
    module: OpeningKnowledgeModule;
    quote: string;
    definitionSourceId: string;
    moduleHash: string;
  };
};
export type ConfirmedNarrativePremise = {
  factId: string;
  actorId: string;
  text: string;
  occurredAt: string;
  learnedAt: string;
  basis: NarrativeContextBasis;
};
export type NarrativeContextConfirmedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'narrative.context_confirmed';
  data: { directorDecisionId: string; engineEpoch: number; premises: ConfirmedNarrativePremise[] };
};
const fail = (): never => {
  throw Object.assign(Error('INVALID_OPENING_CONTEXT_REVIEW'), {
    code: 'INVALID_OPENING_CONTEXT_REVIEW',
  });
};
/** Source and bounded execution authority, not a natural-language parser or a player-action executor. */
export function validateOpeningContextReview(
  authority: OpeningContextAuthority | undefined,
  review: OpeningContextReview | undefined,
  catalog: AuthoredAgentMaterialCatalog | undefined,
): void {
  if (!review) return; // Protected pre-v10 responses remain unchanged.
  if (
    !authority ||
    authority.policy !== 'opening_context_v1' ||
    review.reviewKey !== authority.reviewKey ||
    !review.reason.trim() ||
    review.reason.length > 1600 ||
    !['confirm', 'defer'].includes(review.disposition) ||
    review.premises.length > 12 ||
    (review.disposition === 'defer' ? review.premises.length !== 0 : review.premises.length === 0)
  )
    return fail();
  const material = catalog?.materials.find(
    (m) =>
      m.ref.nodeKey === authority.nodeKey &&
      m.ref.nodeHash === authority.nodeHash &&
      m.role === 'opening',
  );
  if (
    !material ||
    catalog?.source?.sourceHash !== authority.sourceHash ||
    material.unresolvedRefs.length
  )
    return fail();
  const original = material.node[authority.sourceField] ?? '';
  const seen = new Set<string>();
  for (const premise of review.premises) {
    const own = authority.actorKnowledge.find((a) => a.actorId === premise.actorId),
      module = own?.modules[premise.knowledge.module];
    const key = JSON.stringify([premise.actorId, premise.quote]);
    if (
      premise.kind !== 'opening_information' ||
      premise.field !== authority.sourceField ||
      !own ||
      !module ||
      !material.participantRefs.some(
        (a) => a.status === 'resolved' && a.actorId === premise.actorId,
      ) ||
      premise.quote.trim().length < 6 ||
      premise.quote.length > 600 ||
      !authority.sourceExcerpt.includes(premise.quote) ||
      !original.includes(premise.quote) ||
      premise.knowledge.quote.trim().length < 6 ||
      premise.knowledge.quote.length > 300 ||
      !module.includes(premise.knowledge.quote) ||
      seen.has(key)
    )
      return fail();
    seen.add(key);
  }
}
/** No player decisions, positions, inventory, relationships, NPC attitudes or event completion are changed. */
export function applyNarrativeContextEvent(
  current: WorldState,
  event: NarrativeContextConfirmedEvent,
): WorldState {
  if (
    event.worldId !== current.id ||
    event.version !== current.version + 1 ||
    event.data.engineEpoch < 2 ||
    !Number.isFinite(Date.parse(event.storyAt))
  )
    return fail();
  return { ...current, version: event.version, time: event.storyAt };
}
export function narrativeContextFact(
  premise: ConfirmedNarrativePremise,
  knowledgeId: string,
  event: NarrativeContextConfirmedEvent,
): Fact {
  return {
    id: premise.factId,
    text: premise.text,
    kind: 'canonical',
    visibility: { kind: 'actors', actorIds: [premise.actorId] },
    sourceEventId: event.id,
    narrativeContext: { policy: 'opening_context_v1', knowledgeId, sourceVersion: event.version },
  };
}

/** The executed fact is receipt of information. Its claims never certify another capability's result. */
export function receivedOpeningInformation(quote: string): string {
  return JSON.stringify({
    type: 'received_opening_information',
    assertion: 'report',
    content: quote,
    executionEvidence: false,
  });
}
