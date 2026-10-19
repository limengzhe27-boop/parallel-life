import { OpeningModule } from './opening-context-schema.ts';
import { isDirectorDeliberationEvent } from '../domain/director-runtime.ts';
import { z } from 'zod';
import type { ModelOutputOptions } from '../../ai/application/ports.ts';
import type { DirectorSnapshot } from '../domain/director-runtime.ts';
import { canConsiderAuthoredEvent } from '../domain/director-runtime.ts';
import { projectAuthoredDirectorModelView } from '../domain/authored-agent-material.ts';

export const DIRECTOR_WIRE_PROTOCOL = 'director-wire-v14';
const PREVIOUS_ACTOR_ASSIGNMENT_PROTOCOL = 'director-wire-v13';
const PREVIOUS_ATTRIBUTION_PROTOCOL = 'director-wire-v12';
const PREVIOUS_REFERENCE_PROTOCOL = 'director-wire-v11';
const PREVIOUS_OPENING_PROTOCOL = 'director-wire-v10';
const PREVIOUS_INTERACTION_PROTOCOL = 'director-wire-v9';
const PREVIOUS_ACTOR_TASK_PROTOCOL = 'director-wire-v8';
const PREVIOUS_EXCLUSIVE_PROTOCOL = 'director-wire-v7';
const PREVIOUS_GROUP_PROTOCOL = 'director-wire-v6';
const PREVIOUS_SINGLE_CHOICE_PROTOCOL = 'director-wire-v5';
const PREVIOUS_ASSESSMENT_PROTOCOL = 'director-wire-v4';
const Key = z.string().min(1).max(240);
const Reason = z.string().trim().min(1).max(2000);
const Ref = z.string().regex(/^(candidate|actor|place|source|event):[1-9][0-9]*$/);
const Nudge = z.enum([
  'continue_own_plan',
  'reassess_own_responsibility',
  'respond_to_player',
  'consider_opportunity',
]);
const Wire = z.strictObject({
  protocol: z.enum([
    'director-wire-v1',
    'director-wire-v2',
    'director-wire-v3',
    PREVIOUS_ASSESSMENT_PROTOCOL,
  ]),
  mode: z.enum(['quiet', 'coordinate', 'bounded_opportunity']),
  events: z
    .array(
      z.strictObject({ eventRef: Ref, decision: z.enum(['consider', 'defer']), reason: Reason }),
    )
    .max(10000)
    .optional(),
  candidates: z
    .array(
      z.discriminatedUnion('decision', [
        z.strictObject({ ref: Ref, decision: z.literal('select'), nudge: Nudge.optional() }),
        z.strictObject({ ref: Ref, decision: z.literal('defer'), reason: Reason }),
      ]),
    )
    .max(128),
  opportunities: z
    .array(
      z.strictObject({
        id: Key,
        title: z.string().trim().min(1).max(120),
        description: Reason,
        playerImpact: z.string().trim().min(1).max(1000),
        actors: z.array(Ref).min(1).max(12),
        places: z.array(Ref).max(12),
        activity: z.enum(['conversation', 'meeting', 'follow_up']),
        origin: z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('authored'), eventRef: Ref }),
          z.strictObject({ kind: z.literal('emergent'), sourceRefs: z.array(Ref).min(1).max(32) }),
        ]),
        stagingIntents: z
          .array(
            z.strictObject({
              actorRef: Ref,
              kind: z.literal('future_task'),
              task: z.string().trim().min(1).max(600),
            }),
          )
          .min(1)
          .max(12)
          .optional(),
        actorTopics: z
          .array(
            z.strictObject({
              actorRef: Ref,
              refs: z
                .array(z.strictObject({ id: Key, contentHash: z.string().regex(/^[a-f0-9]{64}$/) }))
                .min(1)
                .max(4),
            }),
          )
          .min(1)
          .max(12)
          .optional(),
      }),
    )
    .max(2),
  audit: z.strictObject({ reason: Reason, sourceRefs: z.array(Ref).max(64) }),
});

/** A chosen authored opportunity is its consideration; only the remaining events are deferred. */
const PreviousSingleChoiceWire = Wire.omit({ mode: true, events: true }).extend({
  protocol: z.literal(PREVIOUS_SINGLE_CHOICE_PROTOCOL),
  events: z.array(z.strictObject({ eventRef: Ref, reason: Reason })).max(10000),
});

const PreviousGroupWire = PreviousSingleChoiceWire.extend({
  protocol: z.literal(PREVIOUS_GROUP_PROTOCOL),
});
const AuthorOpportunity = PreviousGroupWire.shape.opportunities.element.omit({ origin: true });
const PreviousExclusiveWire = PreviousGroupWire.omit({ events: true }).extend({
  protocol: z.literal(PREVIOUS_EXCLUSIVE_PROTOCOL),
  authoredChoices: z.record(
    Ref,
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('defer'), reason: Reason }),
      z.strictObject({
        kind: z.literal('consider'),
        opportunities: z.array(AuthorOpportunity).min(1).max(2),
      }),
    ]),
  ),
  opportunities: z
    .array(
      PreviousGroupWire.shape.opportunities.element.extend({
        origin: z.strictObject({
          kind: z.literal('emergent'),
          sourceRefs: z.array(Ref).min(1).max(32),
        }),
      }),
    )
    .max(2),
});
const SingleAuthorOpportunity = AuthorOpportunity.omit({
  id: true,
  actors: true,
  stagingIntents: true,
}).extend({
  actorTasks: z.record(Ref, z.strictObject({ task: z.string().trim().min(1).max(600) }).nullable()),
});
const PreviousActorTaskWire = PreviousExclusiveWire.extend({
  protocol: z.literal(PREVIOUS_ACTOR_TASK_PROTOCOL),
  authoredChoices: z.record(
    Ref,
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('defer'), reason: Reason }),
      z.strictObject({ kind: z.literal('consider'), opportunity: SingleAuthorOpportunity }),
    ]),
  ),
});

/** Explicit actor-owned future interaction, never a fact, final line or accepted player action. */
const ActorInteraction = z.strictObject({
  topic: z.string().trim().min(1).max(140),
  personalObjective: z.string().trim().min(1).max(140),
  proposedInteraction: z.string().trim().min(1).max(140),
});
const PreviousInteractionWire = PreviousActorTaskWire.extend({
  protocol: z.literal(PREVIOUS_INTERACTION_PROTOCOL),
  authoredChoices: z.record(
    Ref,
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('defer'), reason: Reason }),
      z.strictObject({
        kind: z.literal('consider'),
        opportunity: SingleAuthorOpportunity.extend({
          actorTasks: z.record(Ref, ActorInteraction.nullable()),
        }),
      }),
    ]),
  ),
});
const PreviousOpeningWire = PreviousInteractionWire.extend({
  protocol: z.literal(PREVIOUS_OPENING_PROTOCOL),
  openingContext: z
    .strictObject({
      disposition: z.enum(['confirm', 'defer']),
      reason: z.string().trim().min(1).max(1600),
      premises: z
        .array(
          z.strictObject({
            actorRef: Ref,
            kind: z.literal('opening_information'),
            field: z.enum(['script', 'editorialIntent']),
            quote: z.string().min(6).max(600),
            knowledge: z.strictObject({ module: OpeningModule, quote: z.string().min(6).max(300) }),
          }),
        )
        .max(12),
    })
    .nullable(),
});
const OpeningReferencePremise = z.strictObject({
  actorRef: Ref,
  informationRef: z.string().regex(/^opening-info:[1-9][0-9]*$/),
  identityRef: z.string().regex(/^opening-identity:[1-9][0-9]*$/),
});
const PreviousReferenceWire = PreviousInteractionWire.extend({
  protocol: z.literal(PREVIOUS_REFERENCE_PROTOCOL),
  openingContext: z
    .discriminatedUnion('disposition', [
      z.strictObject({
        disposition: z.literal('confirm'),
        reason: z.string().trim().min(1).max(1600),
        premises: z.array(OpeningReferencePremise).min(1).max(12),
      }),
      z.strictObject({
        disposition: z.literal('defer'),
        reason: z.string().trim().min(1).max(1600),
        premises: z.array(OpeningReferencePremise).max(0),
      }),
    ])
    .nullable(),
});
const OpeningNonAdmissionReason = z.enum([
  'not_information',
  'conditional_future',
  'identity_unresolved',
  'other_actor_private',
]);
const OpeningInformationChoice = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('actor_information'),
    actorRef: Ref,
    identityRef: z.string().regex(/^opening-identity:[1-9][0-9]*$/),
  }),
  z.strictObject({
    kind: z.literal('not_admitted'),
    reasonKind: OpeningNonAdmissionReason,
    reason: z.string().trim().min(1).max(600),
  }),
]);
const PreviousAttributionWire = PreviousInteractionWire.extend({
  protocol: z.literal(PREVIOUS_ATTRIBUTION_PROTOCOL),
  openingContext: z
    .strictObject({
      informationChoices: z.record(
        z.string().regex(/^opening-info:[1-9][0-9]*$/),
        OpeningInformationChoice,
      ),
    })
    .nullable(),
});
const PreviousActorAssignmentWire = PreviousInteractionWire.extend({
  protocol: z.literal(PREVIOUS_ACTOR_ASSIGNMENT_PROTOCOL),
  openingContext: z
    .strictObject({
      actorAssignments: z.record(
        Ref,
        z.strictObject({
          informationRefs: z.array(z.string().regex(/^opening-info:[1-9][0-9]*$/)).max(2),
          reason: z.string().trim().min(1).max(600),
        }),
      ),
    })
    .nullable(),
});
const CurrentWire = PreviousInteractionWire.extend({
  protocol: z.literal(DIRECTOR_WIRE_PROTOCOL),
  openingContext: z
    .strictObject({
      informationOwners: z.record(
        z.string().regex(/^opening-info:[1-9][0-9]*$/),
        z.strictObject({ actorRef: Ref.nullable(), reason: z.string().trim().min(1).max(600) }),
      ),
    })
    .nullable(),
});
/** Exact source fragments only: no model summary or inferred fact is introduced. */
function openingSourceFragments(text: string, limit: number, count: number): string[] {
  const result: string[] = [];
  let pending = '';
  const emit = (value: string) => {
    let remaining = value.trim();
    while (remaining.length >= 6 && result.length < count) {
      let end = Math.min(limit, remaining.length);
      if (remaining.length > end && remaining.length - end < 6) end -= 6 - (remaining.length - end);
      const piece = remaining.slice(0, end).trim();
      if (piece.length >= 6 && !result.includes(piece)) result.push(piece);
      remaining = remaining.slice(end).trim();
    }
  };
  for (const piece of text.split(/(?<=[。！？!?，,；;\n])/u)) {
    pending += piece;
    if (pending.trim().length >= 6) {
      emit(pending);
      pending = '';
    }
    if (result.length >= count) break;
  }
  if (pending.trim().length >= 6) emit(pending);
  return result;
}
export function directorOpeningInformationCatalog(
  snapshot: DirectorSnapshot,
  protocol: 'v11' | 'v12' = 'v12',
): {
  information: { ref: string; text: string }[];
  identities: {
    ref: string;
    actorRef: string;
    module: z.infer<typeof OpeningModule>;
    text: string;
  }[];
} {
  const authority = snapshot.openingContextAuthority;
  if (!authority) return { information: [], identities: [] };
  const information = openingSourceFragments(
    authority.sourceExcerpt,
    600,
    protocol === 'v11' ? 24 : 12,
  ).map((text, i) => ({
    ref: `opening-info:${i + 1}`,
    text,
  }));
  const identities: {
    ref: string;
    actorRef: string;
    module: z.infer<typeof OpeningModule>;
    text: string;
  }[] = [];
  const actors = directorWireCatalog(snapshot).actors;
  for (const actor of actors) {
    const own = authority.actorKnowledge.find((k) => k.actorId === actor.actorId);
    if (!own) continue;
    for (const module of OpeningModule.options)
      for (const text of openingSourceFragments(own.modules[module] ?? '', 300, 3))
        identities.push({
          ref: `opening-identity:${identities.length + 1}`,
          actorRef: actor.ref,
          module,
          text,
        });
  }
  return { information, identities };
}
/** Small role-bound catalog for the model; private identity excerpts remain server-side. */
export function directorOpeningActorCatalog(snapshot: DirectorSnapshot): {
  information: { ref: string; text: string }[];
  actors: { actorRef: string; name: string; canAttribute: boolean }[];
} {
  const opening = directorOpeningInformationCatalog(snapshot);
  return {
    information: opening.information,
    actors: directorWireCatalog(snapshot).actors.map((actor) => ({
      actorRef: actor.ref,
      name: actor.name ?? actor.ref,
      canAttribute: opening.identities.some((identity) => identity.actorRef === actor.ref),
    })),
  };
}
/** v14-only format metadata filtering. Older paid catalogs retain their exact original indexing. */
export function directorOpeningOwnerCatalog(
  snapshot: DirectorSnapshot,
): ReturnType<typeof directorOpeningActorCatalog> {
  const old = directorOpeningActorCatalog(snapshot),
    authority = snapshot.openingContextAuthority;
  if (!authority) return old;
  const lines = authority.sourceExcerpt.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().length > 0);
  const information: { ref: string; text: string }[] = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim(),
      markdown = /^(?:#{1,6}\s|\*\*|__)/.test(trimmed);
    const label = trimmed
      .replace(/^#{1,6}\s*/, '')
      .replace(/^(?:\*\*|__)/, '')
      .replace(/(?:\*\*|__)$/, '')
      .trim();
    if (index === first && /^开场事件\s*[:：]/.test(label)) continue;
    if (markdown && /^(?:场景|地点|Scene)\s*[:：]/i.test(label)) continue;
    for (const text of openingSourceFragments(line, 600, 12 - information.length))
      information.push({ ref: `opening-info:${information.length + 1}`, text });
    if (information.length >= 12) break;
  }
  return { ...old, information };
}
const openingActorAssignmentLimit = (actorCount: number) =>
  actorCount ? Math.min(2, Math.floor(12 / actorCount)) : 0;
function compiledActorInteraction(value: z.infer<typeof ActorInteraction>): string {
  const task = JSON.stringify({ protocol: 'actor-interaction-opportunity-v1', ...value });
  // JSON escaping can expand author text; never truncate or silently lose a field.
  if (task.length > 600) throw Error('DIRECTOR_ACTOR_INTERACTION_LIMIT');
  return task;
}

type Opportunity = z.infer<typeof PreviousGroupWire>['opportunities'][number];
/** v6 only: multiple independent cast tasks can describe the same shared authored opportunity. */
function groupAuthoredOpportunities(items: Opportunity[]): Opportunity[] {
  if (new Set(items.map((o) => o.id)).size !== items.length)
    throw Error('DIRECTOR_GROUP_ID_CONFLICT');
  const grouped: Opportunity[] = [];
  const mergeText = (a: string, b: string, limit: number, separator: string) => {
    const combined = `${a}${separator}${b}`;
    if (combined.length > limit) throw Error('DIRECTOR_GROUP_TEXT_LIMIT');
    return combined;
  };
  for (const item of items) {
    if (
      new Set(item.actors).size !== item.actors.length ||
      new Set(item.places).size !== item.places.length
    )
      throw Error('DIRECTOR_GROUP_DUPLICATE_REF');
    if (
      !item.stagingIntents ||
      item.stagingIntents.length !== item.actors.length ||
      new Set(item.stagingIntents.map((t) => t.actorRef)).size !== item.actors.length ||
      item.stagingIntents.some((t) => !item.actors.includes(t.actorRef)) ||
      (item.actorTopics &&
        (item.actorTopics.length !== item.actors.length ||
          new Set(item.actorTopics.map((t) => t.actorRef)).size !== item.actors.length ||
          item.actorTopics.some((t) => !item.actors.includes(t.actorRef))))
    )
      throw Error('DIRECTOR_GROUP_TASK_SCOPE');
    const existing =
      item.origin.kind === 'authored'
        ? grouped.find(
            (o) =>
              o.origin.kind === 'authored' &&
              o.origin.eventRef === (item.origin as { eventRef: string }).eventRef,
          )
        : undefined;
    if (!existing) {
      grouped.push(structuredClone(item));
      continue;
    }
    if (
      existing.activity !== item.activity ||
      JSON.stringify([...existing.places].sort()) !== JSON.stringify([...item.places].sort()) ||
      existing.actors.some((actor) => item.actors.includes(actor)) ||
      existing.actors.length + item.actors.length > 12 ||
      !existing.stagingIntents ||
      !item.stagingIntents
    )
      throw Error('DIRECTOR_GROUP_INCOMPATIBLE');
    existing.actors.push(...item.actors);
    existing.stagingIntents.push(...item.stagingIntents);
    if (existing.actorTopics || item.actorTopics)
      existing.actorTopics = [...(existing.actorTopics ?? []), ...(item.actorTopics ?? [])];
    existing.title = mergeText(existing.title, item.title, 120, ' / ');
    existing.description = mergeText(existing.description, item.description, 2000, '\n');
    existing.playerImpact = mergeText(existing.playerImpact, item.playerImpact, 1000, '\n');
  }
  return grouped;
}

/** References are scoped to the immutable attempt snapshot, never a live world lookup. */
export function directorWireCatalog(snapshot: DirectorSnapshot) {
  const materials = snapshot.authoredMaterials
    ? projectAuthoredDirectorModelView(snapshot.authoredMaterials).materials
    : [];
  const sources = [
    ...new Set(
      [
        ...snapshot.observations.map((o) => o.sourceId),
        ...snapshot.episodes.map((e) => e.origin.sourceId),
        ...snapshot.candidates.flatMap((c) => c.sourceIds),
      ].filter((id) => !id.startsWith('authored:')),
    ),
  ];
  return {
    candidates: snapshot.candidates.map((c, i) => ({
      ref: `candidate:${i + 1}`,
      candidateId: c.id,
    })),
    actors: snapshot.boundary.actorIds.map((id, i) => ({
      ref: `actor:${i + 1}`,
      actorId: id,
      // Bind the semantic identity to the same scoped ref; cast order is not a mapping.
      ...(snapshot.cast?.find((actor) => actor.id === id)
        ? { name: snapshot.cast.find((actor) => actor.id === id)!.name }
        : {}),
    })),
    places: snapshot.boundary.placeIds.map((id, i) => ({ ref: `place:${i + 1}`, placeId: id })),
    sources: sources.map((id, i) => ({ ref: `source:${i + 1}`, sourceId: id })),
    events: materials
      .filter((m) => isDirectorDeliberationEvent(snapshot, m.ref.nodeKey))
      .map((m, i) => ({
        ref: `event:${i + 1}`,
        authoredEventKey: m.ref.nodeKey,
        sourceId: m.sourceId,
      })),
  };
}

/** Fresh bootstrap opportunities must consider the eligible authored opening, not replace it. */
export function bootstrapOpeningEventRefs(snapshot: DirectorSnapshot): string[] {
  if (snapshot.evaluationCause?.kind !== 'bootstrap') return [];
  const openings = new Set(
    snapshot.authoredMaterials?.materials
      .filter((m) => m.role === 'opening' && canConsiderAuthoredEvent(snapshot, m.ref.nodeKey))
      .map((m) => m.ref.nodeKey) ?? [],
  );
  return directorWireCatalog(snapshot)
    .events.filter((e) => openings.has(e.authoredEventKey))
    .map((e) => e.ref);
}

/** Decode transport only: no inferred selections, new authority or model retry. Canonical validation follows. */
export function decodeDirectorWire(snapshot: DirectorSnapshot, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('protocol' in raw)) return raw; // Stored pre-wire completions.
  // Strict-provider nullable optionals are transport syntax, never a semantic default.
  let normalized = structuredClone(raw) as Record<string, unknown>;
  if (Array.isArray(normalized.candidates))
    for (const choice of normalized.candidates) {
      if (choice && choice.nudge === null) delete choice.nudge;
    }
  if (Array.isArray(normalized.opportunities))
    for (const opportunity of normalized.opportunities) {
      if (opportunity && opportunity.actorTopics === null) delete opportunity.actorTopics;
    }
  // Nullable provider optionals are transport syntax for both v9 and v10.
  if (
    [
      DIRECTOR_WIRE_PROTOCOL,
      PREVIOUS_ACTOR_ASSIGNMENT_PROTOCOL,
      PREVIOUS_ATTRIBUTION_PROTOCOL,
      PREVIOUS_REFERENCE_PROTOCOL,
      PREVIOUS_OPENING_PROTOCOL,
      PREVIOUS_INTERACTION_PROTOCOL,
    ].includes(String(normalized.protocol))
  ) {
    const choices = normalized.authoredChoices;
    if (choices && typeof choices === 'object' && !Array.isArray(choices))
      for (const choice of Object.values(choices)) {
        if (
          choice &&
          typeof choice === 'object' &&
          'opportunity' in choice &&
          choice.opportunity &&
          typeof choice.opportunity === 'object' &&
          'actorTopics' in choice.opportunity &&
          choice.opportunity.actorTopics === null
        )
          delete choice.opportunity.actorTopics;
      }
  }
  if (normalized.protocol === DIRECTOR_WIRE_PROTOCOL) {
    const wire = CurrentWire.parse(normalized),
      { openingContext, ...rest } = wire,
      authority = snapshot.openingContextAuthority;
    if (!authority && openingContext !== null) throw Error('DIRECTOR_OPENING_CONTEXT_FORBIDDEN');
    if (authority && openingContext === null) throw Error('DIRECTOR_OPENING_REVIEW_REQUIRED');
    if (!openingContext)
      return decodeDirectorWire(snapshot, {
        ...rest,
        protocol: PREVIOUS_OPENING_PROTOCOL,
        openingContext: null,
      });
    const catalog = directorOpeningOwnerCatalog(snapshot),
      privateCatalog = directorOpeningInformationCatalog(snapshot);
    const keys = Object.keys(openingContext.informationOwners);
    if (
      keys.length !== catalog.information.length ||
      keys.some((ref) => !catalog.information.some((info) => info.ref === ref))
    )
      throw Error('DIRECTOR_OPENING_OWNER_COVERAGE');
    const premises = catalog.information.flatMap((info) => {
      const owner = openingContext.informationOwners[info.ref]!;
      if (owner.actorRef === null) return [];
      const actor = catalog.actors.find(
        (actor) => actor.actorRef === owner.actorRef && actor.canAttribute,
      );
      const identities = privateCatalog.identities.filter(
        (identity) => identity.actorRef === owner.actorRef,
      );
      const identity =
        identities.find((identity) => identity.module === 'lifeContext') ?? identities[0];
      if (!actor || !identity || !authority) throw Error('DIRECTOR_OPENING_OWNER_FORBIDDEN');
      return [
        {
          actorRef: actor.actorRef,
          kind: 'opening_information',
          field: authority.sourceField,
          quote: info.text,
          knowledge: { module: identity.module, quote: identity.text },
        },
      ];
    });
    return decodeDirectorWire(snapshot, {
      ...rest,
      protocol: PREVIOUS_OPENING_PROTOCOL,
      openingContext: {
        disposition: premises.length ? 'confirm' : 'defer',
        reason: `Single-owner source attribution: ${premises.length} information receipts. Per-source judgments remain in the protected response.`,
        premises,
      },
    });
  }
  if (normalized.protocol === PREVIOUS_ACTOR_ASSIGNMENT_PROTOCOL) {
    const wire = PreviousActorAssignmentWire.parse(normalized),
      { openingContext, ...rest } = wire,
      authority = snapshot.openingContextAuthority;
    if (!authority && openingContext !== null) throw Error('DIRECTOR_OPENING_CONTEXT_FORBIDDEN');
    if (authority && openingContext === null) throw Error('DIRECTOR_OPENING_REVIEW_REQUIRED');
    if (!openingContext)
      return decodeDirectorWire(snapshot, {
        ...rest,
        protocol: PREVIOUS_REFERENCE_PROTOCOL,
        openingContext: null,
      });
    const catalog = directorOpeningActorCatalog(snapshot),
      privateCatalog = directorOpeningInformationCatalog(snapshot);
    const keys = Object.keys(openingContext.actorAssignments);
    if (
      keys.length !== catalog.actors.length ||
      keys.some((ref) => !catalog.actors.some((actor) => actor.actorRef === ref))
    )
      throw Error('DIRECTOR_OPENING_ACTOR_COVERAGE');
    const used = new Set<string>(),
      cap = openingActorAssignmentLimit(catalog.actors.length);
    const premises = catalog.actors.flatMap((actor) => {
      const assignment = openingContext.actorAssignments[actor.actorRef]!;
      if (assignment.informationRefs.length > (actor.canAttribute ? cap : 0))
        throw Error('DIRECTOR_OPENING_ACTOR_LIMIT');
      const identities = privateCatalog.identities.filter((i) => i.actorRef === actor.actorRef);
      const identity = identities.find((i) => i.module === 'lifeContext') ?? identities[0];
      return assignment.informationRefs.map((ref) => {
        if (!identity || !catalog.information.some((i) => i.ref === ref) || used.has(ref))
          throw Error('DIRECTOR_OPENING_ACTOR_REFERENCE');
        used.add(ref);
        return { actorRef: actor.actorRef, informationRef: ref, identityRef: identity.ref };
      });
    });
    return decodeDirectorWire(snapshot, {
      ...rest,
      protocol: PREVIOUS_REFERENCE_PROTOCOL,
      openingContext: {
        disposition: premises.length ? 'confirm' : 'defer',
        reason: `Actor-scoped source assignment: ${premises.length} information receipts. Individual judgments remain in the protected response.`,
        premises,
      },
    });
  }
  if (normalized.protocol === PREVIOUS_ATTRIBUTION_PROTOCOL) {
    const wire = PreviousAttributionWire.parse(normalized);
    const { openingContext, ...rest } = wire;
    const authority = snapshot.openingContextAuthority;
    if (!authority && openingContext !== null) throw Error('DIRECTOR_OPENING_CONTEXT_FORBIDDEN');
    if (authority && openingContext === null) throw Error('DIRECTOR_OPENING_REVIEW_REQUIRED');
    if (!openingContext)
      return decodeDirectorWire(snapshot, {
        ...rest,
        protocol: PREVIOUS_REFERENCE_PROTOCOL,
        openingContext: null,
      });
    const catalog = directorOpeningInformationCatalog(snapshot);
    const keys = Object.keys(openingContext.informationChoices);
    if (
      keys.length !== catalog.information.length ||
      keys.some((ref) => !catalog.information.some((i) => i.ref === ref))
    )
      throw Error('DIRECTOR_OPENING_INFORMATION_COVERAGE');
    const premises = catalog.information.flatMap((information) => {
      const choice = openingContext.informationChoices[information.ref]!;
      if (choice.kind === 'not_admitted') return [];
      const identity = catalog.identities.find((i) => i.ref === choice.identityRef);
      if (!identity || identity.actorRef !== choice.actorRef)
        throw Error('DIRECTOR_OPENING_REFERENCE_FORBIDDEN');
      return [
        { actorRef: choice.actorRef, informationRef: information.ref, identityRef: identity.ref },
      ];
    });
    return decodeDirectorWire(snapshot, {
      ...rest,
      protocol: PREVIOUS_REFERENCE_PROTOCOL,
      openingContext: {
        disposition: premises.length ? 'confirm' : 'defer',
        reason: `Scoped information attribution: ${premises.length} admitted and ${catalog.information.length - premises.length} not admitted. Per-item source judgments are retained in the protected response.`,
        premises,
      },
    });
  }
  if (normalized.protocol === PREVIOUS_REFERENCE_PROTOCOL) {
    const wire = PreviousReferenceWire.parse(normalized);
    const { openingContext, ...rest } = wire;
    const authority = snapshot.openingContextAuthority;
    if (!authority && openingContext !== null) throw Error('DIRECTOR_OPENING_CONTEXT_FORBIDDEN');
    if (authority && openingContext === null) throw Error('DIRECTOR_OPENING_REVIEW_REQUIRED');
    const catalog = directorOpeningInformationCatalog(snapshot, 'v11');
    return decodeDirectorWire(snapshot, {
      ...rest,
      protocol: PREVIOUS_OPENING_PROTOCOL,
      openingContext:
        openingContext === null
          ? null
          : {
              ...openingContext,
              premises: openingContext.premises.map((p) => {
                const information = catalog.information.find((i) => i.ref === p.informationRef);
                const identity = catalog.identities.find((i) => i.ref === p.identityRef);
                if (!authority || !information || !identity || identity.actorRef !== p.actorRef)
                  throw Error('DIRECTOR_OPENING_REFERENCE_FORBIDDEN');
                return {
                  actorRef: p.actorRef,
                  kind: 'opening_information',
                  field: authority.sourceField,
                  quote: information.text,
                  knowledge: { module: identity.module, quote: identity.text },
                };
              }),
            },
    });
  }
  if (normalized.protocol === PREVIOUS_OPENING_PROTOCOL) {
    const wire = PreviousOpeningWire.parse(normalized);
    const { openingContext, ...rest } = wire;
    if (!snapshot.openingContextAuthority && openingContext !== null)
      throw Error('DIRECTOR_OPENING_CONTEXT_FORBIDDEN');
    const old = decodeDirectorWire(snapshot, {
      ...rest,
      protocol: PREVIOUS_INTERACTION_PROTOCOL,
    }) as Record<string, unknown>;
    if (!openingContext) {
      if (snapshot.openingContextAuthority) throw Error('DIRECTOR_OPENING_REVIEW_REQUIRED');
      return old;
    }
    const actors = directorWireCatalog(snapshot).actors;
    return {
      ...old,
      ...(openingContext.disposition === 'confirm' &&
      openingContext.premises.length &&
      old.mode === 'quiet'
        ? { mode: 'coordinate' }
        : {}),
      openingContext: {
        ...openingContext,
        reviewKey: snapshot.openingContextAuthority!.reviewKey,
        premises: openingContext.premises.map(({ actorRef, ...p }) => {
          const actor = actors.find((a) => a.ref === actorRef);
          if (!actor) throw Error('DIRECTOR_OPENING_CONTEXT_ACTOR');
          return { ...p, actorId: actor.actorId };
        }),
      },
    };
  }
  if (normalized.protocol === PREVIOUS_INTERACTION_PROTOCOL) {
    const choices = normalized.authoredChoices;
    if (choices && typeof choices === 'object' && !Array.isArray(choices))
      for (const choice of Object.values(choices))
        if (
          choice &&
          typeof choice === 'object' &&
          'opportunity' in choice &&
          choice.opportunity &&
          typeof choice.opportunity === 'object' &&
          'actorTopics' in choice.opportunity &&
          choice.opportunity.actorTopics === null
        )
          delete choice.opportunity.actorTopics;
    const current = PreviousInteractionWire.parse(normalized);
    normalized = {
      ...current,
      protocol: PREVIOUS_ACTOR_TASK_PROTOCOL,
      authoredChoices: Object.fromEntries(
        Object.entries(current.authoredChoices).map(([ref, choice]) => [
          ref,
          choice.kind === 'defer'
            ? choice
            : {
                ...choice,
                opportunity: {
                  ...choice.opportunity,
                  actorTasks: Object.fromEntries(
                    Object.entries(choice.opportunity.actorTasks).map(([actor, value]) => [
                      actor,
                      value === null ? null : { task: compiledActorInteraction(value) },
                    ]),
                  ),
                },
              },
        ]),
      ),
    };
  }
  if (normalized.protocol === PREVIOUS_ACTOR_TASK_PROTOCOL) {
    const choices = normalized.authoredChoices;
    if (choices && typeof choices === 'object' && !Array.isArray(choices))
      for (const choice of Object.values(choices))
        if (
          choice &&
          typeof choice === 'object' &&
          'opportunity' in choice &&
          choice.opportunity &&
          typeof choice.opportunity === 'object' &&
          'actorTopics' in choice.opportunity &&
          choice.opportunity.actorTopics === null
        )
          delete choice.opportunity.actorTopics;
    const current = PreviousActorTaskWire.parse(normalized);
    const catalog = directorWireCatalog(snapshot);
    const actorRefs = catalog.actors.map((a) => a.ref);
    const authoredChoices: Record<string, unknown> = {};
    for (const [eventRef, choice] of Object.entries(current.authoredChoices)) {
      if (choice.kind === 'defer') {
        authoredChoices[eventRef] = choice;
        continue;
      }
      const { actorTasks, ...rest } = choice.opportunity;
      const keys = Object.keys(actorTasks);
      if (keys.length !== actorRefs.length || keys.some((key) => !actorRefs.includes(key)))
        throw Error('DIRECTOR_ACTOR_TASK_PARTITION');
      const selected = actorRefs.filter((ref) => actorTasks[ref] !== null);
      if (!selected.length) throw Error('DIRECTOR_ACTOR_TASK_EMPTY');
      authoredChoices[eventRef] = {
        kind: 'consider',
        opportunities: [
          {
            ...rest,
            id: `authored_event_${eventRef.slice('event:'.length)}`,
            actors: selected,
            stagingIntents: selected.map((actorRef) => ({
              actorRef,
              kind: 'future_task',
              task: actorTasks[actorRef]!.task,
            })),
          },
        ],
      };
    }
    normalized = { ...current, protocol: PREVIOUS_EXCLUSIVE_PROTOCOL, authoredChoices };
  }
  if (normalized.protocol === PREVIOUS_EXCLUSIVE_PROTOCOL) {
    // Nullable optional actorTopics remains transport syntax inside each explicit author choice.
    const choices = normalized.authoredChoices;
    if (choices && typeof choices === 'object' && !Array.isArray(choices))
      for (const choice of Object.values(choices))
        if (
          choice &&
          typeof choice === 'object' &&
          'opportunities' in choice &&
          Array.isArray(choice.opportunities)
        )
          for (const opportunity of choice.opportunities)
            if (opportunity && opportunity.actorTopics === null) delete opportunity.actorTopics;
    const current = PreviousExclusiveWire.parse(normalized);
    const refs = directorWireCatalog(snapshot).events.map((e) => e.ref);
    const keys = Object.keys(current.authoredChoices);
    if (keys.length !== refs.length || keys.some((key) => !refs.includes(key)))
      throw Error('DIRECTOR_AUTHORED_CHOICE_PARTITION');
    normalized = {
      protocol: PREVIOUS_GROUP_PROTOCOL,
      candidates: current.candidates,
      events: Object.entries(current.authoredChoices).flatMap(([eventRef, choice]) =>
        choice.kind === 'defer' ? [{ eventRef, reason: choice.reason }] : [],
      ),
      opportunities: [
        ...Object.entries(current.authoredChoices).flatMap(([eventRef, choice]) =>
          choice.kind === 'consider'
            ? choice.opportunities.map((o) => ({ ...o, origin: { kind: 'authored', eventRef } }))
            : [],
        ),
        ...current.opportunities,
      ],
      audit: current.audit,
    };
  }
  if (
    normalized.protocol === PREVIOUS_GROUP_PROTOCOL ||
    normalized.protocol === PREVIOUS_SINGLE_CHOICE_PROTOCOL
  ) {
    const current =
      normalized.protocol === PREVIOUS_GROUP_PROTOCOL
        ? PreviousGroupWire.parse(normalized)
        : PreviousSingleChoiceWire.parse(normalized);
    if (normalized.protocol === PREVIOUS_GROUP_PROTOCOL)
      current.opportunities = groupAuthoredOpportunities(current.opportunities);
    const catalog = directorWireCatalog(snapshot);
    const authored = current.opportunities.filter((o) => o.origin.kind === 'authored');
    const considered = authored.map(
      (o) => (o.origin as { kind: 'authored'; eventRef: string }).eventRef,
    );
    const partition = [...considered, ...current.events.map((e) => e.eventRef)];
    if (
      partition.length !== catalog.events.length ||
      new Set(partition).size !== partition.length ||
      partition.some((ref) => !catalog.events.some((e) => e.ref === ref))
    )
      throw Error('DIRECTOR_AUTHORED_ASSESSMENT_PARTITION');
    if (current.candidates.some((c) => !catalog.candidates.some((item) => item.ref === c.ref)))
      throw Error('DIRECTOR_WIRE_REFERENCE_INVALID');
    normalized = {
      ...current,
      protocol: PREVIOUS_ASSESSMENT_PROTOCOL,
      mode: current.opportunities.length
        ? 'bounded_opportunity'
        : current.candidates.some((c) => c.decision === 'select')
          ? 'coordinate'
          : 'quiet',
      events: [
        ...current.events.map((e) => ({ ...e, decision: 'defer' })),
        ...authored.map((o) => ({
          eventRef: (o.origin as { kind: 'authored'; eventRef: string }).eventRef,
          decision: 'consider',
          reason: o.description,
        })),
      ],
    };
  }
  const wire = Wire.parse(normalized);
  if (wire.protocol !== 'director-wire-v1' && wire.opportunities.some((o) => !o.stagingIntents))
    throw Error('DIRECTOR_STAGING_REQUIRED');
  const catalog = directorWireCatalog(snapshot);
  if (wire.protocol === PREVIOUS_ASSESSMENT_PROTOCOL) {
    if (
      !wire.events ||
      wire.events.length !== catalog.events.length ||
      new Set(wire.events.map((e) => e.eventRef)).size !== wire.events.length ||
      wire.events.some((e) => !catalog.events.some((item) => item.ref === e.eventRef))
    )
      throw Error('DIRECTOR_AUTHORED_ASSESSMENT_PARTITION');
  } else if (wire.events !== undefined) throw Error('DIRECTOR_LEGACY_ASSESSMENTS_FORBIDDEN');
  const openingRefs = bootstrapOpeningEventRefs(snapshot);
  if (
    ['director-wire-v3', PREVIOUS_ASSESSMENT_PROTOCOL].includes(wire.protocol) &&
    openingRefs.length &&
    wire.opportunities.some(
      (o) => o.origin.kind !== 'authored' || !openingRefs.includes(o.origin.eventRef),
    )
  )
    throw Error('DIRECTOR_BOOTSTRAP_OPENING_REQUIRED');
  const lookup = <T extends { ref: string }>(items: T[], ref: string): T => {
    const found = items.find((item) => item.ref === ref);
    if (!found) throw Error('DIRECTOR_WIRE_REFERENCE_INVALID');
    return found;
  };
  const source = (ref: string) => lookup(catalog.sources, ref).sourceId;
  const auditSource = (ref: string) =>
    ref.startsWith('event:') ? lookup(catalog.events, ref).sourceId : source(ref);
  const selectedCandidateIds: string[] = [],
    deferred: { candidateId: string; reason: string }[] = [];
  const rejectedCandidateRefs: string[] = [];
  const nudges: {
    actorId: string;
    candidateId: string;
    kind: z.infer<typeof Nudge>;
    basisSourceIds: string[];
  }[] = [];
  for (const choice of wire.candidates) {
    // Reject impossible execution explicitly. Independent opportunities still
    // require all canonical source/eligibility checks; never invent a candidate.
    if (catalog.candidates.length === 0) {
      rejectedCandidateRefs.push(choice.ref);
      continue;
    }
    const id = lookup(catalog.candidates, choice.ref).candidateId;
    if (choice.decision === 'defer') deferred.push({ candidateId: id, reason: choice.reason });
    else {
      selectedCandidateIds.push(id);
      if (choice.nudge) {
        const candidate = snapshot.candidates.find((c) => c.id === id)!;
        nudges.push({
          actorId: candidate.actorId,
          candidateId: id,
          kind: choice.nudge,
          basisSourceIds: candidate.sourceIds.filter((s) => !s.startsWith('authored:')),
        });
      }
    }
  }
  return {
    mode: wire.mode,
    ...(wire.protocol === PREVIOUS_ASSESSMENT_PROTOCOL
      ? {
          authoredAssessments: wire.events!.map((e) => {
            const event = lookup(catalog.events, e.eventRef);
            const qualification = snapshot.authoredEligibility!.find(
              (q) => q.nodeKey === event.authoredEventKey,
            )!;
            return {
              nodeKey: event.authoredEventKey,
              nodeHash: qualification.nodeHash,
              qualificationKey: qualification.qualificationKey,
              decision: e.decision,
              reason: e.reason,
            };
          }),
        }
      : {}),
    selectedCandidateIds,
    deferred,
    nudges,
    opportunities: wire.opportunities.map(
      ({ actors, places, origin, actorTopics, stagingIntents, ...o }) => ({
        ...o,
        participantActorIds: actors.map((ref) => lookup(catalog.actors, ref).actorId),
        placeIds: places.map((ref) => lookup(catalog.places, ref).placeId),
        ...(origin.kind === 'authored'
          ? {
              authoredEventKey: lookup(catalog.events, origin.eventRef).authoredEventKey,
              basisSourceIds: [lookup(catalog.events, origin.eventRef).sourceId],
            }
          : { basisSourceIds: origin.sourceRefs.map(source) }),
        ...(stagingIntents
          ? {
              stagingIntents: stagingIntents.map(({ actorRef, ...intent }) => ({
                actorId: lookup(catalog.actors, actorRef).actorId,
                ...intent,
              })),
            }
          : {}),
        ...(actorTopics
          ? {
              actorTopics: actorTopics.map(({ actorRef, refs }) => ({
                actorId: lookup(catalog.actors, actorRef).actorId,
                refs,
              })),
            }
          : {}),
      }),
    ),
    audit: {
      reason: rejectedCandidateRefs.length
        ? `[未执行的候选选择：本轮没有可用候选；拒绝引用 ${rejectedCandidateRefs.join(',')}。] ${wire.audit.reason}`.slice(
            0,
            2000,
          )
        : wire.audit.reason,
      basisSourceIds: wire.audit.sourceRefs.map(auditSource),
    },
  };
}

/** Provider grammar is derived from the same immutable catalog used by the decoder.
 * It reduces invalid transport choices; canonical and commit-time checks remain authoritative.
 */
export function directorResponseFormat(snapshot: DirectorSnapshot): ModelOutputOptions {
  const catalog = directorWireCatalog(snapshot);
  type Schema = Record<string, unknown>;
  const text: Schema = { type: 'string' };
  const refs = (values: string[]): Schema =>
    values.length ? { type: 'string', enum: values } : text;
  const object = (properties: Record<string, Schema>): Schema => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const array = (items: Schema, empty = false): Schema => ({
    type: 'array',
    items,
    ...(empty ? { maxItems: 0 } : {}),
  });
  const values = (items: { ref: string }[]) => items.map((item) => item.ref);
  const actors = refs(values(catalog.actors));
  const candidate = refs(values(catalog.candidates));
  const nudge: Schema = snapshot.nativeTurn
    ? { type: 'null' }
    : { anyOf: [{ type: 'string', enum: Nudge.options }, { type: 'null' }] };
  const openingRefs = bootstrapOpeningEventRefs(snapshot);
  const origins: Schema[] = [];
  if (catalog.events.length)
    origins.push(
      object({
        kind: { type: 'string', enum: ['authored'] },
        eventRef: refs(openingRefs.length ? openingRefs : values(catalog.events)),
      }),
    );
  if (catalog.sources.length && !openingRefs.length)
    origins.push(
      object({
        kind: { type: 'string', enum: ['emergent'] },
        sourceRefs: array(refs(values(catalog.sources))),
      }),
    );
  const topics = (snapshot.actorKnownTopics ?? []).filter((topic) =>
    snapshot.boundary.actorIds.includes(topic.actorId),
  );
  const topicSelections: Schema[] = catalog.actors.flatMap(({ ref, actorId }) => {
    const own = topics.filter((topic) => topic.actorId === actorId);
    if (!own.length) return [];
    return [
      object({
        actorRef: { type: 'string', enum: [ref] },
        refs: array({
          anyOf: own.map((topic) =>
            object({
              id: { type: 'string', enum: [topic.id] },
              contentHash: { type: 'string', enum: [topic.contentHash] },
            }),
          ),
        }),
      }),
    ];
  });
  const topicSchema: Schema = topicSelections.length
    ? { anyOf: [array({ anyOf: topicSelections }), { type: 'null' }] }
    : { type: 'null' };
  const schema = object({
    protocol: { type: 'string', enum: [DIRECTOR_WIRE_PROTOCOL] },
    events: {
      ...array(
        object({
          eventRef: refs(values(catalog.events)),
          reason: text,
        }),
      ),
      maxItems: catalog.events.length,
    },
    candidates: {
      ...array(
        {
          anyOf: [
            object({ ref: candidate, decision: { type: 'string', enum: ['select'] }, nudge }),
            object({ ref: candidate, decision: { type: 'string', enum: ['defer'] }, reason: text }),
          ],
        },
        !catalog.candidates.length,
      ),
      minItems: catalog.candidates.length,
      maxItems: catalog.candidates.length,
    },
    opportunities: array(
      object({
        id: text,
        title: text,
        description: text,
        playerImpact: text,
        actors: array(actors, !catalog.actors.length),
        places: array(refs(values(catalog.places)), !catalog.places.length),
        activity: { type: 'string', enum: ['conversation', 'meeting', 'follow_up'] },
        origin: origins.length ? { anyOf: origins } : { type: 'null' },
        stagingIntents: array(
          object({
            actorRef: actors,
            kind: { type: 'string', enum: ['future_task'] },
            task: text,
          }),
          !catalog.actors.length,
        ),
        actorTopics: topicSchema,
      }),
      !origins.length || !!snapshot.nativeTurn,
    ),
    audit: object({
      reason: text,
      sourceRefs: array(
        refs([...values(catalog.sources), ...values(catalog.events)]),
        !catalog.sources.length && !catalog.events.length,
      ),
    }),
  });
  const properties = schema.properties as Record<string, Schema>;
  const flat = properties.opportunities!;
  const originalItem = flat.items as Schema;
  const authorProperties = { ...(originalItem.properties as Record<string, Schema>) };
  delete authorProperties.origin;
  delete authorProperties.id;
  delete authorProperties.actors;
  delete authorProperties.stagingIntents;
  authorProperties.actorTasks = object(
    Object.fromEntries(
      catalog.actors.map((a) => [
        a.ref,
        {
          anyOf: [
            object({
              topic: {
                type: 'string',
                minLength: 1,
                maxLength: 140,
                description: '本人与玩家可交流的具体议题，不是计划准备过程。',
              },
              personalObjective: {
                type: 'string',
                minLength: 1,
                maxLength: 140,
                description: '本人从这次交流希望了解、表达或争取什么；不替玩家决定。',
              },
              proposedInteraction: {
                type: 'string',
                minLength: 1,
                maxLength: 140,
                description: '建议本人向玩家提出的具体信息、请求或选择；不是预制对白或已发生事实。',
              },
            }),
            { type: 'null' },
          ],
        },
      ]),
    ),
  );
  const authorItem = object(authorProperties);
  const deferChoice = object({ kind: { type: 'string', enum: ['defer'] }, reason: text });
  schema.$defs = {
    director_author_opportunity: authorItem,
    director_author_choice: {
      anyOf: [
        deferChoice,
        object({
          kind: { type: 'string', enum: ['consider'] },
          opportunity: { $ref: '#/$defs/director_author_opportunity' },
        }),
      ],
    },
    director_author_defer: deferChoice,
  };
  const choices: Record<string, Schema> = {};
  for (const event of catalog.events)
    choices[event.ref] = {
      $ref:
        !snapshot.nativeTurn && (!openingRefs.length || openingRefs.includes(event.ref))
          ? '#/$defs/director_author_choice'
          : '#/$defs/director_author_defer',
    };
  delete properties.events;
  properties.authoredChoices = object(choices);
  const emergentOrigin =
    catalog.sources.length && !openingRefs.length
      ? object({
          kind: { type: 'string', enum: ['emergent'] },
          sourceRefs: array(refs(values(catalog.sources))),
        })
      : { type: 'null' };
  properties.opportunities = array(
    object({ ...(originalItem.properties as Record<string, Schema>), origin: emergentOrigin }),
    !catalog.sources.length || !!openingRefs.length || !!snapshot.nativeTurn,
  );
  properties.openingContext = { type: 'null' };
  if (snapshot.openingContextAuthority) {
    const openingCatalog = directorOpeningOwnerCatalog(snapshot),
      owners = openingCatalog.actors
        .filter((actor) => actor.canAttribute)
        .map((actor) => actor.actorRef);
    const defs = schema.$defs as Record<string, Schema>;
    defs.director_opening_information_owner = object({
      actorRef: owners.length
        ? { anyOf: [{ type: 'string', enum: owners }, { type: 'null' }] }
        : { type: 'null' },
      reason: { type: 'string', minLength: 1, maxLength: 600 },
    });
    properties.openingContext = object({
      informationOwners: object(
        Object.fromEntries(
          openingCatalog.information.map((info) => [
            info.ref,
            { $ref: '#/$defs/director_opening_information_owner' },
          ]),
        ),
      ),
    });
  }
  schema.required = Object.keys(properties);
  if (JSON.stringify(schema).length > 24_000)
    throw Object.assign(Error('DIRECTOR_RESPONSE_SCHEMA_LIMIT'), {
      code: 'DIRECTOR_RESPONSE_SCHEMA_LIMIT',
    });
  return { format: 'json_schema', name: 'director_response_v14', strict: true, schema };
}
