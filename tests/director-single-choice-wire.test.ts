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
      actorIds: ['a'],
      placeIds: ['home'],
      capabilityIds: ['plan.record'],
      extensionPermission: 'none',
      createdFromVersion: 5,
      sourceEventId: 'e5',
    },
    worldSetting: 'An existing small shop',
    cast: [{ id: 'a', name: 'A', persona: 'A fictional partner with an independent position.' }],
    actorStates: [emptyActorAgentState({ worldId: 'world', actorId: 'a' }, 'definition', 5)],
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
      actualActorIds: ['a'],
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
        actorKeys: ['ak'],
        contacts: [{ actorKey: 'ak', actorId: 'a' }],
        initialActorIds: ['a'],
        initialPlaceKeys: ['home'],
        places: [{ key: 'home', name: 'Home' }],
        history: [],
        openingEventKey: 'opening',
        nodes: ['opening', 'next'].map((key) => ({
          key,
          kind: 'candidate',
          title: key,
          editorialIntent: 'A future optional authored opportunity.',
          actorKeys: ['ak'],
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
    protocol: 'director-wire-v5',
    candidates: [] as any[],
    events: events.map((e) => ({ eventRef: e.ref, reason: 'Wait for a relevant basis.' })),
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

test('v5 one authored choice mechanically derives bounded mode and consideration, without a second decision flag', () => {
  const f = fixture(),
    selected = f.events.find((e) => e.authoredEventKey === 'opening')!;
  f.wire.events = f.wire.events.filter((e) => e.eventRef !== selected.ref);
  f.wire.opportunities = [opportunity(selected.ref)];
  const before = structuredClone(f.wire),
    d = f.parse(f.wire);
  assert.equal(d.mode, 'bounded_opportunity');
  assert.equal(d.opportunities.length, 1);
  assert.equal(d.authoredAssessments!.find((a) => a.nodeKey === 'opening')!.decision, 'consider');
  assert.equal(
    d.authoredAssessments!.find((a) => a.nodeKey === 'opening')!.reason,
    f.wire.opportunities[0].description,
  );
  assert.equal(d.authoredAssessments!.find((a) => a.nodeKey === 'next')!.decision, 'defer');
  assert.match(d.opportunities[0]!.id, /^director-opportunity:[a-f0-9]{64}$/);
  assert.deepEqual(f.wire, before);
  assert.equal(f.parse(f.wire).opportunities[0]!.id, d.opportunities[0]!.id);
});
test('v5 all-defer is honestly quiet; it does not invent an opportunity or force participation', () => {
  const f = fixture(),
    d = f.parse(f.wire);
  assert.equal(d.mode, 'quiet');
  assert.deepEqual(d.opportunities, []);
  assert.equal(d.authoredAssessments!.length, 2);
  assert(d.authoredAssessments!.every((a) => a.decision === 'defer'));
  assert.throws(() => f.parse({ ...f.wire, mode: 'quiet' }), /outside its authorized boundary/);
  assert.throws(
    () =>
      f.parse({ ...f.wire, events: f.wire.events.map((e) => ({ ...e, decision: 'consider' })) }),
    /outside its authorized boundary/,
  );
});
test('v5 candidate selection derives coordinate mode while covering each authored deferral', () => {
  const f = fixture();
  f.s.candidates = [
    {
      id: 'candidate',
      worldId: 'world',
      actorId: 'a',
      source: 'actor_plan',
      episodeId: null,
      actionId: null,
      resourceIds: [],
      channel: 'private',
      threadId: 'a',
      sourceIds: ['known'],
      expectedWorldVersion: 5,
      expectedActorRevision: 0,
      priority: 1,
      reason: 'Ready own plan',
      requiresCoordination: false,
    },
  ];
  f.wire.candidates = [{ ref: 'candidate:1', decision: 'select' }];
  const d = f.parse(f.wire);
  assert.equal(d.mode, 'coordinate');
  assert.deepEqual(d.selectedCandidateIds, ['candidate']);
});
test('v5 chosen opportunities and deferred refs must form a complete disjoint catalogue partition', () => {
  const f = fixture(),
    selected = f.events[0]!;
  const chosen = opportunity(selected.ref);
  for (const raw of [
    { ...f.wire, events: [] },
    { ...f.wire, events: [f.wire.events[0], f.wire.events[0]] },
    { ...f.wire, opportunities: [chosen] },
    { ...f.wire, events: [], opportunities: [chosen, { ...chosen, id: 'different-local-id' }] },
    { ...f.wire, events: [{ eventRef: 'source:1', reason: 'Wrong namespace' }, f.wire.events[1]] },
    { ...f.wire, candidates: [{ ref: 'candidate:1', decision: 'select' }] },
  ])
    assert.throws(() => f.parse(raw), /outside its authorized boundary/);
});
test('v5 bootstrap retains authored opening boundary and nonbootstrap improvisation remains possible', () => {
  const f = fixture();
  f.s.evaluationCause = {
    kind: 'bootstrap',
    id: 'bootstrap',
    genesisHash: 'a'.repeat(32),
    admittedAtVersion: 5,
  };
  const emergent = {
    ...opportunity('unused'),
    origin: { kind: 'emergent', sourceRefs: ['source:1'] },
  };
  assert.throws(
    () => f.parse({ ...f.wire, opportunities: [emergent] }),
    /outside its authorized boundary/,
  );
  delete f.s.evaluationCause;
  assert.equal(f.parse({ ...f.wire, opportunities: [emergent] }).mode, 'bounded_opportunity');
});
test('fixed v4 raw keeps its own mode and assessment semantics, including old paid contradiction failures', () => {
  const f = fixture();
  const raw = {
    ...f.wire,
    protocol: 'director-wire-v4',
    mode: 'quiet',
    events: f.wire.events.map((e) => ({ ...e, decision: 'defer' })),
  };
  assert.equal(f.parse(raw).mode, 'quiet');
  assert.throws(
    () => f.parse({ ...raw, events: raw.events.map((e) => ({ ...e, decision: 'consider' })) }),
    /outside its authorized boundary/,
  );
  assert.throws(() => f.parse({ ...raw, mode: undefined }), /outside its authorized boundary/);
  const { events: _events, ...prior } = raw;
  assert.equal(f.parse({ ...prior, protocol: 'director-wire-v3' }).authoredAssessments, undefined);
});
test('latest schema binds one exclusive choice per authored ref, without redundant events', () => {
  const f = fixture(),
    format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('grammar');
  const p: any = format.schema.properties;
  assert.equal(p.mode, undefined);
  assert.equal(p.events, undefined);
  assert.deepEqual(
    p.authoredChoices.required,
    f.events.map((e) => e.ref),
  );
  assert.equal(p.authoredChoices.additionalProperties, false);
  assert.deepEqual(p.protocol.enum, ['director-wire-v13']);
});
