import { z } from 'zod';
import type { DirectorSnapshot } from '../domain/director-runtime.ts';
import { canConsiderAuthoredEvent } from '../domain/director-runtime.ts';
import { projectAuthoredDirectorModelView } from '../domain/authored-agent-material.ts';

export const DIRECTOR_WIRE_PROTOCOL = 'director-wire-v1';
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
  protocol: z.literal(DIRECTOR_WIRE_PROTOCOL),
  mode: z.enum(['quiet', 'coordinate', 'bounded_opportunity']),
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
    actors: snapshot.boundary.actorIds.map((id, i) => ({ ref: `actor:${i + 1}`, actorId: id })),
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

/** Decode transport only: no inferred selections, new authority or model retry. Canonical validation follows. */
export function decodeDirectorWire(snapshot: DirectorSnapshot, raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('protocol' in raw)) return raw; // Stored pre-wire completions.
  const wire = Wire.parse(raw);
  const catalog = directorWireCatalog(snapshot);
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
  const nudges: {
    actorId: string;
    candidateId: string;
    kind: z.infer<typeof Nudge>;
    basisSourceIds: string[];
  }[] = [];
  for (const choice of wire.candidates) {
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
    selectedCandidateIds,
    deferred,
    nudges,
    opportunities: wire.opportunities.map(({ actors, places, origin, actorTopics, ...o }) => ({
      ...o,
      participantActorIds: actors.map((ref) => lookup(catalog.actors, ref).actorId),
      placeIds: places.map((ref) => lookup(catalog.places, ref).placeId),
      ...(origin.kind === 'authored'
        ? {
            authoredEventKey: lookup(catalog.events, origin.eventRef).authoredEventKey,
            basisSourceIds: [lookup(catalog.events, origin.eventRef).sourceId],
          }
        : { basisSourceIds: origin.sourceRefs.map(source) }),
      ...(actorTopics
        ? {
            actorTopics: actorTopics.map(({ actorRef, refs }) => ({
              actorId: lookup(catalog.actors, actorRef).actorId,
              refs,
            })),
          }
        : {}),
    })),
    audit: { reason: wire.audit.reason, basisSourceIds: wire.audit.sourceRefs.map(auditSource) },
  };
}
