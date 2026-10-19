import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOpeningContextReview,
  applyNarrativeContextEvent,
  narrativeContextFact,
  receivedOpeningInformation,
  type OpeningContextAuthority,
  type OpeningContextReview,
  type NarrativeContextConfirmedEvent,
} from '../src/modules/world/domain/narrative-opening-context.ts';
import type { AuthoredAgentMaterialCatalog } from '../src/modules/world/domain/authored-agent-material.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
function fixture() {
  const quote = 'A received an invitation to discuss the existing project.';
  const ownQuote = 'A is responsible for arranging the existing project.';
  const source = {
    worldId: 'world',
    sourceScope: 'bound_publication_story_source' as const,
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 1, contentHash: 'content' },
    sourceHash: 'source',
  };
  const catalog: AuthoredAgentMaterialCatalog = {
    scope: 'director_only',
    world: { worldId: 'world', engineEpoch: 2, worldVersion: 3 },
    source,
    openingEventKey: 'opening',
    timeline: null,
    conditions: [],
    unresolvedRefs: [],
    materials: [
      {
        scope: 'director_only',
        ref: { source, nodeKey: 'opening', nodeHash: 'node' },
        role: 'opening',
        node: {
          key: 'opening',
          kind: 'candidate',
          title: 'Opening',
          editorialIntent: 'A meeting opportunity remains optional.',
          script: quote,
          actorKeys: ['a'],
          prerequisites: [],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'editorial_only' },
        },
        participantRefs: [{ actorKey: 'a', actorId: 'actor-a', status: 'resolved' }],
        placeRefs: [],
        unresolvedRefs: [],
      },
    ],
  };
  const authority: OpeningContextAuthority = {
    policy: 'opening_context_v1',
    reviewKey: 'review',
    nodeKey: 'opening',
    nodeHash: 'node',
    sourceHash: 'source',
    initialAt: '2026-10-20T00:00:00Z',
    sourceField: 'script',
    sourceExcerpt: quote,
    actorKnowledge: [
      {
        actorId: 'actor-a',
        definitionSourceId: 'definition:a',
        modules: { lifeContext: ownQuote },
      },
      {
        actorId: 'actor-b',
        definitionSourceId: 'definition:b',
        modules: { lifeContext: 'B knows a different private background.' },
      },
    ],
  };
  const review: OpeningContextReview = {
    reviewKey: 'review',
    disposition: 'confirm',
    reason: 'Opening source and this actor background overlap.',
    premises: [
      {
        actorId: 'actor-a',
        kind: 'opening_information',
        field: 'script',
        quote,
        knowledge: { module: 'lifeContext', quote: ownQuote },
      },
    ],
  };
  return { catalog, authority, review };
}
test('opening confirmation requires both exact author excerpt and this participant own module', () => {
  const { catalog, authority, review } = fixture();
  const before = JSON.stringify({ catalog, authority, review });
  validateOpeningContextReview(authority, review, catalog);
  assert.equal(JSON.stringify({ catalog, authority, review }), before);
  for (const mutate of [
    (r: OpeningContextReview) => {
      r.premises[0]!.quote = 'Invented content absent from the author source.';
    },
    (r: OpeningContextReview) => {
      r.premises[0]!.field = 'editorialIntent';
    },
    (r: OpeningContextReview) => {
      r.premises[0]!.knowledge.module = 'drives';
    },
    (r: OpeningContextReview) => {
      r.premises[0]!.knowledge.quote = 'B knows a different private background.';
    },
    (r: OpeningContextReview) => {
      r.premises[0]!.actorId = 'actor-b';
    },
    (r: OpeningContextReview) => {
      r.premises.push(structuredClone(r.premises[0]!));
    },
    (r: OpeningContextReview) => {
      r.reviewKey = 'another-review';
    },
    (r: OpeningContextReview) => {
      r.premises[0]!.kind = 'completed_action' as never;
    },
  ]) {
    const invalid = structuredClone(review);
    mutate(invalid);
    assert.throws(
      () => validateOpeningContextReview(authority, invalid, catalog),
      /INVALID_OPENING_CONTEXT_REVIEW/,
    );
  }
});
test('missing permission, mismatched source/node version, nonopening and unresolved participants reject', () => {
  const { catalog, authority, review } = fixture();
  assert.throws(() => validateOpeningContextReview(undefined, review, catalog));
  for (const patch of [
    { sourceHash: 'new-source' },
    { nodeHash: 'new-node' },
    { policy: 'other' },
    { sourceExcerpt: 'different excerpt' },
  ])
    assert.throws(() =>
      validateOpeningContextReview(
        { ...authority, ...patch } as OpeningContextAuthority,
        review,
        catalog,
      ),
    );
  const ordinary = structuredClone(catalog);
  ordinary.materials[0]!.role = 'event';
  assert.throws(() => validateOpeningContextReview(authority, review, ordinary));
  const unresolved = structuredClone(catalog);
  unresolved.materials[0]!.participantRefs[0]!.status = 'not_in_world';
  assert.throws(() => validateOpeningContextReview(authority, review, unresolved));
});
test('legacy absence remains untouched; defer cannot smuggle premises; confirm must contain information', () => {
  const { catalog, authority, review } = fixture();
  validateOpeningContextReview(undefined, undefined, undefined);
  validateOpeningContextReview(
    authority,
    { ...review, disposition: 'defer', premises: [] },
    catalog,
  );
  assert.throws(() =>
    validateOpeningContextReview(authority, { ...review, disposition: 'defer' }, catalog),
  );
  assert.throws(() =>
    validateOpeningContextReview(authority, { ...review, premises: [] }, catalog),
  );
});
test('receipt is a report, scoped to its actor, and never executes a player action or relationship change', () => {
  const { review } = fixture();
  const text = receivedOpeningInformation(review.premises[0]!.quote);
  assert.deepEqual(JSON.parse(text), {
    type: 'received_opening_information',
    assertion: 'report',
    content: review.premises[0]!.quote,
    executionEvidence: false,
  });
  const state: WorldState = {
    schemaVersion: 1,
    id: 'world',
    ownerId: 'owner',
    version: 3,
    title: 'Synthetic',
    time: '2026-10-20T00:00:00Z',
    actors: [{ id: 'actor-a', name: 'A', persona: 'Reserved' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const event: NarrativeContextConfirmedEvent = {
    schemaVersion: 1,
    id: 'event',
    worldId: 'world',
    commandId: 'command',
    version: 4,
    occurredAt: '2026-10-20T00:00:01Z',
    storyAt: '2026-10-20T00:01:00Z',
    type: 'narrative.context_confirmed',
    data: {
      directorDecisionId: 'decision',
      engineEpoch: 2,
      premises: [
        {
          factId: 'fact',
          actorId: 'actor-a',
          text,
          occurredAt: state.time,
          learnedAt: '2026-10-20T00:01:00Z',
          basis: {
            policy: 'opening_context_v1',
            nodeKey: 'opening',
            nodeHash: 'node',
            sourceHash: 'source',
            field: 'script',
            quote: review.premises[0]!.quote,
            decisionId: 'decision',
            knowledge: {
              actorId: 'actor-a',
              module: 'lifeContext',
              quote: review.premises[0]!.knowledge.quote,
              definitionSourceId: 'definition:a',
              moduleHash: 'module',
            },
          },
        },
      ],
    },
  };
  const before = structuredClone(state);
  const next = applyNarrativeContextEvent(state, event);
  assert.deepEqual(state, before);
  assert.deepEqual(next, { ...before, version: 4, time: event.storyAt });
  const fact = narrativeContextFact(event.data.premises[0]!, 'knowledge', event);
  assert.deepEqual(fact.visibility, { kind: 'actors', actorIds: ['actor-a'] });
  assert.equal(fact.text, text);
  assert.equal(next.facts.length, 0);
  for (const changed of [
    { worldId: 'other' },
    { version: 3 },
    { version: 5 },
    { storyAt: 'not-a-date' },
    { data: { ...event.data, engineEpoch: 1 } },
  ])
    assert.throws(() => applyNarrativeContextEvent(state, { ...event, ...changed }));
});
