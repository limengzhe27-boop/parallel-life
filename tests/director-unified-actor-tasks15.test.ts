import { actorOpportunityContext } from '../src/modules/world/domain/actor-opportunity-context.ts';
import {
  DIRECTOR_WIRE_PROTOCOL,
  directorEmergentOpportunityBudget,
} from '../src/modules/world/infrastructure/director-model-protocol.ts';
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
  decodeDirectorWire,
  directorWireCatalog,
} from '../src/modules/world/infrastructure/director-model-protocol.ts';
function fixture(eventActorKeys = ['ak', 'bk'], nodeKeys = ['opening', 'next']) {
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
        nodes: nodeKeys.map((key) => ({
          key,
          kind: 'candidate',
          title: key,
          editorialIntent: 'A future optional authored opportunity.',
          actorKeys: eventActorKeys,
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

function current(windowCount = 0, eventActorKeys = ['ak', 'bk']) {
  const f = fixture(eventActorKeys, windowCount > 2 ? ['opening', 'next', 'third'] : undefined);
  f.s.deliberationWindow = {
    version: 1,
    nodeKeys: f.s
      .authoredMaterials!.materials.slice(0, windowCount)
      .map((m) => m.ref.nodeKey)
      .sort(),
  };
  if (windowCount)
    f.s.evaluationCause = {
      kind: 'authored_eligibility',
      id: 'test-qualification',
      genesisHash: 'a'.repeat(64),
      admittedAtVersion: 0,
      qualifications: f.s.authoredEligibility!.filter((q) =>
        f.s.deliberationWindow!.nodeKeys.includes(q.nodeKey),
      ),
    };
  const catalog = directorWireCatalog(f.s);
  const wire: any = {
    protocol: DIRECTOR_WIRE_PROTOCOL,
    openingContext: null,
    candidates: [],
    authoredChoices: Object.fromEntries(
      catalog.events.map((e) => [e.ref, { kind: 'defer', reason: '本窗口暂不提出作者机会' }]),
    ),
    opportunities: [],
    audit: { reason: '有界人物独立机会', sourceRefs: [] },
  };
  const actorTasks = {
    'actor:2': null,
    'actor:1': {
      topic: '明天小店的安排',
      personalObjective: '分享自己打算休息的想法',
      proposedInteraction: '告诉朋友可能的店休，并尊重对方安排',
    },
  };
  const opportunity = {
    id: 'local',
    title: '店主的独立安排',
    description: '待考虑的具体交流，不是已经发生',
    playerImpact: '玩家自由决定',
    places: [],
    activity: 'conversation',
    origin: { kind: 'emergent', sourceRefs: [catalog.sources[0]!.ref] },
    actorTasks,
    actorTopics: null,
  };
  return { ...f, wire, opportunity, parse: () => parseDirectorDecision(f.s, wire, f.a) };
}
test('v15 keyed emergent tasks alone determine exact ordered participants and private structured handoff', () => {
  const f = current();
  f.wire.opportunities = [f.opportunity];
  const before = JSON.stringify(f.wire),
    snapshot = JSON.stringify(f.s);
  const d = f.parse(),
    o = d.opportunities[0]!;
  assert.deepEqual(o.participantActorIds, ['a']);
  assert.deepEqual(
    o.stagingIntents?.map((t) => t.actorId),
    ['a'],
  );
  assert.match(o.id, /^director-opportunity:/);
  const task = o.stagingIntents![0]!.task;
  assert.deepEqual(JSON.parse(task), {
    protocol: 'actor-interaction-opportunity-v1',
    ...f.opportunity.actorTasks['actor:1'],
  });
  assert.equal(
    actorOpportunityContext(JSON.stringify(f.wire), task)?.kind,
    'actor_interaction_opportunity',
  );
  assert.equal(JSON.stringify(f.wire), before);
  assert.equal(JSON.stringify(f.s), snapshot);
  const two = current();
  two.opportunity.actorTasks['actor:2'] = {
    ...two.opportunity.actorTasks['actor:1'],
    topic: '另一个人的不同安排',
  } as never;
  two.wire.opportunities = [two.opportunity];
  const both = two.parse().opportunities[0]!;
  assert.deepEqual(both.participantActorIds, ['a', 'b']);
  assert.deepEqual(
    both.stagingIntents?.map((t) => t.actorId),
    ['a', 'b'],
  );
  assert.match(both.stagingIntents![1]!.task, /另一个人的不同安排/);
});
test('v15 schema and decoder reserve 0/1/2 authored slots under the original total budget', () => {
  for (const count of [0, 1, 2]) {
    const f = current(count),
      format = directorResponseFormat(f.s);
    assert.equal(format.format, 'json_schema');
    if (format.format !== 'json_schema') throw Error('format');
    const schema: any = format.schema;
    assert.deepEqual(schema.properties.protocol.enum, ['director-wire-v15']);
    assert.equal(format.name, 'director_response_v15');
    assert.equal(schema.properties.opportunities.maxItems, 2 - count);
    assert.equal(directorEmergentOpportunityBudget(f.s), 2 - count);
    if (count < 2) {
      const item = schema.properties.opportunities.items;
      const p = (item.$ref ? schema.$defs[item.$ref.split('/').at(-1)] : item).properties;
      assert.equal(p.actors, undefined);
      assert.equal(p.stagingIntents, undefined);
      const tasks = schema.$defs[p.actorTasks.$ref.split('/').at(-1)];
      for (const branch of tasks.anyOf ?? [tasks]) {
        assert.deepEqual(branch.required, ['actor:1', 'actor:2']);
        assert.equal(branch.additionalProperties, false);
      }
    } else assert.equal(schema.properties.opportunities.items.type, 'null');
    f.wire.opportunities = Array.from({ length: 2 - count }, (_, i) => ({
      ...f.opportunity,
      id: 'emergent-' + i,
    }));
    assert.equal(f.parse().opportunities.length, 2 - count);
    f.wire.opportunities.push({ ...f.opportunity, id: 'overflow' });
    assert.throws(() => decodeDirectorWire(f.s, f.wire));
  }
  const f = current(2);
  for (const key of Object.keys(f.wire.authoredChoices))
    f.wire.authoredChoices[key] = {
      kind: 'consider',
      opportunity: {
        title: '作者机会',
        description: '由本人独立考虑',
        playerImpact: '可拒绝',
        places: [],
        activity: 'conversation',
        actorTasks: f.opportunity.actorTasks,
        actorTopics: null,
      },
    };
  assert.equal(f.parse().opportunities.length, 2);
  f.wire.opportunities = [f.opportunity];
  assert.throws(() => decodeDirectorWire(f.s, f.wire), /DIRECTOR_EMERGENT_BUDGET_EXCEEDED/);
});
test('v15 rejects conflicting old fields, incomplete actor partitions, empty and invented actor keys', () => {
  for (const change of [
    (o: any) => (o.actors = ['actor:1']),
    (o: any) => (o.stagingIntents = []),
    (o: any) => delete o.actorTasks['actor:2'],
    (o: any) => (o.actorTasks['actor:99'] = o.actorTasks['actor:1']),
    (o: any) => (o.actorTasks['source:1'] = null),
    (o: any) => (o.actorTasks['actor:1'] = null),
  ]) {
    const f = current();
    f.wire.opportunities = [structuredClone(f.opportunity)];
    change(f.wire.opportunities[0]);
    assert.throws(() => f.parse());
  }
});
test('v15 preserves interaction bounds, known topics, source and opening/native authority checks', () => {
  for (const change of [
    (o: any) => (o.actorTasks['actor:1'].topic = ' '),
    (o: any) => (o.actorTasks['actor:1'].personalObjective = 'x'.repeat(141)),
    (o: any) => (o.actorTasks['actor:1'].extra = 'unauthorized'),
    (o: any) => (o.actorTasks['actor:1'].topic = '\u0000'.repeat(140)),
    (o: any) => (o.origin = { kind: 'authored', eventRef: 'event:1' }),
    (o: any) => (o.origin.sourceRefs = ['source:999']),
    (o: any) =>
      (o.actorTopics = [
        { actorRef: 'actor:2', refs: [{ id: 'fake', contentHash: 'a'.repeat(64) }] },
      ]),
    (o: any) =>
      (o.actorTopics = [
        { actorRef: 'actor:1', refs: [{ id: 'fake', contentHash: 'a'.repeat(64) }] },
      ]),
  ]) {
    const f = current();
    f.wire.opportunities = [structuredClone(f.opportunity)];
    change(f.wire.opportunities[0]);
    assert.throws(() => f.parse());
  }
  const opening = current(1);
  opening.s.evaluationCause = {
    kind: 'bootstrap',
    id: 'bootstrap',
    genesisHash: 'a'.repeat(64),
    admittedAtVersion: 0,
  } as never;
  assert.equal(directorEmergentOpportunityBudget(opening.s), 0);
  opening.wire.opportunities = [opening.opportunity];
  assert.throws(() => opening.parse());
  const native = current();
  native.s.nativeTurn = {} as never;
  assert.equal(directorEmergentOpportunityBudget(native.s), 0);
  native.wire.opportunities = [native.opportunity];
  assert.throws(() => native.parse());
});
test('v14 read/recovery remains strict and unchanged; new fields never silently repair old invalid output', () => {
  const f = current();
  const { actorTasks, ...old } = f.opportunity;
  f.wire.protocol = 'director-wire-v14';
  f.wire.opportunities = [
    {
      ...old,
      actors: ['actor:1'],
      stagingIntents: [
        { actorRef: 'actor:1', kind: 'future_task', task: '原有明确的本人未来建议' },
      ],
    },
  ];
  const before = JSON.stringify(f.wire);
  assert.equal(f.parse().opportunities.length, 1);
  assert.equal(JSON.stringify(f.wire), before);
  f.wire.opportunities[0].stagingIntents.push({
    actorRef: 'actor:2',
    kind: 'future_task',
    task: '另一个人的任务',
  });
  assert.throws(() => decodeDirectorWire(f.s, f.wire), /DIRECTOR_GROUP_TASK_SCOPE/);
  const newShape = current();
  newShape.wire.protocol = 'director-wire-v14';
  newShape.wire.opportunities = [newShape.opportunity];
  assert.throws(() => newShape.parse());
  newShape.wire.protocol = 'director-wire-v16';
  assert.throws(() => newShape.parse());
});

test('v15 consider schema requires a real allowed task while defer remains available', () => {
  for (const allowed of [['ak'], ['ak', 'bk']]) {
    const f = current(1, allowed);
    const format = directorResponseFormat(f.s);
    assert.equal(format.format, 'json_schema');
    if (format.format !== 'json_schema') throw Error('format');
    const schema: any = format.schema;
    const resolve = (node: any): any =>
      node.$ref ? schema.$defs[node.$ref.split('/').at(-1)] : node;
    const key = Object.keys(f.wire.authoredChoices)[0]!;
    const choice = resolve(schema.properties.authoredChoices.properties[key]);
    assert.equal(choice.anyOf.length, 2);
    assert.deepEqual(resolve(choice.anyOf[0]).properties.kind.enum, ['defer']);
    const opportunity = resolve(choice.anyOf[1].properties.opportunity);
    const tasks = resolve(opportunity.properties.actorTasks);
    for (const branch of tasks.anyOf ?? [tasks]) {
      assert.deepEqual(branch.required, ['actor:1', 'actor:2']);
      assert.equal(branch.additionalProperties, false);
    }
    if (allowed.length === 1) {
      assert.equal(tasks.properties['actor:1'].$ref, '#/$defs/director_actor_task');
      assert.equal(tasks.properties['actor:2'].type, 'null');
      assert.equal(tasks.anyOf, undefined);
    } else {
      assert.equal(tasks.anyOf.length, 2);
      tasks.anyOf.forEach((branch: any, i: number) => {
        assert.equal(branch.type, 'object');
        assert.equal(branch.additionalProperties, false);
        assert.deepEqual(branch.required, ['actor:1', 'actor:2']);
        assert.equal(branch.properties[`actor:${i + 1}`].$ref, '#/$defs/director_actor_task');
      });
    }
    assert.equal(f.parse().opportunities.length, 0, 'defer requires no invented task');
    f.wire.authoredChoices[key] = {
      kind: 'consider',
      opportunity: {
        title: '本人独立考虑',
        description: '具体可拒绝互动',
        playerImpact: '可自由回应',
        places: [],
        activity: 'conversation',
        actorTasks: { 'actor:1': null, 'actor:2': null },
        actorTopics: null,
      },
    };
    assert.throws(() => f.parse(), 'decoder must continue rejecting all-null consider');
    f.wire.authoredChoices[key].opportunity.actorTasks['actor:1'] =
      f.opportunity.actorTasks['actor:1'];
    assert.deepEqual(f.parse().opportunities[0]!.participantActorIds, ['a']);
    if (allowed.length === 1) {
      f.wire.authoredChoices[key].opportunity.actorTasks['actor:2'] =
        f.opportunity.actorTasks['actor:1'];
      assert.throws(() => f.parse(), 'event-unbound actor cannot receive a task');
    }
  }
});

test('current quiet omits mechanical opening null only when no opening authority exists', () => {
  const f = current();
  delete f.wire.openingContext;
  assert.equal(f.parse().mode, 'quiet');
  const schema: any = (directorResponseFormat(f.s) as any).schema;
  assert.equal(schema.properties.openingContext, undefined);
  assert(!schema.required.includes('openingContext'));
  f.wire.openingContext = null;
  assert.equal(f.parse().mode, 'quiet');
  delete f.wire.candidates;
  assert.throws(() => f.parse(), 'business field omission is not repaired');
  const g = current(1);
  const material = g.s.authoredMaterials!.materials[0]!;
  g.s.openingContextAuthority = {
    policy: 'opening_context_v1',
    reviewKey: 'd'.repeat(64),
    nodeKey: material.ref.nodeKey,
    nodeHash: material.ref.nodeHash,
    sourceHash: g.s.authoredMaterials!.source!.sourceHash,
    initialAt: g.s.storyAt,
    sourceField: 'editorialIntent',
    sourceExcerpt: material.node.editorialIntent!,
    actorKnowledge: [],
  };
  delete g.wire.openingContext;
  assert.throws(() => g.parse(), 'actual opening authority still requires an explicit judgment');
});

test('periodic v2 offers three author choices but still executes at most two authorized opportunities', () => {
  const f = current(3, ['ak']);
  f.s.evaluationCause = {
    ...f.s.evaluationCause!,
    kind: 'periodic_review',
  } as DirectorSnapshot['evaluationCause'];
  f.s.deliberationWindow = {
    version: 2,
    nodeKeys: (f.s.evaluationCause as any).qualifications.map((q: any) => q.nodeKey),
  };
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  assert(JSON.stringify(format.schema).length < 24_000);
  const keys = Object.keys(f.wire.authoredChoices);
  assert.equal(keys.length, 3);
  const choice = () => ({
    kind: 'consider',
    opportunity: {
      title: '个人提议',
      description: '可拒绝的未来机会',
      playerImpact: '玩家独立选择',
      places: [],
      activity: 'conversation',
      actorTasks: structuredClone(f.opportunity.actorTasks),
      actorTopics: null,
    },
  });
  f.wire.authoredChoices[keys[0]!] = choice();
  f.wire.authoredChoices[keys[1]!] = choice();
  assert.equal(f.parse().opportunities.length, 2);
  const schema: any = format.schema;
  const resolve = (node: any): any =>
    node.$ref ? schema.$defs[node.$ref.split('/').at(-1)] : node;
  const authored = resolve(schema.properties.authoredChoices.properties[keys[0]!]);
  const opportunity = resolve(authored.anyOf[1].properties.opportunity);
  const tasks = resolve(opportunity.properties.actorTasks);
  assert.deepEqual(tasks.required, ['actor:1']);
  assert.equal(
    tasks.properties['actor:2'],
    undefined,
    'irrelevant null slots are absent from v2 schema',
  );
  delete f.wire.authoredChoices[keys[0]!].opportunity.actorTasks['actor:2'];
  assert.equal(
    f.parse().opportunities.length,
    2,
    'only mechanical nonparticipant null may be omitted',
  );
  const task = f.wire.authoredChoices[keys[0]!].opportunity.actorTasks['actor:1'];
  delete f.wire.authoredChoices[keys[0]!].opportunity.actorTasks['actor:1'];
  assert.throws(() => f.parse(), 'actual participating task cannot be omitted');
  f.wire.authoredChoices[keys[0]!].opportunity.actorTasks['actor:1'] = task;
  f.wire.authoredChoices[keys[2]!] = choice();
  assert.throws(
    () => f.parse(),
    'three author choices must not raise the two-opportunity execution limit',
  );
  f.wire.authoredChoices[keys[2]!] = { kind: 'defer', reason: '保留后续' };
  f.wire.authoredChoices[keys[0]!].opportunity.actorTasks['actor:2'] =
    f.opportunity.actorTasks['actor:1'];
  assert.throws(() => f.parse(), 'periodic breadth does not authorize another cast member');
});
