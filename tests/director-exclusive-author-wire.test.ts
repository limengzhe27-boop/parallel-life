import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  DirectorSnapshot,
  DirectorAttempt,
} from '../src/modules/world/domain/director-runtime.ts';
import { compileAuthoredAgentMaterials } from '../src/modules/world/domain/authored-agent-material.ts';
import { parseDirectorDecision } from '../src/modules/world/infrastructure/director-agent-model.ts';
import {
  directorResponseFormat,
  directorWireCatalog,
} from '../src/modules/world/infrastructure/director-model-protocol.ts';
function fixture() {
  const s: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: '2026-10-19T10:00:00.000Z',
    observedThroughVersion: 5,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'world',
      actorIds: ['a', 'b'],
      placeIds: ['home'],
      capabilityIds: ['plan.record'],
      extensionPermission: 'none',
      createdFromVersion: 5,
      sourceEventId: 'e5',
    },
    worldSetting: 'An existing small shop',
    cast: [{ id: 'a', name: 'A', persona: 'A fictional partner with an independent position.' }],
    actorStates: ['a', 'b'].map((actorId) =>
      emptyActorAgentState({ worldId: 'world', actorId }, 'definition', 5),
    ),
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [
      { sourceId: 'known', kind: 'fact', text: 'Known fictional context.', knownByActorIds: ['a'] },
    ],
    focus: [],
  };
  s.authoredMaterials = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 5 },
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home'],
      source: {
        origin: {
          workId: 'work',
          publicationVersion: 1,
          draftVersion: 0,
          contentHash: 'a'.repeat(64),
        },
        timeline: null,
        conditions: [],
        actorKeys: ['ak', 'bk'],
        contacts: [
          { actorKey: 'ak', actorId: 'a' },
          { actorKey: 'bk', actorId: 'b' },
        ],
        initialActorIds: ['a', 'b'],
        initialPlaceKeys: ['home'],
        places: [{ key: 'home', name: 'Home' }],
        history: [],
        openingEventKey: 'opening',
        nodes: ['opening', 'next'].map((key) => ({
          key,
          kind: 'candidate',
          title: key,
          editorialIntent: 'A future optional authored opportunity.',
          actorKeys: ['ak', 'bk'],
          prerequisites: [],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'director_event' },
        })),
      },
    },
    (x) => createHash('sha256').update(x).digest('hex'),
  );
  s.authoredEligibility = s.authoredMaterials.materials.map((m) => ({
    nodeKey: m.ref.nodeKey,
    nodeHash: m.ref.nodeHash,
    status: 'eligible',
    reasons: [],
    basisSourceIds: [],
    qualificationKey: 'b'.repeat(64),
  }));
  s.occupiedAuthoredEventKeys = [];
  const a: DirectorAttempt = {
    id: 'attempt',
    worldId: 'world',
    commandId: 'command',
    engineEpoch: 2,
    expectedWorldVersion: 5,
    inputHash: 'a'.repeat(64),
    token: 'token',
    leaseUntil: '2026-10-19T10:03:00.000Z',
    status: 'response_received',
  };
  const events = directorWireCatalog(s).events;
  const wire = {
    protocol: 'director-wire-v7',
    candidates: [] as any[],
    authoredChoices: Object.fromEntries(
      events.map((e) => [e.ref, { kind: 'defer', reason: 'Wait for a relevant basis.' }]),
    ) as Record<string, any>,
    opportunities: [] as any[],
    audit: { reason: 'An explicit bounded decision.', sourceRefs: [] as string[] },
  };
  return { s, a, wire, events, parse: (raw: unknown) => parseDirectorDecision(s, raw, a) };
}
function opportunity(ref: string) {
  return {
    id: 'local-choice',
    title: 'Consider the existing event',
    description: 'A future opportunity for an independent character to consider.',
    playerImpact: 'The player remains free to choose.',
    actors: ['actor:1'],
    places: [],
    activity: 'conversation',
    origin: { kind: 'authored', eventRef: ref },
    stagingIntents: [
      {
        actorRef: 'actor:1',
        kind: 'future_task',
        task: 'Consider participating according to your own position.',
      },
    ],
    actorTopics: null,
  };
}

test('v7 single keyed author choice derives assessment and preserves independently addressed tasks', () => {
  const f = fixture(),
    ref = f.events[0]!.ref;
  const { origin: _origin, ...first } = opportunity(ref);
  const second = {
    ...first,
    id: 'second',
    actors: ['actor:2'],
    stagingIntents: [
      {
        actorRef: 'actor:2',
        kind: 'future_task',
        task: 'Consider your own specific concern without assuming any prior action.',
      },
    ],
  };
  f.wire.authoredChoices[ref] = { kind: 'consider', opportunities: [first, second] };
  const before = structuredClone(f.wire),
    d = f.parse(f.wire);
  assert.equal(d.mode, 'bounded_opportunity');
  assert.equal(d.opportunities.length, 1);
  assert.deepEqual(d.opportunities[0]!.participantActorIds, ['a', 'b']);
  assert.equal(d.opportunities[0]!.stagingIntents!.length, 2);
  assert.equal(d.authoredAssessments!.filter((x) => x.decision === 'consider').length, 1);
  assert.deepEqual(f.wire, before);
  assert.equal(f.parse(f.wire).opportunities[0]!.id, d.opportunities[0]!.id);
});
test('v7 cannot encode simultaneous defer/consider, duplicate top-level author, omitted key or unauthorized ref', () => {
  for (const mutate of [
    (f: any) => {
      f.wire.authoredChoices[f.events[0].ref] = {
        kind: 'consider',
        reason: 'defer too',
        opportunities: [],
      };
    },
    (f: any) => {
      f.wire.opportunities = [opportunity(f.events[0].ref)];
    },
    (f: any) => {
      delete f.wire.authoredChoices[f.events[0].ref];
    },
    (f: any) => {
      f.wire.authoredChoices['event:999'] = { kind: 'defer', reason: 'invented' };
    },
    (f: any) => {
      const { origin, ...o } = opportunity(f.events[0].ref);
      f.wire.authoredChoices[f.events[0].ref] = {
        kind: 'consider',
        opportunities: [{ ...o, origin }],
      };
    },
    (f: any) => {
      f.wire.events = [{ eventRef: f.events[0].ref, reason: 'old parallel field' }];
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
  }
});
test('v7 all-defer remains honest quiet, and old v6 dual-state contradiction remains rejected', () => {
  const f = fixture();
  assert.equal(f.parse(f.wire).mode, 'quiet');
  assert.throws(
    () =>
      f.parse({
        protocol: 'director-wire-v6',
        candidates: [],
        events: f.events.map((e) => ({ eventRef: e.ref, reason: 'defer' })),
        opportunities: [opportunity(f.events[0]!.ref)],
        audit: f.wire.audit,
      }),
    /outside its authorized boundary/,
  );
});
test('v7 schema keys every authored event once and shares opportunity grammar with no author origin field', () => {
  const f = fixture(),
    format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.deepEqual(
    schema.properties.authoredChoices.required,
    f.events.map((e) => e.ref),
  );
  assert.equal(schema.properties.authoredChoices.additionalProperties, false);
  assert.equal(schema.properties.events, undefined);
  assert.equal(schema.$defs.director_author_opportunity.properties.origin, undefined);
  assert(schema.properties.authoredChoices.properties['event:1'].$ref);
  assert(JSON.stringify(schema).length < 24000);
});
