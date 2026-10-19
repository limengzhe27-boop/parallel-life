import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ModelMessage,
  ModelOutputOptions,
  TextModel,
} from '../src/modules/ai/application/ports.ts';
import {
  WorldDirectorAgentModel,
  parseDirectorDecision,
  DIRECTOR_RUNTIME_PROMPT_VERSION,
} from '../src/modules/world/infrastructure/director-agent-model.ts';
import type {
  DirectorAttempt,
  DirectorSnapshot,
} from '../src/modules/world/domain/director-runtime.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';

function fixture() {
  const snapshot: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: '2026-10-15T08:00:00.000Z',
    observedThroughVersion: 5,
    evaluatedThroughVersion: 3,
    boundary: {
      worldId: 'world',
      actorIds: ['a', 'b'],
      placeIds: ['home', 'shop'],
      capabilityIds: ['plan.record', 'appointment.propose'],
      extensionPermission: 'none',
      createdFromVersion: 5,
      sourceEventId: 'e5',
    },
    worldSetting: '已经授权的虚构城市生活',
    cast: [
      { id: 'a', name: 'A', persona: '虚构且有边界的人物 A' },
      { id: 'b', name: 'B', persona: '虚构人物 B' },
    ],
    actorStates: ['a', 'b'].map((actorId) =>
      emptyActorAgentState({ worldId: 'world', actorId }, 'fictional-definition', 5),
    ),
    episodes: [],
    candidates: ['a', 'b'].map((actorId) => ({
      id: 'candidate-' + actorId,
      worldId: 'world',
      actorId,
      source: actorId === 'a' ? 'actor_plan' : 'responsibility',
      episodeId: null,
      actionId: null,
      resourceIds: [],
      channel: 'private',
      threadId: actorId,
      sourceIds: [actorId + '-source'],
      expectedWorldVersion: 5,
      expectedActorRevision: 0,
      priority: 1,
      reason: '真实来源的合成候选',
      requiresCoordination: false,
    })),
    blockers: [],
    changes: [],
    observations: [
      { sourceId: 'a-source', text: 'A 可见的虚构事实', kind: 'fact', knownByActorIds: ['a'] },
      { sourceId: 'b-source', text: 'DIRECTOR_PRIVATE_B', kind: 'belief', knownByActorIds: ['b'] },
    ],
    focus: [],
  };
  const attempt: DirectorAttempt = {
    id: 'director-attempt',
    worldId: 'world',
    commandId: 'command',
    engineEpoch: 2,
    expectedWorldVersion: 5,
    inputHash: 'protected-input-hash',
    token: 'lease-token',
    leaseUntil: '2026-10-15T08:02:00.000Z',
    status: 'response_received',
  };
  const quiet = {
    mode: 'quiet' as const,
    selectedCandidateIds: [] as string[],
    deferred: snapshot.candidates.map((c) => ({
      candidateId: c.id,
      reason: '没有新依据，安静观察',
    })),
    nudges: [] as {
      actorId: string;
      candidateId: string;
      kind: 'continue_own_plan';
      basisSourceIds: string[];
    }[],
    opportunities: [] as Opportunity[],
    audit: { reason: 'DIRECTOR_PRIVATE_AUDIT', basisSourceIds: ['b-source'] },
  };
  const coordinate = {
    ...structuredClone(quiet),
    mode: 'coordinate' as const,
    selectedCandidateIds: ['candidate-a'],
    deferred: [{ candidateId: 'candidate-b', reason: '稍后重评' }],
    nudges: [
      {
        actorId: 'a',
        candidateId: 'candidate-a',
        kind: 'continue_own_plan' as const,
        basisSourceIds: ['a-source'],
      },
    ],
  };
  const opportunity = {
    id: 'op1',
    title: '待考虑的会面',
    description: '尚未发生且参与由本人决定',
    playerImpact: '可以选择是否参与',
    participantActorIds: ['a'],
    placeIds: ['shop'],
    activity: 'meeting' as const,
    basisSourceIds: ['a-source'],
  };
  const bounded = {
    ...structuredClone(quiet),
    mode: 'bounded_opportunity' as const,
    opportunities: [opportunity],
  };
  return {
    snapshot,
    attempt,
    quiet,
    coordinate,
    opportunity,
    bounded,
    parse: (raw: unknown) => parseDirectorDecision(snapshot, raw, attempt),
  };
}
type Opportunity = {
  id: string;
  title: string;
  description: string;
  playerImpact: string;
  participantActorIds: string[];
  placeIds: string[];
  activity: 'conversation' | 'meeting' | 'follow_up';
  basisSourceIds: string[];
  authoredEventKey?: string;
};
function rejected(f: ReturnType<typeof fixture>, raw: unknown) {
  assert.throws(() => f.parse(raw), { code: 'INVALID_DIRECTOR_PROPOSAL' });
}

test('quiet is a valid immutable typed director decision and cannot add NPC execution or a world event', () => {
  const f = fixture(),
    before = structuredClone(f.snapshot),
    d = f.parse(JSON.stringify(f.quiet));
  assert.equal(d.mode, 'quiet');
  assert.equal(d.id, 'director-attempt:decision');
  assert.equal(d.inputHash, f.attempt.inputHash);
  assert.equal(d.evaluatedThroughVersion, 5);
  assert.deepEqual(d.selectedCandidateIds, []);
  assert.deepEqual(d.opportunities, []);
  assert.deepEqual(d.nudges, []);
  assert.deepEqual(f.snapshot, before);
  assert.equal(Object.hasOwn(d, 'worldEvents'), false);
  assert.equal(Object.hasOwn(d, 'actorUpdates'), false);
});
test('every candidate must appear exactly once selected or deferred', () => {
  const f = fixture();
  for (const raw of [
    { ...f.quiet, deferred: [] },
    { ...f.quiet, deferred: [f.quiet.deferred[0]] },
    { ...f.coordinate, selectedCandidateIds: ['candidate-a', 'candidate-a'] },
    { ...f.coordinate, deferred: [{ candidateId: 'candidate-a', reason: 'double counted' }] },
    { ...f.quiet, deferred: [...f.quiet.deferred, { candidateId: 'invented', reason: 'unknown' }] },
    { ...f.quiet, deferred: [...f.quiet.deferred, f.quiet.deferred[0]] },
  ])
    rejected(f, raw);
  assert.equal(f.parse(f.coordinate).selectedCandidateIds[0], 'candidate-a');
});
test('typed nudge uses the selected candidate actor and only that candidate already-authorized source subset', () => {
  const f = fixture();
  assert.deepEqual(f.parse(f.coordinate).nudges, f.coordinate.nudges);
  for (const n of [
    { ...f.coordinate.nudges[0], actorId: 'b' },
    { ...f.coordinate.nudges[0], candidateId: 'candidate-b' },
    { ...f.coordinate.nudges[0], basisSourceIds: ['b-source'] },
    { ...f.coordinate.nudges[0], basisSourceIds: ['unseen-private-source'] },
    { ...f.coordinate.nudges[0], basisSourceIds: [] },
  ])
    rejected(f, { ...f.coordinate, nudges: [n] });
});
test('director selection cannot override a scoped deterministic blocker', () => {
  const f = fixture();
  f.snapshot.blockers = [
    {
      scope: { kind: 'actor', actorId: 'a' },
      reason: 'unknown_attempt',
      sourceId: 'pending-a',
      reconsiderOn: [],
    },
  ];
  rejected(f, f.coordinate);
  assert.equal(f.parse(f.quiet).mode, 'quiet');
  assert.deepEqual(
    f.parse({
      ...f.coordinate,
      selectedCandidateIds: ['candidate-b'],
      deferred: [{ candidateId: 'candidate-a', reason: '原结果尚不明确' }],
      nudges: [],
    }).selectedCandidateIds,
    ['candidate-b'],
  );
});
test('global private audit and opportunity prose are never converted into free-text NPC instructions', () => {
  const f = fixture(),
    d = f.parse({
      ...f.coordinate,
      audit: { reason: 'PRIVATE_AUDIT_NOT_FOR_NPC', basisSourceIds: ['b-source'] },
    });
  assert.deepEqual(Object.keys(d.nudges[0]!).sort(), [
    'actorId',
    'basisSourceIds',
    'candidateId',
    'kind',
  ]);
  assert.doesNotMatch(JSON.stringify(d.nudges), /PRIVATE_AUDIT|DIRECTOR_PRIVATE_B/);
  for (const extra of [
    { intent: 'PRIVATE_AUDIT_NOT_FOR_NPC' },
    { text: 'DIRECTOR_PRIVATE_B' },
    { parameters: { secret: 'DIRECTOR_PRIVATE_B' } },
    { title: '用标题夹带隐私' },
    { description: '不允许把全局草案直接发给NPC' },
  ])
    rejected(f, { ...f.coordinate, nudges: [{ ...f.coordinate.nudges[0], ...extra }] });
  rejected(f, { ...f.coordinate, intent: '自由导演命令' });
});
test('candidate cannot be nudged twice and duplicate source references are not accepted as a strict set', () => {
  const f = fixture();
  rejected(f, { ...f.coordinate, nudges: [...f.coordinate.nudges, ...f.coordinate.nudges] });
  rejected(f, {
    ...f.coordinate,
    nudges: [{ ...f.coordinate.nudges[0], basisSourceIds: ['a-source', 'a-source'] }],
  });
});
test('global audit source references also obey the same unique-set protocol as the durable decision', () => {
  const f = fixture();
  rejected(f, { ...f.quiet, audit: { reason: 'audit', basisSourceIds: ['a-source', 'a-source'] } });
});
test('bounded opportunity is planning only, limited to existing actor/place/activity and authorized basis', () => {
  const f = fixture(),
    d = f.parse(f.bounded);
  assert.deepEqual(d.opportunities, [f.opportunity]);
  for (const bad of [
    { ...f.opportunity, participantActorIds: ['new-important-person'] },
    { ...f.opportunity, placeIds: ['new-city'] },
    { ...f.opportunity, activity: 'execute-world-change' },
    { ...f.opportunity, basisSourceIds: ['real-profile-or-unseen-source'] },
    { ...f.opportunity, participantActorIds: [] },
    { ...f.opportunity, basisSourceIds: [] },
  ])
    rejected(f, { ...f.bounded, opportunities: [bad] });
});
test('opportunity cannot claim active status, real result, private attitude, player agreement or execution fields', () => {
  const f = fixture();
  for (const extra of [
    { status: 'active' },
    { sourceEventIds: ['fabricated-event'] },
    { resultIds: ['fabricated-result'] },
    { playerAgreed: true },
    { actorAttitude: 'A已经同意' },
    { worldFacts: ['已经到场'] },
    { statements: [{ actorId: 'a', text: '伪NPC对白' }] },
  ])
    rejected(f, { ...f.bounded, opportunities: [{ ...f.opportunity, ...extra }] });
  for (const extra of [{ worldEvents: [] }, { actorUpdates: [] }, { playerFacts: [] }])
    rejected(f, { ...f.bounded, ...extra });
});
test('opportunity IDs, participants, places and basis source lists cannot contain ambiguous duplicates', () => {
  const f = fixture();
  rejected(f, {
    ...f.bounded,
    opportunities: [f.opportunity, { ...f.opportunity, title: 'same id different draft' }],
  });
  for (const bad of [
    { ...f.opportunity, participantActorIds: ['a', 'a'] },
    { ...f.opportunity, placeIds: ['shop', 'shop'] },
    { ...f.opportunity, basisSourceIds: ['a-source', 'a-source'] },
  ])
    rejected(f, { ...f.bounded, opportunities: [bad] });
});
test('at most two finite opportunities; quiet/coordinate cannot quietly introduce a new episode', () => {
  const f = fixture();
  rejected(f, {
    ...f.bounded,
    opportunities: [
      f.opportunity,
      { ...f.opportunity, id: 'op2' },
      { ...f.opportunity, id: 'op3' },
    ],
  });
  rejected(f, { ...f.quiet, opportunities: [f.opportunity] });
  rejected(f, { ...f.coordinate, opportunities: [f.opportunity] });
  rejected(f, { ...f.bounded, opportunities: [] });
  rejected(f, {
    ...f.quiet,
    selectedCandidateIds: ['candidate-a'],
    deferred: [f.quiet.deferred[1]],
  });
  rejected(f, { ...f.quiet, nudges: f.coordinate.nudges });
});
test('an actor authored candidate cannot substitute for a verified global authored catalogue', () => {
  const f = fixture(),
    raw = { ...f.bounded, opportunities: [{ ...f.opportunity, authoredEventKey: 'authored-key' }] };
  rejected(f, raw);
  f.snapshot.candidates.push({
    ...f.snapshot.candidates[0]!,
    id: 'authored-candidate',
    source: 'authored_event',
    episodeId: 'authored-key',
  });
  rejected(f, {
    ...raw,
    deferred: [...f.quiet.deferred, { candidateId: 'authored-candidate', reason: '待编排' }],
  });
});
test('decision metadata comes from the protected attempt/snapshot and cannot be injected in model JSON', () => {
  const f = fixture();
  for (const extra of [
    { id: 'model-owned-id' },
    { worldId: 'foreign' },
    { engineEpoch: 999 },
    { worldVersion: 999 },
    { inputHash: 'forged' },
    { evaluatedThroughVersion: 999 },
  ])
    rejected(f, { ...f.quiet, ...extra });
  for (const changed of [{ worldId: 'foreign' }, { engineEpoch: 3 }, { expectedWorldVersion: 6 }])
    assert.throws(() => parseDirectorDecision(f.snapshot, f.quiet, { ...f.attempt, ...changed }), {
      code: 'INVALID_DIRECTOR_PROPOSAL',
    });
  rejected(f, {
    ...f.quiet,
    audit: { reason: 'unproved', basisSourceIds: ['outside-authorized-global-view'] },
  });
});
test('malformed/nonobject/extra-unknown JSON is explicit invalid output, without extracting a fake successful object', () => {
  const f = fixture();
  for (const raw of [
    'not JSON',
    '```json\n' + JSON.stringify(f.quiet) + '\n```',
    null,
    [],
    0,
    { ...f.quiet, extra: 'not permitted' },
  ])
    rejected(f, raw);
});
test('model adapter performs input preflight without spending, uses JSON output budget, and returns the original raw response', async () => {
  const f = fixture(),
    calls: {
      messages: ModelMessage[];
      signal?: AbortSignal;
      tokens?: number;
      output?: ModelOutputOptions;
    }[] = [];
  const raw = JSON.stringify(f.quiet);
  const model: TextModel = {
    async complete(messages, signal, tokens, output) {
      calls.push({ messages, signal, tokens, output });
      return raw;
    },
  };
  const adapter = new WorldDirectorAgentModel(model),
    controller = new AbortController();
  adapter.validateInput(f.snapshot);
  assert.equal(calls.length, 0);
  assert.equal(await adapter.decide(f.snapshot, controller.signal), raw);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.tokens, 4096);
  assert.equal(calls[0]!.output?.format, 'json_schema');
  assert.equal(calls[0]!.signal, controller.signal);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.equal(payload.promptVersion, DIRECTOR_RUNTIME_PROMPT_VERSION);
  assert.deepEqual(payload.taskParticipants, {
    player: { kind: 'player', role: 'protagonist', isNpc: false },
    assignments: [
      {
        actorRef: 'actor:1',
        performer: { kind: 'npc', actorId: 'a', name: 'A' },
        intendedInterlocutor: { kind: 'player', role: 'protagonist' },
        authority: 'future_suggestion_not_fact',
      },
      {
        actorRef: 'actor:2',
        performer: { kind: 'npc', actorId: 'b', name: 'B' },
        intendedInterlocutor: { kind: 'player', role: 'protagonist' },
        authority: 'future_suggestion_not_fact',
      },
    ],
  });
  assert.match(calls[0]!.messages[0]!.content, /quiet是正常决定/);
  assert.match(calls[0]!.messages[0]!.content, /全局audit只供导演审计/);
});
test('director request whitelists fictional fields at the root and inside persistent actor state', async () => {
  const f = fixture(),
    sent: ModelMessage[][] = [];
  const model: TextModel = {
    async complete(messages) {
      sent.push(messages);
      return JSON.stringify(f.quiet);
    },
  };
  const snapshot = {
    ...f.snapshot,
    profile: { full: 'REAL_PROFILE_SENTINEL' },
    interviewTranscript: 'REAL_PRIVATE_INTERVIEW_SENTINEL',
  };
  const state = snapshot.actorStates[0]!;
  Object.assign(state, { privateProfile: 'NESTED_REAL_PROFILE_SENTINEL' });
  state.goals.push({
    id: 'g',
    summary: '已授权目标',
    status: 'active',
    sourceIds: ['a-source'],
    resultIds: [],
  });
  Object.assign(state.goals[0]!, { interview: 'NESTED_PRIVATE_INTERVIEW_SENTINEL' });
  state.responsibilities.push({
    id: 'r',
    revision: 0,
    subject: { kind: 'request', id: 'request' },
    summary: '原请求',
    status: 'open',
    waitingOn: 'player',
    sourceIds: ['a-source'],
    nextCheck: [],
  });
  state.decisions.push({
    id: 'd',
    responsibilityId: 'r',
    responsibilityRevision: 0,
    kind: 'deferred',
    sourceId: 'a-source',
    quote: '稍后决定',
  });
  await new WorldDirectorAgentModel(model).decide(snapshot);
  assert.doesNotMatch(
    JSON.stringify(sent),
    /REAL_PROFILE_SENTINEL|REAL_PRIVATE_INTERVIEW_SENTINEL|NESTED_PRIVATE_INTERVIEW_SENTINEL/,
  );
  const payload = JSON.parse(sent[0]![1]!.content);
  assert.deepEqual(payload.cast, f.snapshot.cast);
  assert.equal(payload.worldSetting, f.snapshot.worldSetting);
  assert.equal(payload.actorStates[0].responsibilities[0].revision, 0);
  assert.equal(payload.actorStates[0].decisions[0].responsibilityRevision, 0);
  assert.equal(payload.actorStates[0].decisions[0].quote, '稍后决定');
  // Fictional director-only knowledge is expected here; it is not an NPC payload.
  assert.match(sent[0]![1]!.content, /DIRECTOR_PRIVATE_B/);
});
test('oversize context and incomplete observed snapshot fail before any model call or hidden changes truncation', async () => {
  const f = fixture();
  let calls = 0;
  const adapter = new WorldDirectorAgentModel({
    async complete() {
      calls++;
      return JSON.stringify(f.quiet);
    },
  });
  const large = {
    ...f.snapshot,
    observations: [
      { sourceId: 'long', text: 'x'.repeat(100000), kind: 'fact' as const, knownByActorIds: ['a'] },
    ],
  };
  assert.throws(() => adapter.validateInput(large), { code: 'DIRECTOR_CONTEXT_LIMIT' });
  await assert.rejects(async () => adapter.decide(large), { code: 'DIRECTOR_CONTEXT_LIMIT' });
  assert.throws(() => adapter.validateInput({ ...f.snapshot, observedThroughVersion: 4 }), {
    code: 'INVALID_DIRECTOR_PROPOSAL',
  });
  assert.equal(calls, 0);
  assert.equal(large.observations[0]!.text.length, 100000);
});
test('structurally impossible complete candidate partition is rejected during preflight before spending', () => {
  const f = fixture();
  const crowded = {
    ...f.snapshot,
    candidates: Array.from({ length: 141 }, (_, i) => ({
      ...f.snapshot.candidates[0]!,
      id: 'c' + i,
    })),
  };
  let calls = 0;
  const adapter = new WorldDirectorAgentModel({
    async complete() {
      calls++;
      return JSON.stringify(f.quiet);
    },
  });
  assert.throws(() => adapter.validateInput(crowded));
  assert.throws(() =>
    adapter.validateInput({
      ...f.snapshot,
      candidates: [f.snapshot.candidates[0]!, f.snapshot.candidates[0]!],
    }),
  );
  const quietCapacity = { ...f.snapshot, candidates: crowded.candidates.slice(0, 128) };
  adapter.validateInput(quietCapacity);
  assert.equal(
    parseDirectorDecision(
      quietCapacity,
      {
        ...f.quiet,
        deferred: quietCapacity.candidates.map((c) => ({ candidateId: c.id, reason: 'quiet' })),
      },
      f.attempt,
    ).deferred.length,
    128,
  );
  assert.equal(calls, 0);
});

test('system protocol avoids copyable quiet verdicts without repairing malformed audit', async () => {
  const f = fixture();
  const empty = { ...f.snapshot, candidates: [] };
  let system = '';
  const response = JSON.stringify({ ...f.quiet, deferred: [], audit: {} });
  const adapter = new WorldDirectorAgentModel({
    async complete(messages) {
      system = messages[0]!.content;
      return response;
    },
  });
  assert.equal(await adapter.decide(empty), response, 'adapter preserves even invalid paid output');
  assert.throws(() => parseDirectorDecision(empty, response, f.attempt), {
    code: 'INVALID_DIRECTOR_PROPOSAL',
  });
  assert.doesNotMatch(system, /无候选且决定安静的格式例|本次具体暂缓依据|没有值得呈现的新变化/);
  const example = {
    protocol: 'director-wire-v8',
    authoredChoices: {},
    candidates: [],
    opportunities: [],
    audit: { reason: 'Synthetic explicit quiet judgment', sourceRefs: [] },
  };
  assert.equal('mode' in example, false);
  assert.equal(parseDirectorDecision(empty, example, f.attempt).mode, 'quiet');
  rejected(f, example); // An empty example cannot silently discard the real candidates.
  assert.match(system, /保持安静是合法判断/);
  assert.match(
    system,
    /顶层为protocol、openingContext、authoredChoices、candidates、opportunities、audit/,
  );
  assert.match(system, /保持安静时所有候选defer/);
  assert.match(system, /nativeTurn仍最多选一个候选/);
});

test('quiet audit remains mandatory and source-authorized regardless of candidate count', () => {
  const f = fixture();
  const empty = { ...f.snapshot, candidates: [] };
  const base = { ...f.quiet, deferred: [] };
  for (const audit of [
    undefined,
    {},
    { reason: '', basisSourceIds: [] },
    { reason: '  ', basisSourceIds: [] },
    { reason: 'quiet', basisSourceIds: ['invented-source'] },
    { reason: 'quiet', basisSourceIds: [], extra: 'not allowed' },
  ])
    assert.throws(() => parseDirectorDecision(empty, { ...base, audit }, f.attempt), {
      code: 'INVALID_DIRECTOR_PROPOSAL',
    });
  assert.equal(
    parseDirectorDecision(
      empty,
      { ...base, audit: { reason: 'No sufficient new basis', basisSourceIds: [] } },
      f.attempt,
    ).mode,
    'quiet',
  );
});

test('output reference catalogue keeps empty candidates separate from actors and eligible author events', async () => {
  const { createHash } = await import('node:crypto');
  const { compileAuthoredAgentMaterials } =
    await import('../src/modules/world/domain/authored-agent-material.ts');
  const f = fixture();
  f.snapshot.candidates = [];
  f.snapshot.authoredMaterials = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 5 },
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home', 'shop'],
      source: {
        origin: {
          workId: 'work',
          publicationVersion: 0,
          draftVersion: 0,
          contentHash: 'a'.repeat(64),
        },
        openingEventKey: 'opening_plan',
        timeline: null,
        conditions: [],
        actorKeys: ['ak'],
        contacts: [{ actorKey: 'ak', actorId: 'a' }],
        initialActorIds: ['a', 'b'],
        initialPlaceKeys: ['home'],
        places: [{ key: 'home', name: 'Home' }],
        history: [],
        nodes: ['opening_plan', 'blocked', 'occupied'].map((key) => ({
          key,
          kind: 'candidate',
          title: key,
          script: 'Unperformed authored intention',
          editorialIntent: 'Optional, not completed',
          actorKeys: ['ak'],
          prerequisites: [],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'director_event' },
        })),
      },
    },
    (text) => createHash('sha256').update(text).digest('hex'),
  );
  f.snapshot.authoredEligibility = f.snapshot.authoredMaterials.materials.map((m) => ({
    nodeKey: m.ref.nodeKey,
    nodeHash: m.ref.nodeHash,
    status: m.ref.nodeKey === 'blocked' ? 'blocked' : 'eligible',
    reasons: [],
    basisSourceIds: [],
    qualificationKey: 'b'.repeat(64),
  }));
  f.snapshot.occupiedAuthoredEventKeys = ['occupied'];
  let payload: any,
    system = '';
  const adapter = new WorldDirectorAgentModel({
    async complete(messages) {
      system = messages[0]!.content;
      payload = JSON.parse(messages[1]!.content);
      return '{}';
    },
  });
  await adapter.decide(f.snapshot);
  const catalog = payload.wireCatalog;
  assert.deepEqual(catalog.candidates, []);
  assert.deepEqual(
    catalog.actors.map((a: any) => a.actorId),
    ['a', 'b'],
  );
  assert.deepEqual(
    catalog.places.map((p: any) => p.placeId),
    ['home', 'shop'],
  );
  assert.equal(catalog.events.length, 1);
  const ref = catalog.events[0];
  assert.equal(ref.authoredEventKey, 'opening_plan');
  assert.match(ref.sourceId, /^authored:[a-f0-9]{64}$/);
  assert.match(system, /没有候选时candidates必须\[\]/);
  assert(system.includes('作者机会内不填id/origin/eventRef/actors/stagingIntents'));
  const decision = {
    ...f.bounded,
    deferred: [],
    opportunities: [
      { ...f.opportunity, authoredEventKey: ref.authoredEventKey, basisSourceIds: [ref.sourceId] },
    ],
  };
  assert.equal(f.parse(decision).mode, 'bounded_opportunity');
  rejected(f, { ...decision, selectedCandidateIds: ['a', 'b'] });
  rejected(f, { ...decision, deferred: [{ candidateId: 'a', reason: 'Not a candidate' }] });
  const { authoredEventKey: _key, ...missingKey } = decision.opportunities[0]!;
  rejected(f, { ...decision, opportunities: [missingKey] });
  rejected(f, {
    ...decision,
    opportunities: [{ ...decision.opportunities[0], authoredEventKey: 'a' }],
  });
});

test('output candidate index is copied from candidate IDs rather than actor identities', async () => {
  const f = fixture();
  let payload: any;
  await new WorldDirectorAgentModel({
    async complete(messages) {
      payload = JSON.parse(messages[1]!.content);
      return '{}';
    },
  }).decide(f.snapshot);
  assert.deepEqual(
    payload.wireCatalog.candidates.map((c: any) => c.candidateId),
    ['candidate-a', 'candidate-b'],
  );
  assert.deepEqual(payload.wireCatalog.events, []);
});

async function wireFixture(opening = false) {
  const f = fixture();
  const { compileAuthoredAgentMaterials } =
    await import('../src/modules/world/domain/authored-agent-material.ts');
  const { createHash } = await import('node:crypto');
  f.snapshot.candidates = [];
  f.snapshot.authoredMaterials = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 5 },
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home', 'shop'],
      source: {
        origin: {
          workId: 'work',
          publicationVersion: 0,
          draftVersion: 0,
          contentHash: 'a'.repeat(64),
        },
        timeline: null,
        ...(opening ? { openingEventKey: 'opening_plan' } : {}),
        conditions: [],
        actorKeys: ['ak'],
        contacts: [{ actorKey: 'ak', actorId: 'a' }],
        initialActorIds: ['a', 'b'],
        initialPlaceKeys: ['home'],
        places: [{ key: 'home', name: 'Home' }],
        history: [],
        nodes: [
          {
            key: 'opening_plan',
            kind: 'candidate',
            title: 'Opening',
            editorialIntent: 'Future optional opportunity',
            actorKeys: ['ak'],
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'director_event' },
          },
        ],
      },
    },
    (text) => createHash('sha256').update(text).digest('hex'),
  );
  f.snapshot.authoredEligibility = f.snapshot.authoredMaterials.materials.map((m) => ({
    nodeKey: m.ref.nodeKey,
    nodeHash: m.ref.nodeHash,
    status: 'eligible',
    reasons: [],
    basisSourceIds: [],
    qualificationKey: 'b'.repeat(64),
  }));
  f.snapshot.occupiedAuthoredEventKeys = [];
  const wire = {
    protocol: 'director-wire-v1',
    mode: 'bounded_opportunity',
    candidates: [],
    opportunities: [
      {
        id: 'opportunity',
        title: 'Discuss plans',
        description: 'An opportunity to consider independently',
        playerImpact: 'Player may decline',
        actors: ['actor:1'],
        places: [],
        activity: 'conversation',
        origin: { kind: 'authored', eventRef: 'event:1' },
      },
    ],
    audit: { reason: 'Current eligible opportunity', sourceRefs: ['event:1'] },
  };
  return { ...f, wire };
}

test('typed event reference binds key and source together while preserving canonical validation', async () => {
  const f = await wireFixture();
  const decision = f.parse(f.wire);
  assert.equal(decision.opportunities[0]!.authoredEventKey, 'opening_plan');
  assert.deepEqual(decision.opportunities[0]!.basisSourceIds, [
    'authored:' + f.snapshot.authoredMaterials!.materials[0]!.ref.nodeHash,
  ]);
  assert.deepEqual(decision.selectedCandidateIds, []); // Participants are not candidates or consent.
  const partial = f.parse({ ...f.wire, candidates: [{ ref: 'actor:1', decision: 'select' }] });
  assert.deepEqual(partial.selectedCandidateIds, []);
  assert.deepEqual(partial.nudges, []);
  assert.equal(partial.opportunities[0]!.authoredEventKey, 'opening_plan');
  assert.match(partial.audit.reason, /未执行的候选选择.*actor:1/);
  rejected(f, {
    ...f.wire,
    opportunities: [{ ...f.wire.opportunities[0], origin: { kind: 'authored' } }],
  });
  rejected(f, {
    ...f.wire,
    opportunities: [
      { ...f.wire.opportunities[0], origin: { kind: 'authored', eventRef: 'source:1' } },
    ],
  });
  rejected(f, { ...f.wire, protocol: 'director-wire-v999' });
  f.snapshot.authoredEligibility![0]!.status = 'blocked';
  rejected(f, f.wire);
  rejected(f, { ...f.wire, candidates: [{ ref: 'actor:1', decision: 'select' }] });
  f.snapshot.authoredEligibility![0]!.status = 'eligible';
  f.snapshot.occupiedAuthoredEventKeys = ['opening_plan'];
  rejected(f, f.wire);
});

test('wire candidate decisions have one identity and cannot leak authored sources through a nudge', () => {
  const f = fixture();
  const wire = {
    protocol: 'director-wire-v1',
    mode: 'coordinate',
    candidates: [
      { ref: 'candidate:1', decision: 'select', nudge: 'continue_own_plan' },
      { ref: 'candidate:2', decision: 'defer', reason: 'Still waiting' },
    ],
    opportunities: [],
    audit: { reason: 'Own plan is ready', sourceRefs: ['source:1'] },
  };
  const decision = f.parse(wire);
  assert.deepEqual(decision.selectedCandidateIds, ['candidate-a']);
  assert.deepEqual(decision.nudges, [
    {
      candidateId: 'candidate-a',
      actorId: 'a',
      kind: 'continue_own_plan',
      basisSourceIds: ['a-source'],
    },
  ]);
  rejected(f, { ...wire, candidates: [{ ref: 'actor:1', decision: 'select' }] });
  rejected(f, { ...wire, candidates: [wire.candidates[0]] }); // Every candidate must have a decision.
  rejected(f, { ...wire, mode: 'quiet' });
  const quiet = {
    ...wire,
    mode: 'quiet',
    candidates: [
      { ref: 'candidate:1', decision: 'defer', reason: 'Quiet' },
      { ref: 'candidate:2', decision: 'defer', reason: 'Quiet' },
    ],
  };
  assert.equal(f.parse(quiet).mode, 'quiet');
  f.snapshot.candidates[0]!.sourceIds = ['authored:forged'];
  rejected(f, wire); // Decoder does not grant authored material to NPCs.
});

test('Director strict response grammar binds each reference namespace to this immutable catalog', async () => {
  const f = await wireFixture();
  const { directorResponseFormat } =
    await import('../src/modules/world/infrastructure/director-model-protocol.ts');
  const format = directorResponseFormat(f.snapshot);
  assert.equal(format.format, 'json_schema');
  if (format.format !== 'json_schema') throw Error('wrong format');
  const root: any = format.schema;
  assert.equal(format.strict, true);
  assert.deepEqual(root.properties.protocol.enum, ['director-wire-v10']);
  assert.equal(root.properties.candidates.maxItems, 0);
  const opportunity = root.properties.opportunities.items.properties;
  assert.deepEqual(opportunity.places.items.enum, ['place:1', 'place:2']);
  assert.deepEqual(opportunity.actors.items.enum, ['actor:1', 'actor:2']);
  assert.equal(root.$defs.director_author_opportunity.properties.origin, undefined);
  assert.deepEqual(root.properties.authoredChoices.required, ['event:1']);
  assert.equal(opportunity.actorTopics.type, 'null');
  const walk = (schema: any) => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
    }
    for (const value of Object.values(schema))
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
  };
  walk(root);
  assert.ok(JSON.stringify(root).length < 24000);
});

test('v2 staging is explicit, participant-specific, bounded and still only a future proposal', async () => {
  const f = await wireFixture();
  const wire: any = structuredClone(f.wire);
  wire.protocol = 'director-wire-v2';
  rejected(f, wire);
  wire.opportunities[0].stagingIntents = [
    {
      actorRef: 'actor:1',
      kind: 'future_task',
      task: 'Consider asking the player about your own arrangement; do not assume consent.',
    },
  ];
  wire.opportunities[0].actorTopics = null;
  const decision = f.parse(wire);
  assert.deepEqual(decision.opportunities[0]!.stagingIntents, [
    { actorId: 'a', kind: 'future_task', task: wire.opportunities[0].stagingIntents[0].task },
  ]);
  assert.deepEqual(decision.selectedCandidateIds, []);
  const invalid = structuredClone(wire);
  invalid.opportunities[0].stagingIntents[0].actorRef = 'actor:2';
  rejected(f, invalid);
  invalid.opportunities[0].stagingIntents[0].actorRef = 'actor:1';
  invalid.opportunities[0].stagingIntents[0].kind = 'verified_fact';
  rejected(f, invalid);
  const malformedPlace = structuredClone(wire);
  malformedPlace.opportunities[0].places = ['place:42a1c6d995f1f5c7'];
  rejected(f, malformedPlace); // No hash alias salvage and no changed prior paid record.
  assert.equal(f.parse(f.wire).opportunities[0]!.stagingIntents, undefined); // Stored v1 replay remains canonical.
});

test('v3 opportunity IDs bind to attempt while paid v1/v2 IDs retain original meaning', async () => {
  const f = await wireFixture();
  const wire: any = structuredClone(f.wire);
  wire.opportunities[0].stagingIntents = [
    { actorRef: 'actor:1', kind: 'future_task', task: 'Consider your own plan.' },
  ];
  for (const protocol of ['director-wire-v1', 'director-wire-v2']) {
    wire.protocol = protocol;
    assert.equal(f.parse(wire).opportunities[0]!.id, 'opportunity');
  }
  wire.protocol = 'director-wire-v3';
  const first = f.parse(wire).opportunities[0]!.id;
  assert.match(first, /^director-opportunity:[a-f0-9]{64}$/);
  assert.equal(f.parse(wire).opportunities[0]!.id, first);
  assert.notEqual(
    parseDirectorDecision(f.snapshot, wire, { ...f.attempt, id: 'next-attempt' }).opportunities[0]!
      .id,
    first,
  );
  wire.opportunities.push(structuredClone(wire.opportunities[0]));
  rejected(f, wire); // Local IDs must still be unique within an attempt.
});

test('fresh bootstrap enforces eligible authored opening without forcing opportunity or blocking later improvisation', async () => {
  const f = await wireFixture(true);
  f.snapshot.evaluationCause = {
    kind: 'bootstrap',
    id: 'bootstrap',
    genesisHash: 'a'.repeat(32),
    admittedAtVersion: 5,
  };
  const wire: any = structuredClone(f.wire);
  wire.protocol = 'director-wire-v3';
  wire.opportunities[0].stagingIntents = [
    { actorRef: 'actor:1', kind: 'future_task', task: 'Consider your own opening involvement.' },
  ];
  assert.equal(f.parse(wire).opportunities[0]!.authoredEventKey, 'opening_plan');
  const { directorResponseFormat } =
    await import('../src/modules/world/infrastructure/director-model-protocol.ts');
  const format = directorResponseFormat(f.snapshot);
  if (format.format !== 'json_schema') throw Error('wrong format');
  assert.equal((format.schema as any).properties.opportunities.maxItems, 0);
  assert.deepEqual((format.schema as any).properties.authoredChoices.required, ['event:1']);
  const emergent = structuredClone(wire);
  emergent.opportunities[0].origin = { kind: 'emergent', sourceRefs: ['source:1'] };
  rejected(f, emergent);
  for (const mode of ['quiet', 'coordinate'])
    assert.equal(f.parse({ ...wire, mode, opportunities: [] }).mode, mode);
  emergent.protocol = 'director-wire-v2';
  assert.equal(f.parse(emergent).opportunities[0]!.id, 'opportunity'); // Do not reinterpret paid history.
  emergent.protocol = 'director-wire-v3';
  delete f.snapshot.evaluationCause;
  assert.equal(f.parse(emergent).opportunities[0]!.authoredEventKey, undefined);
});

test('v4 explicitly partitions eligible authored events and server-binds assessment evidence', async () => {
  const f = await wireFixture(true);
  const wire: any = structuredClone(f.wire);
  wire.protocol = 'director-wire-v4';
  wire.events = [
    {
      eventRef: 'event:1',
      decision: 'consider',
      reason: 'The authored opportunity is ready for independent consideration.',
    },
  ];
  wire.opportunities[0].stagingIntents = [
    { actorRef: 'actor:1', kind: 'future_task', task: 'Consider your own arrangement.' },
  ];
  const d = f.parse(wire);
  const q = f.snapshot.authoredEligibility![0]!;
  assert.deepEqual(d.authoredAssessments, [
    {
      nodeKey: q.nodeKey,
      nodeHash: q.nodeHash,
      qualificationKey: q.qualificationKey,
      decision: 'consider',
      reason: wire.events[0].reason,
    },
  ]);
  assert.match(d.opportunities[0]!.id, /^director-opportunity:[a-f0-9]{64}$/);
  for (const events of [
    undefined,
    [],
    [wire.events[0], wire.events[0]],
    [{ ...wire.events[0], eventRef: 'event:9' }],
  ])
    rejected(f, { ...wire, events });
  rejected(f, { ...wire, mode: 'quiet', opportunities: [] }); // consider needs a matching opportunity.
  rejected(f, { ...wire, events: [{ ...wire.events[0], decision: 'defer' }] });
  const deferred = {
    ...wire,
    mode: 'quiet',
    opportunities: [],
    events: [{ ...wire.events[0], decision: 'defer' }],
  };
  assert.equal(f.parse(deferred).authoredAssessments![0]!.decision, 'defer');
  const { validDirectorAuthoredAssessments } =
    await import('../src/modules/world/domain/director-runtime.ts');
  assert.equal(validDirectorAuthoredAssessments(f.snapshot, d), true);
  for (const field of ['nodeHash', 'qualificationKey', 'nodeKey'] as const)
    assert.equal(
      validDirectorAuthoredAssessments(f.snapshot, {
        ...d,
        authoredAssessments: [{ ...d.authoredAssessments![0]!, [field]: 'forged' }],
      }),
      false,
    );
  const { PostgresDirectorRuntimeRepository } =
    await import('../src/modules/world/infrastructure/director-runtime-repository.ts');
  const repository = Object.create(PostgresDirectorRuntimeRepository.prototype) as any;
  repository.validateDecision(f.snapshot, f.attempt, d);
  assert.throws(
    () => repository.validateDecision(f.snapshot, f.attempt, { ...d, authoredAssessments: [] }),
    { code: 'INVALID_DIRECTOR_AUTHORED_ASSESSMENTS' },
  );
  rejected(f, { ...f.quiet, authoredAssessments: [] }); // Canonical legacy input cannot inject v4 authority.
  for (const protocol of ['director-wire-v1', 'director-wire-v2', 'director-wire-v3']) {
    const old = { ...wire, protocol };
    delete old.events;
    assert.equal(f.parse(old).authoredAssessments, undefined);
    rejected(f, { ...old, events: [] });
  }
  f.snapshot.occupiedAuthoredEventKeys = ['opening_plan'];
  rejected(f, wire);
});

test('v4 has explicit empty assessments when there are no eligible events', async () => {
  const f = fixture();
  const wire = {
    protocol: 'director-wire-v4',
    mode: 'quiet',
    events: [],
    candidates: [
      { ref: 'candidate:1', decision: 'defer', reason: 'No present change.' },
      { ref: 'candidate:2', decision: 'defer', reason: 'No present change.' },
    ],
    opportunities: [],
    audit: { reason: 'Stay quiet.', sourceRefs: [] },
  };
  assert.deepEqual(f.parse(wire).authoredAssessments, []);
  const { directorResponseFormat } =
    await import('../src/modules/world/infrastructure/director-model-protocol.ts');
  const format = directorResponseFormat(f.snapshot);
  if (format.format !== 'json_schema') throw Error('wrong format');
  assert.deepEqual((format.schema as any).properties.authoredChoices.required, []);
  assert.equal((format.schema as any).properties.authoredChoices.additionalProperties, false);
});

test('wire actor names follow scoped IDs rather than independent cast order', async () => {
  const { directorWireCatalog } =
    await import('../src/modules/world/infrastructure/director-model-protocol.ts');
  const { snapshot } = fixture();
  snapshot.cast = [...snapshot.cast!].reverse();
  assert.deepEqual(directorWireCatalog(snapshot).actors, [
    { ref: 'actor:1', actorId: 'a', name: 'A' },
    { ref: 'actor:2', actorId: 'b', name: 'B' },
  ]);
  snapshot.cast = undefined;
  assert.deepEqual(directorWireCatalog(snapshot).actors, [
    { ref: 'actor:1', actorId: 'a' },
    { ref: 'actor:2', actorId: 'b' },
  ]);
});

test('director receives each authenticated actor dimension outside the truncatable world setting', async () => {
  const { snapshot, quiet } = fixture();
  snapshot.cast!.reverse();
  snapshot.actorDirectionMaterials = [
    {
      actorId: 'b',
      modules: {
        lifeContext: 'B_BACKGROUND',
        traits: 'B_TRAITS',
        drives: 'B_DRIVES',
        behavior: 'B_BEHAVIOR',
        relationships: 'B_RELATIONSHIPS',
      },
    },
    { actorId: 'a', modules: { traits: 'A_TRAITS' } },
  ];
  const sent: ModelMessage[][] = [];
  await new WorldDirectorAgentModel({
    async complete(messages) {
      sent.push(messages);
      return JSON.stringify(quiet);
    },
  }).decide(snapshot);
  const payload = JSON.parse(sent[0]![1]!.content);
  assert.deepEqual(payload.actorDirectionMaterials, snapshot.actorDirectionMaterials);
  assert.equal(payload.taskParticipants.assignments[0].performer.actorId, 'a');
  assert.equal(payload.taskParticipants.assignments[0].performer.name, 'A');
  assert.equal(payload.taskParticipants.assignments[1].performer.actorId, 'b');
});
