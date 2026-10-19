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
    protocol: 'director-wire-v8',
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

function consider() {
  const f = fixture(),
    ref = f.events[0]!.ref;
  const {
    id: _id,
    origin: _origin,
    actors: _actors,
    stagingIntents: _tasks,
    ...rest
  } = opportunity(ref);
  f.wire.authoredChoices[ref] = {
    kind: 'consider',
    opportunity: {
      ...rest,
      actorTasks: {
        'actor:1': { task: 'Discuss your own concrete concern with the player; allow refusal.' },
        'actor:2': {
          task: 'Ask about your own distinct proposal, without presuming prior agreement.',
        },
      },
    },
  };
  return f;
}
test('v8 one authored object mechanically binds id, actors and per-person tasks without duplicate cast lists', () => {
  const f = consider(),
    before = structuredClone(f.wire),
    d = f.parse(f.wire),
    o = d.opportunities[0]!;
  assert.equal(d.opportunities.length, 1);
  assert.deepEqual(o.participantActorIds, ['a', 'b']);
  assert.deepEqual(
    o.stagingIntents!.map((t) => t.actorId),
    ['a', 'b'],
  );
  assert.equal(
    o.stagingIntents![0]!.task,
    f.wire.authoredChoices[f.events[0]!.ref].opportunity.actorTasks['actor:1'].task,
  );
  assert.match(o.id, /^director-opportunity:[a-f0-9]{64}$/);
  assert.deepEqual(f.wire, before);
  assert.equal(f.parse(f.wire).opportunities[0]!.id, o.id);
});
test('v8 null actor task excludes exactly that person and never invents a task', () => {
  const f = consider(),
    ref = f.events[0]!.ref;
  f.wire.authoredChoices[ref].opportunity.actorTasks['actor:2'] = null;
  const o = f.parse(f.wire).opportunities[0]!;
  assert.deepEqual(o.participantActorIds, ['a']);
  assert.equal(o.stagingIntents!.length, 1);
  assert.equal(f.parse(fixture().wire).mode, 'quiet');
});
test('v8 strict key and single object contract rejects redundant ids/cast/tasks, arrays and empty/missing/foreign actors', () => {
  for (const mutate of [
    (o: any) => {
      o.id = 'manual';
    },
    (o: any) => {
      o.actors = ['actor:1'];
    },
    (o: any) => {
      o.stagingIntents = [];
    },
    (o: any) => {
      o.actorTasks['actor:1'] = null;
      o.actorTasks['actor:2'] = null;
    },
    (o: any) => {
      delete o.actorTasks['actor:2'];
    },
    (o: any) => {
      o.actorTasks['actor:3'] = { task: 'invented' };
    },
    (o: any) => {
      o.actorTasks['actor:1'] = { task: '', kind: 'future_task' };
    },
  ]) {
    const f = consider();
    mutate(f.wire.authoredChoices[f.events[0]!.ref].opportunity);
    assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
  }
  const f = consider(),
    ref = f.events[0]!.ref;
  f.wire.authoredChoices[ref] = {
    kind: 'consider',
    opportunities: [f.wire.authoredChoices[ref].opportunity],
  };
  assert.throws(() => f.parse(f.wire), /outside its authorized boundary/);
});
test('v7 paid single choice remains fixed and namespaced; duplicate-actor old array remains invalid', () => {
  const f = fixture(),
    ref = f.events[0]!.ref;
  const { origin, ...o } = opportunity(ref);
  const raw = {
    ...f.wire,
    protocol: 'director-wire-v7',
    authoredChoices: { ...f.wire.authoredChoices, [ref]: { kind: 'consider', opportunities: [o] } },
  };
  const d = f.parse(raw);
  assert.match(d.opportunities[0]!.id, /^director-opportunity:[a-f0-9]{64}$/);
  raw.authoredChoices[ref].opportunities.push({ ...o, id: 'other-id' });
  assert.throws(() => f.parse(raw), /outside its authorized boundary/);
});
test('v8 provider uses single author opportunity and exact keyed nullable actor tasks with shared schema', () => {
  const f = fixture(),
    format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const s: any = format.schema,
    p = s.$defs.director_author_opportunity.properties;
  for (const key of ['id', 'origin', 'actors', 'stagingIntents']) assert.equal(p[key], undefined);
  assert.deepEqual(p.actorTasks.required, ['actor:1', 'actor:2']);
  assert.equal(p.actorTasks.additionalProperties, false);
  const consider = s.$defs.director_author_choice.anyOf.find(
    (x: any) => x.properties.kind.enum[0] === 'consider',
  );
  assert(consider.properties.opportunity.$ref);
  assert.equal(consider.properties.opportunities, undefined);
  assert.deepEqual(s.properties.protocol.enum, ['director-wire-v8']);
});
