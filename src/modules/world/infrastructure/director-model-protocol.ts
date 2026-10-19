import { z } from 'zod';
import type { ModelOutputOptions } from '../../ai/application/ports.ts';
import type { DirectorSnapshot } from '../domain/director-runtime.ts';
import { canConsiderAuthoredEvent } from '../domain/director-runtime.ts';
import { projectAuthoredDirectorModelView } from '../domain/authored-agent-material.ts';

export const DIRECTOR_WIRE_PROTOCOL = 'director-wire-v7';
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
const CurrentWire = PreviousGroupWire.omit({ events: true }).extend({
  protocol: z.literal(DIRECTOR_WIRE_PROTOCOL),
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
      .filter((m) => canConsiderAuthoredEvent(snapshot, m.ref.nodeKey))
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
  if (normalized.protocol === DIRECTOR_WIRE_PROTOCOL) {
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
    const current = CurrentWire.parse(normalized);
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
  const authorItem = object(authorProperties);
  const deferChoice = object({ kind: { type: 'string', enum: ['defer'] }, reason: text });
  schema.$defs = {
    director_author_opportunity: authorItem,
    director_author_choice: {
      anyOf: [
        deferChoice,
        object({
          kind: { type: 'string', enum: ['consider'] },
          opportunities: {
            ...array({ $ref: '#/$defs/director_author_opportunity' }),
            minItems: 1,
            maxItems: 2,
          },
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
  schema.required = Object.keys(properties);
  if (JSON.stringify(schema).length > 24_000)
    throw Object.assign(Error('DIRECTOR_RESPONSE_SCHEMA_LIMIT'), {
      code: 'DIRECTOR_RESPONSE_SCHEMA_LIMIT',
    });
  return { format: 'json_schema', name: 'director_response_v7', strict: true, schema };
}
