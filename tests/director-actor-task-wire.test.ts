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
  directorOpeningInformationCatalog,
  directorOpeningActorCatalog,
  directorOpeningOwnerCatalog,
  decodeDirectorWire,
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
test('current provider uses single author opportunity and exact keyed nullable actor tasks with shared schema', () => {
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
  assert.deepEqual(s.properties.protocol.enum, ['director-wire-v14']);
});

test('v9 typed handoff preserves actor binding and compiles only the selected personal proposal', () => {
  const f = consider();
  f.wire.protocol = 'director-wire-v9';
  const o = f.wire.authoredChoices[f.events[0]!.ref].opportunity;
  const interaction = {
    topic: 'Discuss the upcoming shop visit',
    personalObjective: 'Find out whether a shared visit suits the player',
    proposedInteraction: 'Offer an optional visit and ask which existing location they prefer',
  };
  o.actorTasks = { 'actor:1': interaction, 'actor:2': null };
  const before = structuredClone(f.wire);
  const d = f.parse(f.wire).opportunities[0]!;
  assert.deepEqual(d.participantActorIds, ['a']);
  assert.deepEqual(JSON.parse(d.stagingIntents![0]!.task), {
    protocol: 'actor-interaction-opportunity-v1',
    ...interaction,
  });
  assert.equal(d.stagingIntents![0]!.actorId, 'a');
  assert.deepEqual(f.wire, before);
  for (const field of ['topic', 'personalObjective', 'proposedInteraction']) {
    const invalid = structuredClone(before);
    delete invalid.authoredChoices[f.events[0]!.ref].opportunity.actorTasks['actor:1'][field];
    assert.throws(() => f.parse(invalid));
  }
  o.actorTasks['actor:1'] = { task: 'Consider how to prepare' };
  assert.throws(() => f.parse(f.wire));
});
test('v9 schema requires three bounded personal fields while v8 saved task remains verbatim', () => {
  const f = consider(),
    old = f.parse(f.wire);
  assert.equal(
    old.opportunities[0]!.stagingIntents![0]!.task,
    f.wire.authoredChoices[f.events[0]!.ref].opportunity.actorTasks['actor:1'].task,
  );
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const tasks: any = (format.schema as any).$defs.director_author_opportunity.properties.actorTasks;
  const personal = tasks.properties['actor:1'].anyOf[0];
  assert.deepEqual(personal.required, ['topic', 'personalObjective', 'proposedInteraction']);
  assert.equal(personal.additionalProperties, false);
  for (const field of personal.required) assert.equal(personal.properties[field].maxLength, 140);
});

test('v10 opening information binds actor refs and review identity while preserving original report text', () => {
  const f = fixture();
  const opening = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  const quote = opening.node.editorialIntent!;
  const ownQuote = 'A knows the existing project and coordinates its arrangements.';
  f.s.openingContextAuthority = {
    policy: 'opening_context_v1',
    reviewKey: 'd'.repeat(64),
    nodeKey: opening.ref.nodeKey,
    nodeHash: opening.ref.nodeHash,
    sourceHash: f.s.authoredMaterials!.source!.sourceHash,
    initialAt: f.s.storyAt,
    sourceField: 'editorialIntent',
    sourceExcerpt: quote,
    actorKnowledge: [
      {
        actorId: 'a',
        definitionSourceId: 'definition:definition',
        modules: { relationships: ownQuote },
      },
    ],
  };
  const raw = {
    ...f.wire,
    protocol: 'director-wire-v10',
    openingContext: {
      disposition: 'confirm',
      reason: 'Record scoped information receipt, not external action completion.',
      premises: [
        {
          actorRef: 'actor:1',
          kind: 'opening_information',
          field: 'editorialIntent',
          quote,
          knowledge: { module: 'relationships', quote: ownQuote },
        },
      ],
    },
  };
  const before = structuredClone(raw);
  const decision = f.parse(raw);
  assert.equal(decision.mode, 'coordinate');
  assert.equal(decision.openingContext!.reviewKey, f.s.openingContextAuthority.reviewKey);
  assert.equal(decision.openingContext!.premises[0]!.actorId, 'a');
  assert.equal(decision.openingContext!.premises[0]!.quote, quote);
  assert.deepEqual(raw, before, 'paid source object is never mutated');
  const schema = directorResponseFormat(f.s);
  if (schema.format !== 'json_schema') throw Error('schema');
  const properties = (schema.schema as any).properties;
  assert.equal(schema.name, 'director_response_v14');
  assert.deepEqual(properties.openingContext.properties.informationOwners.required, [
    'opening-info:1',
  ]);
  assert.throws(() =>
    f.parse({ ...raw, openingContext: { disposition: 'confirm', reason: '', premises: [] } }),
  );
  assert.equal(
    properties.openingContext.properties.informationOwners.properties['opening-info:1'].$ref,
    '#/$defs/director_opening_information_owner',
  );
  for (const invalid of [
    {
      ...raw,
      openingContext: {
        ...raw.openingContext,
        premises: [{ ...raw.openingContext.premises[0], actorRef: 'actor:2' }],
      },
    },
    {
      ...raw,
      openingContext: {
        ...raw.openingContext,
        premises: [
          { ...raw.openingContext.premises[0], quote: 'A fabricated source with no provenance.' },
        ],
      },
    },
    { ...raw, openingContext: { ...raw.openingContext, reviewKey: 'model-supplied-review' } },
  ])
    assert.throws(() => f.parse(invalid));
});

test('protected v9 responses do not gain opening execution and cannot attach a new authority field', () => {
  const f = fixture();
  const previous = { ...f.wire, protocol: 'director-wire-v9' };
  const original = f.parse(previous);
  assert.equal(original.openingContext, undefined);
  assert.equal(original.mode, 'quiet');
  assert.throws(
    () => f.parse({ ...previous, openingContext: null }),
    'legacy schema remains strict',
  );
  assert.throws(() =>
    f.parse({
      ...previous,
      openingContext: { disposition: 'confirm', reason: 'No grant', premises: [] },
    }),
  );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      protocol: 'director-wire-v10',
      openingContext: { disposition: 'confirm', reason: 'No grant', premises: [] },
    }),
  );
  const current = f.parse({ ...f.wire, protocol: 'director-wire-v10', openingContext: null });
  assert.equal(current.openingContext, undefined);
  const schema = directorResponseFormat(f.s);
  if (schema.format !== 'json_schema') throw Error('schema');
  assert.deepEqual((schema.schema as any).properties.openingContext, { type: 'null' });
});

test('v10 accepts nullable actorTopics transport before validating an otherwise exact interaction', () => {
  const f = consider();
  f.wire.protocol = 'director-wire-v10';

  const o = f.wire.authoredChoices[f.events[0]!.ref].opportunity;
  o.actorTopics = null;
  o.actorTasks = {
    'actor:1': {
      topic: 'Discuss the existing project',
      personalObjective: 'Find a workable choice',
      proposedInteraction: 'Offer a discussion',
    },
    'actor:2': null,
  };
  const wire = { ...f.wire, openingContext: null };
  const original = structuredClone(wire);
  const d = f.parse(wire);
  assert.equal(d.opportunities.length, 1);
  assert.equal(d.opportunities[0]!.actorTopics, undefined);
  assert.deepEqual(wire, original);
});

function informationFixture() {
  const f = fixture(),
    opening = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  const quote = opening.node.editorialIntent!,
    ownQuote = 'A knows the existing project and coordinates its arrangements.';
  f.s.openingContextAuthority = {
    policy: 'opening_context_v1',
    reviewKey: 'd'.repeat(64),
    nodeKey: opening.ref.nodeKey,
    nodeHash: opening.ref.nodeHash,
    sourceHash: f.s.authoredMaterials!.source!.sourceHash,
    initialAt: f.s.storyAt,
    sourceField: 'editorialIntent',
    sourceExcerpt: quote,
    actorKnowledge: [
      { actorId: 'a', definitionSourceId: 'definition:a', modules: { relationships: ownQuote } },
      {
        actorId: 'b',
        definitionSourceId: 'definition:b',
        modules: { lifeContext: 'B has separate information about the same existing project.' },
      },
    ],
  };
  const catalog = directorOpeningInformationCatalog(f.s);
  const own = catalog.identities.find((i) => i.actorRef === 'actor:1')!;
  const wire = {
    ...f.wire,
    protocol: 'director-wire-v11',
    openingContext: {
      disposition: 'confirm',
      reason: 'Bind only the source information and this actor identity.',
      premises: [
        { actorRef: 'actor:1', informationRef: catalog.information[0]!.ref, identityRef: own.ref },
      ],
    },
  };
  return { ...f, catalog, wire, quote, ownQuote };
}
test('v11 compiles exact catalog references while v10 paid quotes retain their original meaning', () => {
  const f = informationFixture(),
    before = structuredClone(f.wire);
  const decoded = decodeDirectorWire(f.s, f.wire) as any;
  assert.equal(decoded.openingContext.reviewKey, f.s.openingContextAuthority!.reviewKey);
  assert.deepEqual(decoded.openingContext.premises, [
    {
      actorId: 'a',
      kind: 'opening_information',
      field: 'editorialIntent',
      quote: f.quote,
      knowledge: { module: 'relationships', quote: f.ownQuote },
    },
  ]);
  assert.equal(f.parse(f.wire).openingContext!.premises[0]!.quote, f.quote);
  assert.deepEqual(f.wire, before);
  const previous = {
    ...f.wire,
    protocol: 'director-wire-v10',
    openingContext: {
      ...f.wire.openingContext,
      premises: [
        {
          actorRef: 'actor:1',
          kind: 'opening_information',
          field: 'editorialIntent',
          quote: f.quote,
          knowledge: { module: 'relationships', quote: f.ownQuote },
        },
      ],
    },
  };
  assert.equal(f.parse(previous).openingContext!.premises[0]!.quote, f.quote);
  assert.throws(
    () => f.parse({ ...previous, openingContext: f.wire.openingContext }),
    'v10 is not reinterpreted as reference transport',
  );
  assert.throws(
    () => f.parse({ ...f.wire, openingContext: previous.openingContext }),
    'v11 cannot provide freeform quoted facts',
  );
});
test('v11 rejects foreign information, cross-person identity, missing review, empty confirm and defer with premises', () => {
  const f = informationFixture(),
    p = f.wire.openingContext.premises[0]!;
  const other = f.catalog.identities.find((i) => i.actorRef === 'actor:2')!;
  for (const premise of [
    { ...p, informationRef: 'opening-info:999' },
    { ...p, identityRef: other.ref },
    { ...p, actorRef: 'actor:9' },
    { ...p, identityRef: 'opening-identity:999' },
    { ...p, quote: 'A fabricated claim' },
  ])
    assert.throws(() =>
      f.parse({ ...f.wire, openingContext: { ...f.wire.openingContext, premises: [premise] } }),
    );
  for (const context of [
    null,
    { ...f.wire.openingContext, premises: [] },
    { ...f.wire.openingContext, disposition: 'defer' },
    { ...f.wire.openingContext, reason: '' },
  ])
    assert.throws(() => f.parse({ ...f.wire, openingContext: context }));
  assert.equal(
    f.parse({
      ...f.wire,
      openingContext: {
        disposition: 'defer',
        reason: 'No justified initial information to confirm.',
        premises: [],
      },
    }).openingContext!.disposition,
    'defer',
  );
  delete f.s.openingContextAuthority;
  assert.throws(() => f.parse(f.wire));
  assert.equal(f.parse({ ...f.wire, openingContext: null }).openingContext, undefined);
});
test('v11 catalog fragments remain exact bounded substrings and schema shares per-actor identity constraints', () => {
  const f = informationFixture(),
    authority = f.s.openingContextAuthority!;
  authority.sourceExcerpt =
    'A long exact source sentence with no invented statement. '.repeat(80) +
    '短句。Next exact sentence.';
  authority.actorKnowledge[0]!.modules.relationships =
    'Original relationship source sentence. '.repeat(40);
  const catalog = directorOpeningInformationCatalog(f.s);
  assert(catalog.information.length <= 24);
  for (const info of catalog.information) {
    assert(info.text.length >= 6 && info.text.length <= 600);
    assert(authority.sourceExcerpt.includes(info.text));
  }
  for (const identity of catalog.identities) {
    const actorId = identity.actorRef === 'actor:1' ? 'a' : 'b';
    const source = authority.actorKnowledge.find((a) => a.actorId === actorId)!.modules[
      identity.module
    ]!;
    assert(source.includes(identity.text));
    assert(identity.text.length >= 6 && identity.text.length <= 300);
  }
  assert(
    catalog.identities.filter((i) => i.actorRef === 'actor:1' && i.module === 'relationships')
      .length <= 3,
  );
  assert.deepEqual(catalog, directorOpeningInformationCatalog(f.s));
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.equal(
    schema.properties.openingContext.properties.informationOwners.properties['opening-info:1'].$ref,
    '#/$defs/director_opening_information_owner',
  );
  assert.equal(
    schema.$defs.director_opening_information_owner.properties.actorRef.anyOf[0].enum.length,
    2,
  );
  assert.equal(
    JSON.stringify(schema).includes('opening-identity:'),
    false,
    'identity selection remains server-side',
  );
  assert(JSON.stringify(schema).length < 24000);
});

test('v11 12-person two-event provider schema remains bounded and handles long unpunctuated originals', () => {
  const f = informationFixture();
  const authority = f.s.openingContextAuthority!;
  authority.sourceExcerpt = '无标点的长篇编剧原文'.repeat(900);
  f.s.boundary.actorIds = Array.from({ length: 12 }, (_, i) => `actor-${i}`);
  authority.actorKnowledge = f.s.boundary.actorIds.map((actorId) => ({
    actorId,
    definitionSourceId: `definition:${actorId}`,
    modules: Object.fromEntries(
      ['lifeContext', 'traits', 'drives', 'behavior', 'relationships'].map((key) => [
        key,
        `${actorId}的本人原始设定资料。`.repeat(75),
      ]),
    ),
  }));
  const catalog = directorOpeningInformationCatalog(f.s);
  assert(catalog.information.length > 0);
  assert.equal(new Set(catalog.identities.map((item) => item.ref)).size, catalog.identities.length);
  for (const item of catalog.information) {
    assert(authority.sourceExcerpt.includes(item.text));
    assert(item.text.length >= 6 && item.text.length <= 600);
  }
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  assert(JSON.stringify(format.schema).length <= 24_000);
});

test('opening fragments split each exact clause on Chinese commas, semicolons and real newlines, never letters n or backslashes', () => {
  const f = informationFixture();
  const clauses = [
    '青青请主角去医院看母亲，',
    '林白语邀请主角见父亲；',
    '欣欣要求单独谈分手旧事。',
    '刘胜男要求主角处理工作\n',
    '舒雅婷说明照看孩子的安排，',
    '李之之邀请主角去酒馆。',
  ];
  f.s.openingContextAuthority!.sourceExcerpt = clauses.join('');
  const catalog = directorOpeningInformationCatalog(f.s);
  assert.deepEqual(
    catalog.information.map((i) => i.text),
    clauses.map((s) => s.trim()),
  );
  const english = 'An invitation concerns an existing plan with no new characters or locations.';
  f.s.openingContextAuthority!.sourceExcerpt = english;
  assert.deepEqual(
    directorOpeningInformationCatalog(f.s).information.map((i) => i.text),
    [english],
  );
  const backslash = String.raw`Existing report contains a literal \n sequence and stays in one sentence.`;
  f.s.openingContextAuthority!.sourceExcerpt = backslash;
  assert.deepEqual(
    directorOpeningInformationCatalog(f.s).information.map((i) => i.text),
    [backslash],
  );
  for (const i of catalog.information) assert(clauses.join('').includes(i.text));
});

function attributedFixture() {
  const f = informationFixture(),
    catalog = directorOpeningInformationCatalog(f.s);
  return {
    ...f,
    catalog,
    wire: {
      ...f.wire,
      protocol: 'director-wire-v12',
      openingContext: {
        informationChoices: Object.fromEntries(
          catalog.information.map((info) => [
            info.ref,
            {
              kind: 'actor_information',
              actorRef: 'actor:1',
              identityRef: catalog.identities.find((i) => i.actorRef === 'actor:1')!.ref,
            },
          ]),
        ),
      },
    },
  };
}
test('v12 requires every bounded information item to receive its own source-ownership judgment', () => {
  const f = attributedFixture(),
    before = structuredClone(f.wire);
  const decision = f.parse(f.wire);
  assert.equal(decision.openingContext!.disposition, 'confirm');
  assert.equal(decision.openingContext!.premises[0]!.quote, f.catalog.information[0]!.text);
  assert.equal(decision.openingContext!.premises[0]!.actorId, 'a');
  assert.deepEqual(f.wire, before);
  const missing = { ...f.wire, openingContext: { informationChoices: {} } };
  assert.throws(() => f.parse(missing));
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationChoices: {
          ...f.wire.openingContext.informationChoices,
          'opening-info:999': {
            kind: 'not_admitted',
            reasonKind: 'identity_unresolved',
            reason: 'No identity source',
          },
        },
      },
    }),
  );
  for (const reasonKind of [
    'not_information',
    'conditional_future',
    'identity_unresolved',
    'other_actor_private',
  ]) {
    const quiet = {
      ...f.wire,
      openingContext: {
        informationChoices: {
          'opening-info:1': {
            kind: 'not_admitted',
            reasonKind,
            reason: 'This particular source lacks an admissible current identity connection.',
          },
        },
      },
    };
    assert.equal(f.parse(quiet).openingContext!.disposition, 'defer');
  }
  for (const invalidChoice of [
    { kind: 'not_admitted', reasonKind: 'no_motivation', reason: 'No interaction is needed' },
    { kind: 'not_admitted', reasonKind: 'identity_unresolved', reason: '' },
    {
      kind: 'actor_information',
      actorRef: 'actor:2',
      identityRef: f.catalog.identities.find((i) => i.actorRef === 'actor:1')!.ref,
    },
  ])
    assert.throws(() =>
      f.parse({
        ...f.wire,
        openingContext: { informationChoices: { 'opening-info:1': invalidChoice } },
      }),
    );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationChoices: f.wire.openingContext.informationChoices,
        reason: 'Global quiet',
      },
    }),
  );
});
test('v12 bounds current information to 12 while saved v11 still addresses its original 24-item catalog', () => {
  const f = attributedFixture(),
    authority = f.s.openingContextAuthority!;
  authority.sourceExcerpt = Array.from(
    { length: 24 },
    (_, i) => `第${i + 1}项已有来源的独立开场信息。`,
  ).join('');
  const material = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  material.node.editorialIntent = authority.sourceExcerpt;
  const current = directorOpeningInformationCatalog(f.s),
    old = directorOpeningInformationCatalog(f.s, 'v11');
  assert.equal(current.information.length, 12);
  assert.equal(old.information.length, 24);
  const identity = old.identities.find((i) => i.actorRef === 'actor:1')!;
  const previous = {
    ...f.wire,
    protocol: 'director-wire-v11',
    openingContext: {
      disposition: 'confirm',
      reason: 'A protected source judgment outside the new current window.',
      premises: [
        { actorRef: 'actor:1', informationRef: 'opening-info:24', identityRef: identity.ref },
      ],
    },
  };
  assert.equal(f.parse(previous).openingContext!.premises[0]!.quote, old.information[23]!.text);
  const allExcluded = Object.fromEntries(
    current.information.map((i) => [
      i.ref,
      {
        kind: 'not_admitted',
        reasonKind: 'conditional_future',
        reason: 'This source describes a conditional future situation.',
      },
    ]),
  );
  assert.equal(
    f.parse({ ...f.wire, openingContext: { informationChoices: allExcluded } }).openingContext!
      .disposition,
    'defer',
  );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationChoices: {
          ...allExcluded,
          'opening-info:24': {
            kind: 'actor_information',
            actorRef: 'actor:1',
            identityRef: identity.ref,
          },
        },
      },
    }),
  );
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.equal(schema.properties.openingContext.properties.informationOwners.required.length, 12);
  assert.equal(
    schema.properties.openingContext.properties.informationOwners.additionalProperties,
    false,
  );
  assert(JSON.stringify(schema).length <= 24_000);
});

function actorAssignmentFixture(count = 2) {
  const f = informationFixture(),
    source = Array.from({ length: 12 }, (_, i) => `第${i + 1}条属于既有角色的开场信息。`).join('');
  const material = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  material.node.editorialIntent = source;
  f.s.openingContextAuthority!.sourceExcerpt = source;
  f.s.boundary.actorIds = Array.from({ length: count }, (_, i) => `actor-${i}`);
  f.s.cast = f.s.boundary.actorIds.map((id, i) => ({
    id,
    name: `Person ${i + 1}`,
    persona: 'Existing actor',
  }));
  material.participantRefs = f.s.boundary.actorIds.map((actorId) => ({
    actorKey: actorId,
    actorId,
    status: 'resolved' as const,
  }));
  f.s.openingContextAuthority!.actorKnowledge = f.s.boundary.actorIds.map((actorId) => ({
    actorId,
    definitionSourceId: `definition:${actorId}`,
    modules: {
      relationships: `${actorId}的已有身份和关系资料。`,
      lifeContext: `${actorId}的本人人生背景资料。`,
    },
  }));
  const catalog = directorOpeningActorCatalog(f.s);
  const wire = {
    ...f.wire,
    protocol: 'director-wire-v13',
    openingContext: {
      actorAssignments: Object.fromEntries(
        catalog.actors.map((actor) => [
          actor.actorRef,
          {
            informationRefs: [] as string[],
            reason: 'This actor has no assigned source in this judgment.',
          },
        ]),
      ),
    },
  };
  return { ...f, catalog, wire };
}
test('v13 per-actor assignments bind only their own protected identity and preserve exact information', () => {
  const f = actorAssignmentFixture(),
    before = structuredClone(f.wire);
  f.wire.openingContext.actorAssignments['actor:1'] = {
    informationRefs: ['opening-info:1', 'opening-info:2'],
    reason: 'These opening reports belong to this actor.',
  };
  f.wire.openingContext.actorAssignments['actor:2'] = {
    informationRefs: ['opening-info:3'],
    reason: 'This separate report belongs to the second actor.',
  };
  const raw = structuredClone(f.wire),
    p = f.parse(f.wire);
  assert.equal(p.openingContext!.disposition, 'confirm');
  assert.equal(p.openingContext!.premises.length, 3);
  assert.deepEqual(
    p.openingContext!.premises.map((p) => p.actorId),
    ['actor-0', 'actor-0', 'actor-1'],
  );
  for (const premise of p.openingContext!.premises) {
    const own = f.s.openingContextAuthority!.actorKnowledge.find(
      (a) => a.actorId === premise.actorId,
    )!;
    assert.equal(premise.knowledge.module, 'lifeContext');
    assert.equal(premise.knowledge.quote, own.modules.lifeContext);
    assert(f.catalog.information.some((i) => i.text === premise.quote));
  }
  assert.deepEqual(f.wire, raw);
  assert.deepEqual(
    f.parse(before).openingContext!.premises,
    [],
    'zero assignment remains legitimate defer',
  );
  assert.deepEqual(Object.keys(f.catalog.actors[0]!).sort(), ['actorRef', 'canAttribute', 'name']);
  assert.equal(JSON.stringify(f.catalog).includes('opening-identity:'), false);
  const onlyRelationship = actorAssignmentFixture();
  delete onlyRelationship.s.openingContextAuthority!.actorKnowledge[0]!.modules.lifeContext;
  onlyRelationship.wire.openingContext.actorAssignments['actor:1']!.informationRefs = [
    'opening-info:1',
  ];
  assert.equal(
    onlyRelationship.parse(onlyRelationship.wire).openingContext!.premises[0]!.knowledge.module,
    'relationships',
  );
});
test('v13 requires full actor keys and rejects duplicate broadcasts, foreign information and missing source authority', () => {
  const f = actorAssignmentFixture();
  const good = {
    informationRefs: ['opening-info:1'],
    reason: 'An actor-scoped source assignment.',
  };
  const invalid = [
    { 'actor:1': good },
    { ...f.wire.openingContext.actorAssignments, 'actor:99': good },
    {
      ...f.wire.openingContext.actorAssignments,
      'actor:1': { ...good, informationRefs: ['opening-info:99'] },
    },
    {
      ...f.wire.openingContext.actorAssignments,
      'actor:1': { ...good, informationRefs: ['opening-info:1', 'opening-info:1'] },
    },
    { ...f.wire.openingContext.actorAssignments, 'actor:1': good, 'actor:2': good },
    {
      ...f.wire.openingContext.actorAssignments,
      'actor:1': {
        ...good,
        informationRefs: ['opening-info:1', 'opening-info:2', 'opening-info:3'],
      },
    },
  ];
  for (const actorAssignments of invalid)
    assert.throws(() => f.parse({ ...f.wire, openingContext: { actorAssignments } }));
  f.s.openingContextAuthority!.actorKnowledge = f.s.openingContextAuthority!.actorKnowledge.filter(
    (a) => a.actorId !== 'actor-0',
  );
  assert.equal(directorOpeningActorCatalog(f.s).actors[0]!.canAttribute, false);
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        actorAssignments: { ...f.wire.openingContext.actorAssignments, 'actor:1': good },
      },
    }),
  );
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.deepEqual(
    schema.$defs.director_opening_information_owner.properties.actorRef.anyOf[0].enum,
    ['actor:2'],
  );
});
test('v13 six actors receive at most two each; twelve actors at most one each, under unchanged twelve-receipt scope', () => {
  for (const count of [6, 12]) {
    const f = actorAssignmentFixture(count),
      cap = count === 6 ? 2 : 1;
    for (const [index, actor] of f.catalog.actors.entries())
      f.wire.openingContext.actorAssignments[actor.actorRef] = {
        informationRefs: Array.from(
          { length: cap },
          (_, n) => `opening-info:${index * cap + n + 1}`,
        ),
        reason: 'Distinct information scoped to the corresponding actor.',
      };
    const p = f.parse(f.wire);
    assert.equal(p.openingContext!.premises.length, 12);
    const format = directorResponseFormat(f.s);
    if (format.format !== 'json_schema') throw Error('schema');
    const schema: any = format.schema;
    assert.equal(
      schema.$defs.director_opening_information_owner.properties.actorRef.anyOf[0].enum.length,
      count,
    );
    assert.equal(schema.properties.openingContext.properties.informationOwners.required.length, 12);
    assert(JSON.stringify(schema).length <= 24000);
    if (count === 12) {
      f.wire.openingContext.actorAssignments['actor:1']!.informationRefs.push('opening-info:2');
      assert.throws(() => f.parse(f.wire));
    }
  }
});

function singleOwnerFixture() {
  const f = actorAssignmentFixture(6),
    material = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  const text = [
    '开场事件：全局标题只描述作品开端。',
    '**场景：已有街边与聊天界面。**',
    '人物甲收到已有项目的新消息，人物乙提出另一个已有安排。',
    '### 地点：已存在的办公室',
    '人物丙准备解释自己的情况。',
  ].join('\n');
  material.node.editorialIntent = text;
  f.s.openingContextAuthority!.sourceExcerpt = text;
  const catalog = directorOpeningOwnerCatalog(f.s);
  const wire = {
    ...f.wire,
    protocol: 'director-wire-v14',
    openingContext: {
      informationOwners: Object.fromEntries(
        catalog.information.map((info) => [
          info.ref,
          {
            actorRef: null as string | null,
            reason: 'No justified personal owner assigned to this source.',
          },
        ]),
      ),
    },
  };
  return { ...f, catalog, wire };
}
test('v14 schema gives each information source only one owner and rejects the original broadcast shape', () => {
  const f = singleOwnerFixture(),
    before = structuredClone(f.wire);
  f.wire.openingContext.informationOwners['opening-info:1'] = {
    actorRef: 'actor:1',
    reason: 'This source belongs to the first actor.',
  };
  f.wire.openingContext.informationOwners['opening-info:2'] = {
    actorRef: 'actor:2',
    reason: 'This distinct source belongs to the second actor.',
  };
  const raw = structuredClone(f.wire),
    p = f.parse(f.wire);
  assert.equal(p.openingContext!.premises.length, 2);
  assert.deepEqual(
    p.openingContext!.premises.map((p) => p.actorId),
    ['actor-0', 'actor-1'],
  );
  assert.equal(p.openingContext!.premises[0]!.quote, f.catalog.information[0]!.text);
  assert.deepEqual(f.wire, raw);
  assert.equal(f.parse(before).openingContext!.disposition, 'defer');
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        actorAssignments: Object.fromEntries(
          f.catalog.actors.map((a) => [
            a.actorRef,
            {
              informationRefs: ['opening-info:1', 'opening-info:2'],
              reason: 'Same two global sources for everyone.',
            },
          ]),
        ),
      },
    }),
  );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationOwners: {
          ...f.wire.openingContext.informationOwners,
          'opening-info:1': {
            actorRef: ['actor:1', 'actor:2'],
            reason: 'Broadcast is not a single owner.',
          },
        },
      },
    }),
  );
  const format = directorResponseFormat(f.s);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.deepEqual(
    schema.properties.openingContext.properties.informationOwners.required,
    f.catalog.information.map((i) => i.ref),
  );
  assert.equal(
    schema.properties.openingContext.properties.informationOwners.additionalProperties,
    false,
  );
  assert.deepEqual(
    schema.$defs.director_opening_information_owner.properties.actorRef.anyOf[0].enum,
    f.catalog.actors.map((a) => a.actorRef),
  );
  assert(JSON.stringify(schema).length <= 24000);
});
test('v14 excludes explicit opening titles and standalone Markdown scene metadata without rewriting ordinary text', () => {
  const f = singleOwnerFixture(),
    raw = f.s.openingContextAuthority!.sourceExcerpt;
  assert.deepEqual(
    f.catalog.information.map((i) => i.text),
    ['人物甲收到已有项目的新消息，', '人物乙提出另一个已有安排。', '人物丙准备解释自己的情况。'],
  );
  for (const info of f.catalog.information) assert(raw.includes(info.text));
  const old = directorOpeningActorCatalog(f.s);
  assert.equal(
    old.information[0]!.text,
    '开场事件：全局标题只描述作品开端。',
    'v13 paid indexing remains unchanged',
  );
  const material = f.s.authoredMaterials!.materials.find((m) => m.role === 'opening')!;
  const ordinary =
    '人物甲的第一段普通正文应当保留。\n场景：这是没有Markdown标记的普通正文。\nAnother unmarked line remains exact.';
  material.node.editorialIntent = ordinary;
  f.s.openingContextAuthority!.sourceExcerpt = ordinary;
  assert.deepEqual(
    directorOpeningOwnerCatalog(f.s).information.map((i) => i.text),
    ordinary.split('\n'),
  );
});
test('v14 rejects missing or foreign ownership keys and actors without protected identity, while null is lawful', () => {
  const f = singleOwnerFixture(),
    choices = f.wire.openingContext.informationOwners;
  const missing = structuredClone(choices);
  delete missing['opening-info:1'];
  assert.throws(() => f.parse({ ...f.wire, openingContext: { informationOwners: missing } }));
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationOwners: {
          ...choices,
          'opening-info:99': { actorRef: null, reason: 'Unknown source' },
        },
      },
    }),
  );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationOwners: {
          ...choices,
          'opening-info:1': { actorRef: 'actor:99', reason: 'Unbound actor' },
        },
      },
    }),
  );
  f.s.openingContextAuthority!.actorKnowledge = f.s.openingContextAuthority!.actorKnowledge.filter(
    (a) => a.actorId !== 'actor-0',
  );
  assert.throws(() =>
    f.parse({
      ...f.wire,
      openingContext: {
        informationOwners: {
          ...choices,
          'opening-info:1': { actorRef: 'actor:1', reason: 'Missing personal source' },
        },
      },
    }),
  );
  assert.equal(f.parse(f.wire).openingContext!.disposition, 'defer');
});
