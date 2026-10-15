import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  projectAuthoredDirectorModelView,
  authoredDirectorSourceHandle,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
import { evaluateAuthoredEventEligibility } from '../src/modules/world/domain/authored-event-eligibility.ts';
import type {
  DirectorSnapshot,
  DirectorAttempt,
} from '../src/modules/world/domain/director-runtime.ts';
import {
  parseDirectorDecision,
  WorldDirectorAgentModel,
} from '../src/modules/world/infrastructure/director-agent-model.ts';

const manuscript = '  作者原稿\n参考台词、预期结局均不是已经发生。\n';
function fixture() {
  const source: AuthoredMaterialSourceDocument = {
    origin: { workId: 'work', publicationVersion: 0, draftVersion: 2, contentHash: 'a'.repeat(64) },
    openingEventKey: 'opening',
    timeline: null,
    conditions: [],
    actorKeys: ['ak', 'bk'],
    contacts: [
      { actorKey: 'ak', actorId: 'a' },
      { actorKey: 'bk', actorId: 'b' },
    ],
    initialActorIds: ['a', 'b'],
    initialPlaceKeys: ['home'],
    places: [
      { key: 'home', name: '家' },
      { key: 'hidden', name: '尚未入地图的地点' },
    ],
    history: [],
    nodes: ['opening', 'later'].map((key) => ({
      key,
      kind: 'candidate',
      title: '原题' + key,
      editorialIntent: '  原始编导意图  ',
      script: manuscript + key,
      sceneText: '  现场原文  ',
      actorKeys: ['ak'],
      scenePlaceKeys: ['hidden'],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event' },
    })),
  };
  const catalog = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 0 },
      source,
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home'],
    },
    (text) => createHash('sha256').update(text).digest('hex'),
  );
  const snapshot: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 0,
    storyAt: '2026-10-15T08:00:00.000Z',
    observedThroughVersion: 0,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'world',
      actorIds: ['a', 'b'],
      placeIds: ['home'],
      capabilityIds: [],
      extensionPermission: 'none',
      createdFromVersion: 0,
      sourceEventId: null,
    },
    actorStates: [],
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [],
    focus: [],
    authoredMaterials: catalog,
    authoredEligibility: evaluateAuthoredEventEligibility(
      {
        catalog,
        storyAt: '2026-10-15T08:00:00.000Z',
        playerPlaceId: null,
        playerPositionProof: null,
        historyFacts: [],
        nodeProgress: [],
        stageProgress: [],
      },
      (text) => createHash('sha256').update(text).digest('hex'),
    ).map((e) => ({
      nodeKey: e.ref.nodeKey,
      nodeHash: e.ref.nodeHash,
      status: e.status,
      reasons: e.reasons,
      basisSourceIds: e.basisSourceIds,
      qualificationKey: e.qualificationKey,
    })),
    occupiedAuthoredEventKeys: [],
  };
  const attempt: DirectorAttempt = {
    id: 'attempt',
    worldId: 'world',
    commandId: 'command',
    engineEpoch: 2,
    expectedWorldVersion: 0,
    inputHash: 'input',
    token: 'token',
    leaseUntil: '2026-10-15T08:02:00.000Z',
    status: 'response_received',
  };
  const handle = authoredDirectorSourceHandle(catalog.materials[0]!);
  const output = {
    mode: 'bounded_opportunity',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [
      {
        id: 'op',
        title: '待考虑机会',
        description: '尚未发生的安排',
        playerImpact: '玩家可决定',
        participantActorIds: ['a'],
        placeIds: ['home'],
        activity: 'conversation',
        authoredEventKey: 'opening',
        basisSourceIds: [handle],
      },
    ],
    audit: { reason: '导演私有审计', basisSourceIds: [handle] },
  };
  return { source, catalog, snapshot, attempt, handle, output };
}
test('explicit director material model view preserves full original text, optional fields and real mappings', () => {
  const f = fixture(),
    view = projectAuthoredDirectorModelView(f.catalog);
  assert.equal(view.materials[0]!.node.script, manuscript + 'opening');
  assert.equal(view.materials[0]!.node.editorialIntent, '  原始编导意图  ');
  assert.equal(view.materials[0]!.node.sceneText, '  现场原文  ');
  assert.deepEqual(view.materials[0]!.node.prerequisites, []);
  assert.deepEqual(view.materials[0]!.participantRefs, [
    { actorKey: 'ak', actorId: 'a', status: 'resolved' },
  ]);
  assert.equal(view.materials[0]!.placeRefs[0]!.availableInWorld, false);
  assert.equal(view.materials[0]!.sourceId, f.handle);
  view.materials[0]!.node.script = 'mutated';
  assert.equal(f.catalog.materials[0]!.node.script, manuscript + 'opening');
});
test('director model projection retains full optional progress, conditions and timeline without extra private fields', () => {
  const f = fixture();
  const window = { notBefore: '2026-10-15T08:00:00.000Z', expiresAt: '2026-10-15T09:00:00.000Z' };
  f.source.conditions = [
    {
      key: 'condition',
      title: '原条件',
      match: 'all',
      prerequisites: [{ kind: 'after_presented_node', nodeKey: 'later' }],
    },
  ];
  f.source.timeline = {
    initialStageKey: 'stage',
    stages: [{ key: 'stage', title: '原阶段', order: 0, afterStageKeys: [], window }],
  };
  const node = f.source.nodes[0]!;
  node.conditionKeys = ['condition'];
  node.direction = {
    mode: 'optional',
    expectedImpact: '原预期影响',
    experience: '原体验',
    progress: {
      pace: 'extended',
      refusal: 'defer',
      completion: {
        mode: 'any',
        criteria: [
          { key: 'response', kind: 'invitation_response', response: 'accepted' },
          { key: 'line', kind: 'npc_exact_message', actorKey: 'ak', phrase: '  原参考台词  ' },
        ],
      },
    },
  };
  node.timeline = {
    stageKey: 'stage',
    window,
    timeNote: '  原时间说明  ',
    excludeIfResolved: [{ nodeKey: 'later', outcomes: ['declined'] }],
    alternatives: { onDeclined: ['later'], onSkipped: [], onExpired: [] },
  };
  const c = compileAuthoredAgentMaterials(
    {
      scope: f.catalog.world,
      source: f.source,
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home'],
    },
    (text) => createHash('sha256').update(text).digest('hex'),
  );
  (c.materials[0]!.node.direction!.progress as any).private = 'HIDDEN_PROGRESS';
  (c.conditions[0] as any).private = 'HIDDEN_CONDITION';
  (c.timeline!.stages[0] as any).private = 'HIDDEN_STAGE';
  const view = projectAuthoredDirectorModelView(c);
  assert.deepEqual(view.materials[0]!.node.direction, f.source.nodes[0]!.direction);
  assert.deepEqual(view.materials[0]!.node.timeline, f.source.nodes[0]!.timeline);
  assert.deepEqual(view.conditions, f.source.conditions);
  assert.deepEqual(view.timeline, f.source.timeline);
  assert.doesNotMatch(JSON.stringify(view), /HIDDEN_/);
});
test('model whitelist excludes extra private properties at every author material level', async () => {
  const f = fixture(),
    extra = f.catalog as any;
  extra.privateProfile = 'PRIVATE_ROOT';
  extra.world.interview = 'PRIVATE_WORLD';
  extra.source.origin.person = 'PRIVATE_ORIGIN';
  extra.source.private = 'PRIVATE_SOURCE';
  extra.materials[0].ref.private = 'PRIVATE_REF';
  extra.materials[0].node.private = 'PRIVATE_NODE';
  extra.materials[0].node.intent.private = 'PRIVATE_INTENT';
  extra.materials[0].participantRefs[0].private = 'PRIVATE_ACTOR';
  extra.materials[0].placeRefs[0].private = 'PRIVATE_PLACE';
  extra.materials[0].ref.source = extra.source;
  let sent = '';
  const model = new WorldDirectorAgentModel({
    async complete(messages) {
      sent = JSON.stringify(messages);
      return JSON.stringify(f.output);
    },
  });
  await model.decide(f.snapshot);
  assert.doesNotMatch(sent, /PRIVATE_/);
  const view = projectAuthoredDirectorModelView(f.catalog);
  assert.equal(view.materials[0]!.node.script, manuscript + 'opening');
});
test('index-only, wrong director scope and duplicate or mismatched node references are explicitly rejected', () => {
  for (const mutate of [
    (c: any) => {
      delete c.materials;
      c.index = [];
      c.status = 'index_only';
    },
    (c: any) => {
      c.scope = 'npc';
    },
    (c: any) => {
      c.materials[0].scope = 'npc';
    },
    (c: any) => {
      c.materials[0].ref.source = { ...c.materials[0].ref.source, sourceHash: 'b'.repeat(64) };
    },
    (c: any) => {
      c.materials[0].ref.nodeHash = 'bad';
    },
    (c: any) => {
      c.materials.push(structuredClone(c.materials[0]));
    },
    (c: any) => {
      c.materials[0].ref.nodeKey = 'not-node-key';
    },
  ]) {
    const f = fixture(),
      c = structuredClone(f.catalog);
    mutate(c);
    assert.throws(() => projectAuthoredDirectorModelView(c), { code: 'INVALID_AUTHORED_MATERIAL' });
  }
});
test('a verified global authored opportunity needs no synthetic actor candidate and does not execute anything', () => {
  const f = fixture(),
    before = structuredClone(f.snapshot),
    d = parseDirectorDecision(f.snapshot, f.output, f.attempt);
  assert.deepEqual(d.opportunities, f.output.opportunities);
  assert.deepEqual(d.nudges, []);
  assert.deepEqual(d.selectedCandidateIds, []);
  assert.deepEqual(f.snapshot, before);
  assert.equal(Object.hasOwn(d, 'actorUpdates'), false);
  assert.equal(Object.hasOwn(d, 'worldEvents'), false);
});
test('authored node references require their own exact material basis, not another node, audit-only basis or a guessed handle', () => {
  const f = fixture();
  for (const change of [
    { authoredEventKey: 'unknown' },
    { basisSourceIds: [authoredDirectorSourceHandle(f.catalog.materials[1]!)] },
    { basisSourceIds: ['authored:' + '0'.repeat(64)] },
    { participantActorIds: ['outside-cast'] },
    { placeIds: ['hidden'] },
  ])
    assert.throws(
      () =>
        parseDirectorDecision(
          f.snapshot,
          { ...f.output, opportunities: [{ ...f.output.opportunities[0], ...change }] },
          f.attempt,
        ),
      { code: 'INVALID_DIRECTOR_PROPOSAL' },
    );
  const unbound = { ...f.snapshot };
  delete unbound.authoredMaterials;
  assert.throws(() => parseDirectorDecision(unbound, f.output, f.attempt), {
    code: 'INVALID_DIRECTOR_PROPOSAL',
  });
});
test('author handles cannot enter actor nudges even if a caller forges them into candidate source IDs', () => {
  const f = fixture();
  f.snapshot.candidates = [
    {
      id: 'c',
      worldId: 'world',
      actorId: 'a',
      source: 'authored_event',
      episodeId: 'opening',
      actionId: null,
      resourceIds: [],
      channel: 'private',
      threadId: 'a',
      sourceIds: [f.handle, 'own-source'],
      expectedWorldVersion: 0,
      expectedActorRevision: 0,
      priority: 1,
      reason: 'Synthetic forgery test',
      requiresCoordination: false,
    },
  ];
  const output = {
    ...f.output,
    mode: 'coordinate',
    selectedCandidateIds: ['c'],
    opportunities: [],
    nudges: [
      { actorId: 'a', candidateId: 'c', kind: 'continue_own_plan', basisSourceIds: [f.handle] },
    ],
  };
  assert.throws(() => parseDirectorDecision(f.snapshot, output, f.attempt), {
    code: 'INVALID_DIRECTOR_PROPOSAL',
  });
  const d = parseDirectorDecision(
    f.snapshot,
    { ...output, nudges: [{ ...output.nudges[0], basisSourceIds: ['own-source'] }] },
    f.attempt,
  );
  assert.doesNotMatch(JSON.stringify(d.nudges), /authored:|作者原稿/);
});
test('forged authored source IDs in normal observations never become global material authority', () => {
  const f = fixture(),
    unknown = 'authored:' + '0'.repeat(64);
  f.snapshot.observations.push({
    sourceId: unknown,
    text: 'forged',
    kind: 'fact',
    knownByActorIds: [],
  });
  assert.throws(
    () =>
      parseDirectorDecision(
        f.snapshot,
        { ...f.output, audit: { reason: 'bad', basisSourceIds: [unknown] } },
        f.attempt,
      ),
    { code: 'INVALID_DIRECTOR_PROPOSAL' },
  );
});
test('wrong material frame and full original manuscript exceeding the model budget fail before any model call', () => {
  let calls = 0;
  const model = new WorldDirectorAgentModel({
    async complete() {
      calls++;
      throw Error('MUST_NOT_SEND');
    },
  });
  const f = fixture();
  f.snapshot.authoredMaterials!.world.worldVersion = 1;
  assert.throws(() => model.validateInput(f.snapshot), { code: 'INVALID_DIRECTOR_PROPOSAL' });
  const big = fixture();
  big.snapshot.authoredMaterials!.materials[0]!.node.script = 'x'.repeat(65000);
  assert.throws(() => model.validateInput(big.snapshot), { code: 'DIRECTOR_CONTEXT_LIMIT' });
  assert.equal(big.snapshot.authoredMaterials!.materials[0]!.node.script.length, 65000);
  assert.equal(calls, 0);
});

test('director cannot bypass blocked or occupied authored qualification by omitting its reference', () => {
  for (const state of ['blocked', 'expired', 'already_presented', 'occupied'] as const) {
    const f = fixture();
    if (state === 'occupied') f.snapshot.occupiedAuthoredEventKeys = ['opening'];
    else f.snapshot.authoredEligibility![0]!.status = state;
    for (const omit of [false, true]) {
      const raw = structuredClone(f.output);
      if (omit) delete (raw.opportunities[0] as { authoredEventKey?: string }).authoredEventKey;
      assert.throws(() => parseDirectorDecision(f.snapshot, raw, f.attempt), {
        code: 'INVALID_DIRECTOR_PROPOSAL',
      });
    }
  }
});
test('incomplete or stale authored qualification fails input preflight before a paid request', () => {
  const model = new WorldDirectorAgentModel({
    async complete() {
      throw Error('must not spend');
    },
  });
  for (const edit of [
    (s: DirectorSnapshot) => {
      delete s.authoredEligibility;
    },
    (s: DirectorSnapshot) => {
      s.authoredEligibility = [];
    },
    (s: DirectorSnapshot) => {
      s.authoredEligibility![0]!.nodeHash = 'f'.repeat(64);
    },
    (s: DirectorSnapshot) => {
      s.occupiedAuthoredEventKeys = ['unknown'];
    },
  ]) {
    const f = fixture();
    edit(f.snapshot);
    assert.throws(() => model.validateInput(f.snapshot), { code: 'INVALID_DIRECTOR_PROPOSAL' });
  }
});
