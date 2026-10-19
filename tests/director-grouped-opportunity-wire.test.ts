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
    protocol: 'director-wire-v6',
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

function grouped() {
  const f = fixture();
  const ref = f.events[0]!.ref;
  const first = opportunity(ref);
  const second = {
    ...opportunity(ref),
    id: 'second-choice',
    title: 'B own concern',
    description: 'B independently considers another aspect.',
    playerImpact: 'B also preserves the player choice.',
    actors: ['actor:2'],
    stagingIntents: [
      {
        actorRef: 'actor:2',
        kind: 'future_task',
        task: 'Consider your own concerns, without claiming A has already acted.',
      },
    ],
  };
  f.wire.events = f.wire.events.filter((e) => e.eventRef !== ref);
  f.wire.opportunities = [first, second];
  return f;
}
test('v6 groups same authored event into one shared opportunity with independent self-contained actor tasks', () => {
  const f = grouped(),
    before = structuredClone(f.wire),
    d = f.parse(f.wire);
  assert.equal(d.opportunities.length, 1);
  assert.match(d.opportunities[0]!.id, /^director-opportunity:[a-f0-9]{64}$/);
  const o = d.opportunities[0]!;
  assert.deepEqual(o.participantActorIds, ['a', 'b']);
  assert.equal(o.stagingIntents!.length, 2);
  assert.equal(o.stagingIntents![0]!.task, f.wire.opportunities[0].stagingIntents[0].task);
  assert.equal(o.stagingIntents![1]!.task, f.wire.opportunities[1].stagingIntents[0].task);
  assert(o.description.includes(f.wire.opportunities[0].description));
  assert(o.description.includes(f.wire.opportunities[1].description));
  assert.equal(d.authoredAssessments!.filter((a) => a.decision === 'consider').length, 1);
  assert.equal(d.mode, 'bounded_opportunity');
  assert.deepEqual(f.wire, before);
  assert.equal(f.parse(f.wire).opportunities[0]!.id, o.id);
});
test('v6 incompatible activity/place or repeated cast/task identity cannot be hidden by grouping', () => {
  for (const mutate of [
    (x: any) => (x.opportunities[1].activity = 'meeting'),
    (x: any) => (x.opportunities[1].places = ['place:1']),
    (x: any) => (x.opportunities[1].actors = ['actor:1']),
    (x: any) => (x.opportunities[1].stagingIntents[0].actorRef = 'actor:1'),
    (x: any) => (x.opportunities[1].id = x.opportunities[0].id),
    (x: any) =>
      x.events.push({ eventRef: x.opportunities[0].origin.eventRef, reason: 'Contradiction' }),
  ]) {
    const f = grouped();
    mutate(f.wire);
    assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
  }
});
test('v6 preserves actor topic ownership and rejects cross-actor swaps rather than laundering them', () => {
  const f = grouped();
  f.s.actorKnownTopics = ['a', 'b'].map((actorId, i) => ({
    actorId,
    id: `topic-${i}`,
    kind: 'goal',
    itemId: `goal-${i}`,
    summary: 'Own known goal',
    status: 'active',
    contentHash: String(i + 1).repeat(64),
    proofSourceIds: [],
  }));
  for (let i = 0; i < 2; i++)
    f.wire.opportunities[i].actorTopics = [
      {
        actorRef: `actor:${i + 1}`,
        refs: [{ id: `topic-${i}`, contentHash: String(i + 1).repeat(64) }],
      },
    ];
  const d = f.parse(f.wire);
  assert.deepEqual(
    d.opportunities[0]!.actorTopics!.map((x) => x.actorId),
    ['a', 'b'],
  );
  f.wire.opportunities[0].actorTopics[0].refs[0].id = 'topic-1';
  assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
});
test('v5 paid duplicate-author raw remains invalid while v6 refuses oversized grouped metadata without truncating original text', () => {
  const f = grouped();
  assert.throws(
    () => f.parse({ ...f.wire, protocol: 'director-wire-v5' }),
    /outside its authorized boundary/,
  );
  for (const o of f.wire.opportunities) {
    o.title = 't'.repeat(120);
    o.description = 'd'.repeat(2000);
    o.playerImpact = 'i'.repeat(1000);
  }
  assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
});
test('latest v6 schema has single-choice form while quiet still permits no opportunity', () => {
  const f = fixture(),
    format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  assert.deepEqual((format.schema.properties as any).protocol.enum, ['director-wire-v14']);
  assert.equal(f.parse(f.wire).mode, 'quiet');
});
