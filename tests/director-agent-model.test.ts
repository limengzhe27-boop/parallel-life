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
test('unconnected authoredEventKey is refused; only an actually offered authored candidate can reference its key', () => {
  const f = fixture(),
    raw = { ...f.bounded, opportunities: [{ ...f.opportunity, authoredEventKey: 'authored-key' }] };
  rejected(f, raw);
  f.snapshot.candidates.push({
    ...f.snapshot.candidates[0]!,
    id: 'authored-candidate',
    source: 'authored_event',
    episodeId: 'authored-key',
  });
  const linked = {
    ...raw,
    deferred: [...f.quiet.deferred, { candidateId: 'authored-candidate', reason: '待编排' }],
  };
  assert.equal(f.parse(linked).opportunities[0]!.authoredEventKey, 'authored-key');
  f.snapshot.candidates.at(-1)!.source = 'conversation';
  rejected(f, linked);
  // This synthetic parser test proves linkage only, not an integrated authored-event collector.
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
  assert.deepEqual(calls[0]!.output, { format: 'json_object' });
  assert.equal(calls[0]!.signal, controller.signal);
  const payload = JSON.parse(calls[0]!.messages[1]!.content);
  assert.equal(payload.promptVersion, DIRECTOR_RUNTIME_PROMPT_VERSION);
  assert.match(calls[0]!.messages[0]!.content, /quiet是正常决定/);
  assert.match(calls[0]!.messages[0]!.content, /全局audit只供导演审计/);
});
test('director request contains only authorized fictional fields; unexpected real profile/interview top-level data is omitted', async () => {
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
  await new WorldDirectorAgentModel(model).decide(snapshot);
  assert.doesNotMatch(
    JSON.stringify(sent),
    /REAL_PROFILE_SENTINEL|REAL_PRIVATE_INTERVIEW_SENTINEL/,
  );
  const payload = JSON.parse(sent[0]![1]!.content);
  assert.deepEqual(payload.cast, f.snapshot.cast);
  assert.equal(payload.worldSetting, f.snapshot.worldSetting);
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
      { sourceId: 'long', text: 'x'.repeat(65000), kind: 'fact' as const, knownByActorIds: ['a'] },
    ],
  };
  assert.throws(() => adapter.validateInput(large), { code: 'DIRECTOR_CONTEXT_LIMIT' });
  await assert.rejects(async () => adapter.decide(large), { code: 'DIRECTOR_CONTEXT_LIMIT' });
  assert.throws(() => adapter.validateInput({ ...f.snapshot, observedThroughVersion: 4 }), {
    code: 'INVALID_DIRECTOR_PROPOSAL',
  });
  assert.equal(calls, 0);
  assert.equal(large.observations[0]!.text.length, 65000);
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
