import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';
import { scheduleAgents } from '../src/modules/world/application/schedule-agents.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentActionResult,
  AgentResponsibility,
} from '../src/modules/world/domain/agent-runtime.ts';

const at = '2026-10-15T10:00:00.000Z',
  before = '2026-10-15T09:00:00.000Z';
type ActorRead = SchedulingView['actors'][number];
function actor(actorId = 'a'): ActorRead {
  const state = emptyActorAgentState({ worldId: 'w', actorId }, 'authored:fixture', 5);
  state.revision = 2;
  state.goals.push({
    id: 'g',
    summary: '本人的安排',
    status: 'active',
    sourceIds: ['s'],
    resultIds: [],
  });
  state.actions.push({
    id: 'action',
    goalId: 'g',
    capability: 'own.schedule',
    status: 'ready',
    sourceIds: ['s'],
    targetIds: [],
    parameters: { mode: 'normal' },
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
  });
  state.plans.push({
    id: 'plan',
    goalId: 'g',
    summary: '已明确的下一步',
    status: 'active',
    actionIds: ['action'],
    nextActionId: 'action',
    triggers: [],
    missingConditions: [],
    sourceIds: ['s'],
  });
  const snapshot: AgentSnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 5,
    storyAt: at,
    actor: {
      name: actorId,
      persona: '合成测试人物',
      boundaries: '',
      definitionRef: state.definitionRef,
    },
    sources: [
      { id: 's', kind: 'authored', recordId: 'fact', worldVersion: 0, at: before },
      { id: 'pos', kind: 'world_event', recordId: 'position-event', worldVersion: 1, at: before },
      { id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 5, at },
    ],
    observations: [{ sourceId: 's', kind: 'fact', text: '仅已授权的合成依据' }],
    channel: {
      kind: 'private',
      threadId: actorId,
      audienceActorIds: [actorId],
      allowedCapabilities: ['own.schedule'],
    },
    input: { sourceId: 'input', origin: 'wake', text: '' },
    worldContext: {
      time: { storyAt: at, timeZone: 'UTC+08:00', localDateTime: '2026-10-15T18:00:00' },
      boundary: {
        actorIds: [actorId],
        placeIds: ['home', 'shop'],
        capabilityIds: ['own.schedule'],
        extensionPermission: 'none',
      },
      selfPosition: { status: 'at', placeId: 'home', occurredAt: before, sourceId: 'pos' },
      knowledge: [],
    },
  };
  return { snapshot, trustedResults: [], appointments: [] };
}
function view(actors = [actor()]): SchedulingView {
  return {
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: at,
    actors,
    activeAttempts: [],
    consumedCandidateIds: [],
  };
}
function sync(a: ActorRead) {
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  return a;
}
function responsibility(a: ActorRead, change: Partial<AgentResponsibility> = {}) {
  a.snapshot.state.responsibilities.push({
    id: 'r',
    revision: 1,
    subject: { kind: 'request', id: 'request' },
    summary: '是否一起去',
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
    sourceIds: ['s'],
    ...change,
  });
  sync(a);
  return a.snapshot.state.responsibilities.at(-1)!;
}
async function collect(
  v: SchedulingView,
  source?: 'actor_plan' | 'responsibility' | 'observation',
) {
  const outputs = await Promise.all(
    createAgentScheduleSources(v)
      .filter((s) => !source || s.id.startsWith(source + ':'))
      .map((s) => s.source.collect('owner', v.worldId)),
  );
  return {
    candidates: outputs.flatMap((o) => o.candidates),
    blockers: outputs.flatMap((o) => o.blockers),
  };
}
function newlyObservedActor() {
  const a = actor();
  a.snapshot.state.projectedWorldVersion = 4;
  a.snapshot.state.goals = [];
  a.snapshot.state.plans = [];
  a.snapshot.state.actions = [];
  a.snapshot.sources.push({
    id: 'knowledge:event:player:left',
    kind: 'world_event',
    recordId: 'event',
    worldVersion: 5,
    at,
  });
  a.snapshot.observations.push({
    sourceId: 'knowledge:event:player:left',
    text: '你刚看见玩家离家，去向未知。',
    kind: 'fact',
  });
  a.snapshot.worldContext!.knowledge.push({
    sourceId: 'knowledge:event:player:left',
    subject: { kind: 'player' },
    kind: 'left',
    placeId: 'home',
    sourceKind: 'direct',
    occurredAt: before,
    learnedAt: at,
    possiblyStale: true,
  });
  return sync(a);
}
test('a newly visible observation wakes its actual observer without requiring a fabricated goal or contact relationship', async () => {
  const a = newlyObservedActor(),
    b = actor('b');
  b.snapshot.state.goals = [];
  b.snapshot.state.plans = [];
  b.snapshot.state.actions = [];
  sync(b);
  const outputs = await collect(view([a, b]), 'observation');
  assert.equal(outputs.candidates.length, 1);
  assert.equal(outputs.candidates[0]!.actorId, 'a');
  assert.equal(outputs.candidates[0]!.source, 'observation');
  assert.deepEqual(outputs.candidates[0]!.sourceIds, ['knowledge:event:player:left']);
  assert.equal(outputs.candidates[0]!.actionId, null);
  assert.match(outputs.candidates[0]!.reason, /允许保持安静/);
  assert.equal(
    JSON.stringify(outputs).includes('shop'),
    false,
    'observed departure does not grant a destination',
  );
});
test('observations already evaluated in an actual actor turn or consumed by a quiet wake do not repeat', async () => {
  const a = newlyObservedActor(),
    first = (await collect(view([a]), 'observation')).candidates[0]!;
  const consumed = view([a]);
  consumed.consumedCandidateIds = [first.id];
  assert.equal((await collect(consumed, 'observation')).candidates.length, 0);
  a.snapshot.state.projectedWorldVersion = 5;
  sync(a);
  assert.equal((await collect(view([a]), 'observation')).candidates.length, 0);
});
test('unknown, forgotten, future or private-strategy-only evidence cannot create an observation wake', async () => {
  for (const change of ['missing', 'future', 'private', 'not_visible'] as const) {
    const a = newlyObservedActor(),
      s = a.snapshot.sources.at(-1)!;
    if (change === 'missing') a.snapshot.sources.pop();
    if (change === 'future') s.worldVersion = 6;
    if (change === 'private') s.usage = 'private_strategy';
    if (change === 'not_visible') a.snapshot.observations.pop();
    assert.equal((await collect(view([a]), 'observation')).candidates.length, 0, change);
  }
});
function dependency(a: ActorRead, outcome: AgentActionResult['outcome'] = 'succeeded') {
  a.snapshot.state.actions.push({
    ...structuredClone(a.snapshot.state.actions[0]!),
    id: 'dependency',
    status: outcome,
    preconditions: [],
    resultId: 'result',
  });
  a.snapshot.state.actions[0]!.dependsOnActionIds = ['dependency'];
  sync(a);
  const result: AgentActionResult = {
    id: 'result',
    worldId: 'w',
    actorId: a.snapshot.state.actorId,
    actionId: 'dependency',
    eventId: 'result-event',
    worldVersion: 4,
    at: before,
    outcome,
    handledResponsibilityIds: [],
    evidenceSourceIds: ['s'],
  };
  return result;
}
test('ready next plan collects without writes, IO, model or dependence on source array order', async () => {
  const v = view(),
    original = structuredClone(v);
  const one = await collect(v),
    two = await collect(v);
  assert.equal(one.candidates.length, 1);
  assert.deepEqual(one, two);
  assert.deepEqual(v, original);
  assert.match(one.candidates[0]!.id, /^actor_plan:[a-f0-9]{64}$/);
  assert.equal(one.candidates[0]!.expectedWorldVersion, 5);
  assert.equal(one.candidates[0]!.expectedActorRevision, 2);
  assert.equal(one.candidates[0]!.actionId, 'action');
});
test('CAS/history/ambient time/source projection cursor changes do not invent a new semantic wake', async () => {
  const v = view(),
    old = (await collect(v)).candidates[0]!;
  const next = structuredClone(v),
    a = next.actors[0]!;
  next.worldVersion = 9;
  next.storyAt = '2026-10-15T10:30:00.000Z';
  a.snapshot.worldVersion = 9;
  a.snapshot.storyAt = next.storyAt;
  a.snapshot.worldContext!.time.storyAt = next.storyAt;
  a.snapshot.state.revision = 7;
  a.snapshot.state.projectedWorldVersion = 9;
  sync(a);
  a.snapshot.input.text = '无关的闲聊';
  a.snapshot.sources[0]!.at = next.storyAt;
  a.snapshot.sources[0]!.worldVersion = 9;
  a.snapshot.sources.push({
    id: 'unrelated',
    kind: 'private_message',
    recordId: 'new-message',
    worldVersion: 9,
    at: next.storyAt,
  });
  a.snapshot.observations.push({ sourceId: 'unrelated', kind: 'speech', text: '闲聊' });
  const current = (await collect(next)).candidates[0]!;
  assert.equal(current.id, old.id);
  assert.equal(current.expectedWorldVersion, 9);
  assert.equal(current.expectedActorRevision, 7);
  assert.equal((await collect({ ...next, consumedCandidateIds: [old.id] })).candidates.length, 0);
});
test('actual plan/action/capability parameter changes produce new IDs; actor/channel identities stay distinct', async () => {
  const v = view(),
    initial = (await collect(v)).candidates[0]!.id;
  for (const change of ['summary', 'parameter', 'channel'] as const) {
    const next = structuredClone(v),
      a = next.actors[0]!;
    if (change === 'summary') a.snapshot.state.plans[0]!.summary = '更改了实际计划';
    if (change === 'parameter') a.snapshot.state.actions[0]!.parameters.mode = 'different';
    if (change === 'channel') {
      a.snapshot.channel.kind = 'group';
      a.snapshot.channel.threadId = 'group-id';
    }
    sync(a);
    assert.notEqual((await collect(next)).candidates[0]!.id, initial);
  }
  assert.notEqual((await collect(view([actor('b')]))).candidates[0]!.id, initial);
});
test('empty waiting plan cannot wake a merely proposed/waiting action; explicit ready action can', async () => {
  for (const status of [
    'proposed',
    'waiting',
    'executing',
    'succeeded',
    'failed',
    'withdrawn',
    'blocked',
  ] as const) {
    const a = actor();
    a.snapshot.state.plans[0]!.status = 'waiting';
    a.snapshot.state.actions[0]!.status = status;
    sync(a);
    assert.equal((await collect(view([a]))).candidates.length, 0, status);
  }
  const a = actor();
  a.snapshot.state.plans[0]!.status = 'waiting';
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 1);
});
test('waiting action needs all actual conditions satisfied and a legal next action', async () => {
  const a = actor();
  a.snapshot.state.actions[0]!.status = 'waiting';
  a.snapshot.state.plans[0]!.triggers = [
    { kind: 'at_or_after', at: '2026-10-15T11:00:00.000Z', sourceId: 's' },
  ];
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 0);
  a.snapshot.state.plans[0]!.triggers[0] = { kind: 'at_or_after', at, sourceId: 's' };
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 1);
  a.snapshot.state.plans[0]!.nextActionId = null;
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 0);
});
test('blocked/terminal plans, goals, unavailable capability and invisible source are not resurrected', async () => {
  for (const change of ['plan', 'goal', 'capability', 'source', 'redacted'] as const) {
    const a = actor();
    if (change === 'plan') a.snapshot.state.plans[0]!.status = 'finished';
    if (change === 'goal') a.snapshot.state.goals[0]!.status = 'withdrawn';
    if (change === 'capability') a.snapshot.channel.allowedCapabilities = [];
    if (change === 'source') a.snapshot.sources = a.snapshot.sources.filter((s) => s.id !== 's');
    sync(a);
    if (change === 'redacted') {
      a.snapshot.viewState.plans = [];
      a.snapshot.redactedStateIds = ['plan'];
    }
    assert.equal((await collect(view([a]))).candidates.length, 0, change);
  }
});
test('only sourced own physical location satisfies at_place, never another person location or speech', async () => {
  const a = actor();
  a.snapshot.state.actions[0]!.preconditions = [{ kind: 'at_place', placeId: 'shop' }];
  sync(a);
  a.snapshot.observations.push({ sourceId: 'input', kind: 'speech', text: '我现在已经到商店了' });
  assert.equal((await collect(view([a]))).candidates.length, 0);
  a.snapshot.worldContext!.selfPosition = { status: 'unknown', placeId: null };
  assert.equal((await collect(view([a]))).candidates.length, 0);
  a.snapshot.worldContext!.selfPosition = {
    status: 'at',
    placeId: 'shop',
    sourceId: 'missing',
    occurredAt: before,
  };
  assert.equal((await collect(view([a]))).candidates.length, 0);
  a.snapshot.worldContext!.selfPosition.sourceId = 'pos';
  assert.equal((await collect(view([a]))).candidates.length, 1);
  a.snapshot.worldContext!.selfPosition.occurredAt = '2026-10-16T10:00:00.000Z';
  assert.equal((await collect(view([a]))).candidates.length, 0);
});
test('trusted result boundary is current world, not current+1; foreign/future/unsupported results stay quiet', async () => {
  const a = actor(),
    r = dependency(a);
  assert.equal((await collect(view([a]))).candidates.length, 0);
  for (const bad of [
    { ...r, worldVersion: 6 },
    { ...r, at: '2026-10-16T00:00:00.000Z' },
    { ...r, actorId: 'foreign' },
    { ...r, worldId: 'foreign' },
    { ...r, evidenceSourceIds: ['missing'] },
  ]) {
    a.trustedResults = [bad];
    assert.equal((await collect(view([a]))).candidates.length, 0);
  }
  a.trustedResults = [r];
  assert.equal((await collect(view([a]))).candidates.length, 1);
  a.trustedResults = [{ ...r, outcome: 'failed' }];
  assert.equal((await collect(view([a]))).candidates.length, 0);
});
test('new real dependency evidence changes semantic ID but unrelated receipts do not', async () => {
  const a = actor(),
    r = dependency(a);
  a.trustedResults = [r];
  const first = (await collect(view([a]))).candidates[0]!.id;
  a.trustedResults = [{ ...r, id: 'different-result', eventId: 'different-event' }];
  assert.notEqual((await collect(view([a]))).candidates[0]!.id, first);
  a.trustedResults = [r, { ...r, id: 'unrelated', actionId: 'not-visible-action' }];
  assert.equal((await collect(view([a]))).candidates[0]!.id, first);
});
test('one actual next action shared by two plans is collected once and honors all triggers', async () => {
  const a = actor();
  a.snapshot.state.plans.push({
    ...structuredClone(a.snapshot.state.plans[0]!),
    id: 'second-plan',
    triggers: [{ kind: 'at_or_after', at, sourceId: 's' }],
  });
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 1);
  a.snapshot.state.plans[1]!.triggers = [
    { kind: 'at_or_after', at: '2026-10-16T10:00:00.000Z', sourceId: 's' },
  ];
  sync(a);
  assert.equal((await collect(view([a]))).candidates.length, 0);
});
test('no responsibility condition, decision or known due appointment means quiet even far past ambient time', async () => {
  const a = actor();
  responsibility(a);
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
  const r = a.snapshot.state.responsibilities[0]!;
  r.deadline = { at: before, sourceId: 's' };
  a.snapshot.sources[0]!.deadlineAt = before;
  sync(a);
  const original = structuredClone(a);
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
  assert.deepEqual(a, original);
  assert.equal(r.status, 'waiting');
});
test('responsibility condition probe reuses shared interpreter without exposing internal goal/action', async () => {
  const a = actor();
  responsibility(a, { nextCheck: [{ kind: 'observation', sourceId: 's' }] });
  const original = structuredClone(a),
    result = await collect(view([a]), 'responsibility');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.actionId, null);
  assert.doesNotMatch(JSON.stringify(result), /__schedule_condition_probe__|__condition_probe__/);
  assert.deepEqual(a, original);
  a.snapshot.observations = [];
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
});
test('terminal/hidden/foreign-source responsibilities never create a probe candidate', async () => {
  for (const status of ['fulfilled', 'withdrawn', 'expired'] as const) {
    const a = actor();
    responsibility(a, { status, nextCheck: [{ kind: 'observation', sourceId: 's' }] });
    assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
  }
  const a = actor();
  responsibility(a, { nextCheck: [{ kind: 'observation', sourceId: 's' }] });
  a.snapshot.viewState.responsibilities = [];
  a.snapshot.redactedStateIds = ['r'];
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
});
test('latest decision for the current request revision can wake own reconsideration; old acceptance cannot authorize action', async () => {
  const a = actor();
  responsibility(a);
  a.snapshot.sources.push({
    id: 'decline',
    kind: 'accepted_input',
    recordId: 'decline-input',
    worldVersion: 5,
    at,
  });
  a.snapshot.state.decisions = [
    {
      id: 'yes',
      responsibilityId: 'r',
      responsibilityRevision: 1,
      kind: 'accepted',
      sourceId: 'input',
      quote: '去',
    },
    {
      id: 'no',
      responsibilityId: 'r',
      responsibilityRevision: 1,
      kind: 'declined',
      sourceId: 'decline',
      quote: '不去',
    },
  ];
  a.snapshot.state.actions[0]!.preconditions = [
    { kind: 'player_decision', responsibilityId: 'r', decision: 'accepted' },
  ];
  sync(a);
  assert.equal((await collect(view([a]), 'actor_plan')).candidates.length, 0);
  const candidate = (await collect(view([a]), 'responsibility')).candidates[0]!;
  assert.ok(candidate.sourceIds.includes('decline'));
  assert.ok(!candidate.sourceIds.includes('input'));
  assert.equal(
    (await collect({ ...view([a]), consumedCandidateIds: [candidate.id] }, 'responsibility'))
      .candidates.length,
    0,
  );
  a.snapshot.state.responsibilities[0]!.revision = 2;
  sync(a);
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
});
test('related decision source changes ID; unrelated conversation and actor CAS do not', async () => {
  const a = actor();
  responsibility(a);
  a.snapshot.state.decisions.push({
    id: 'no',
    responsibilityId: 'r',
    responsibilityRevision: 1,
    kind: 'declined',
    sourceId: 'input',
    quote: '不去',
  });
  sync(a);
  const first = (await collect(view([a]), 'responsibility')).candidates[0]!.id;
  a.snapshot.state.revision++;
  sync(a);
  a.snapshot.input.text = '闲聊';
  assert.equal((await collect(view([a]), 'responsibility')).candidates[0]!.id, first);
  a.snapshot.sources.push({
    id: 'new-player-decision',
    kind: 'accepted_input',
    recordId: 'new-input',
    worldVersion: 5,
    at,
  });
  a.snapshot.state.decisions.push({
    id: 'maybe',
    responsibilityId: 'r',
    responsibilityRevision: 1,
    kind: 'negotiating',
    sourceId: 'new-player-decision',
    quote: '晚一点',
  });
  sync(a);
  assert.notEqual((await collect(view([a]), 'responsibility')).candidates[0]!.id, first);
});
test('known due appointment triggers only own re-evaluation, never expiry, attendance or player consent', async () => {
  const a = actor();
  responsibility(a, { subject: { kind: 'appointment', id: 'appointment' } });
  a.appointments = [
    {
      id: 'appointment',
      title: '已知邀约',
      at,
      participantIds: ['a'],
      status: 'proposed',
      sourceEventId: 'appointment-event',
    },
  ];
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
  a.snapshot.sources.push({
    id: 'appointment:appointment',
    kind: 'world_event',
    recordId: 'appointment-event',
    worldVersion: 4,
    at: before,
  });
  const original = structuredClone(a),
    one = (await collect(view([a]), 'responsibility')).candidates[0]!;
  assert.equal(one.actionId, null);
  assert.deepEqual(a, original);
  assert.equal(a.appointments[0]!.status, 'proposed');
  assert.match(one.reason, /不推定/);
  assert.equal(a.snapshot.state.responsibilities[0]!.status, 'waiting');
  a.appointments = [{ ...a.appointments[0]!, at: '2026-10-15T11:00:00.000Z' }];
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
});
test('cancelled/foreign/future-response/unknown-source appointments cannot trigger wake', async () => {
  for (const change of ['cancelled', 'participant', 'future', 'record'] as const) {
    const a = actor();
    responsibility(a, { subject: { kind: 'appointment', id: 'appointment' } });
    a.appointments = [
      {
        id: 'appointment',
        title: '已知邀约',
        at,
        participantIds: ['a'],
        status: 'confirmed',
        sourceEventId: 'event',
      },
    ];
    a.snapshot.sources.push({
      id: 'appointment:appointment',
      kind: 'world_event',
      recordId: 'event',
      worldVersion: 4,
      at: before,
    });
    if (change === 'cancelled') a.appointments[0]!.status = 'cancelled';
    if (change === 'participant') a.appointments[0]!.participantIds = ['b'];
    if (change === 'future') a.appointments[0]!.responseVersion = 6;
    if (change === 'record') a.appointments[0]!.sourceEventId = 'not-the-known-event';
    assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0, change);
  }
});
test('strict source/time boundaries reject rolled calendar dates and future evidence', async () => {
  for (const when of ['2026-02-30T10:00:00.000Z', '2026-10-15T24:00:00.000Z']) {
    const a = actor();
    a.snapshot.state.actions[0]!.preconditions = [{ kind: 'at_or_after', at: when, sourceId: 's' }];
    sync(a);
    assert.equal((await collect(view([a]))).candidates.length, 0);
    assert.throws(() => createAgentScheduleSources({ ...view(), storyAt: when }), {
      code: 'INVALID_COMMAND',
    });
  }
  const a = actor();
  a.snapshot.sources[0]!.at = '2026-10-16T00:00:00.000Z';
  assert.equal((await collect(view([a]))).candidates.length, 0);
  a.snapshot.sources[0]!.at = before;
  a.snapshot.sources[0]!.worldVersion = 6;
  assert.equal((await collect(view([a]))).candidates.length, 0);
});
test('factory captures detached immutable view and never returns internal mutable references', async () => {
  const v = view(),
    sources = createAgentScheduleSources(v);
  v.actors[0]!.snapshot.state.plans[0]!.status = 'withdrawn';
  const one = await sources[0]!.source.collect('owner', 'w');
  assert.equal(one.candidates.length, 1);
  one.candidates[0]!.reason = 'caller modified';
  const two = await sources[0]!.source.collect('owner', 'w');
  assert.notEqual(two.candidates[0]!.reason, 'caller modified');
  await assert.rejects(sources[0]!.source.collect('owner', 'foreign'), { code: 'INVALID_COMMAND' });
});
test('scheduler selects another actor when one is unknown, without calling a model or retrying unknown', async () => {
  const v = {
    ...view([actor('a'), actor('b')]),
    activeAttempts: [{ actorId: 'a', id: 'uncertain', status: 'unknown_after_send' as const }],
  };
  const result = await scheduleAgents(
    {
      sources: createAgentScheduleSources(v),
      director: {
        async coordinate() {
          throw Error('No coordination needed');
        },
      },
    },
    {
      ownerId: 'owner',
      worldId: 'w',
      engineEpoch: 2,
      worldVersion: 5,
      storyAt: at,
      actorRevisions: { a: 2, b: 2 },
      observations: [],
    },
  );
  assert.equal(result.selected[0]!.candidate.actorId, 'b');
  assert.equal(result.blocked[0]!.candidate.actorId, 'a');
  assert.equal(result.snapshot.blockers[0]!.scope.kind, 'actor');
  assert.equal(result.snapshot.blockers[0]!.reason, 'unknown_attempt');
});
test('active owned attempt blocks only its actor; terminal attempts and absent actor do not block others', async () => {
  for (const status of ['reserved', 'request_sent', 'response_received'] as const) {
    const result = await collect({
      ...view([actor('a'), actor('b')]),
      activeAttempts: [{ actorId: 'a', id: 'active', status }],
    });
    assert.equal(result.blockers.length, 1);
    assert.deepEqual(result.blockers[0]!.scope, { kind: 'actor', actorId: 'a' });
  }
  const result = await collect({
    ...view(),
    activeAttempts: [
      { actorId: 'not-in-current-view', id: 'uncertain', status: 'unknown_after_send' },
    ],
  });
  assert.equal(result.blockers.length, 0);
  assert.equal(result.candidates.length, 1);
});
test('stale one-actor projection is a scoped source failure; other actors continue', async () => {
  const a = actor('a'),
    b = actor('b');
  a.snapshot.worldVersion = 4;
  const v = view([a, b]);
  const result = await scheduleAgents(
    {
      sources: createAgentScheduleSources(v),
      director: {
        async coordinate() {
          throw Error('No model');
        },
      },
    },
    {
      ownerId: 'owner',
      worldId: 'w',
      engineEpoch: 2,
      worldVersion: 5,
      storyAt: at,
      actorRevisions: { a: 2, b: 2 },
      observations: [],
    },
  );
  assert.equal(result.selected[0]!.candidate.actorId, 'b');
  assert.equal(result.sourceFailures.length, 2);
  assert.ok(
    result.sourceFailures.every((f) => f.scope.kind === 'actor' && f.scope.actorId === 'a'),
  );
});
test('no candidates is honest quiet with no director call or legacy agenda fallback', async () => {
  const a = actor();
  a.snapshot.state.plans = [];
  sync(a);
  const v = view([a]);
  const result = await scheduleAgents(
    {
      sources: createAgentScheduleSources(v),
      director: {
        async coordinate() {
          throw Error('Must stay quiet');
        },
      },
    },
    {
      ownerId: 'owner',
      worldId: 'w',
      engineEpoch: 2,
      worldVersion: 5,
      storyAt: at,
      actorRevisions: { a: 2 },
      observations: [],
    },
  );
  assert.equal(result.status, 'quiet');
  assert.equal(result.reason, 'no_candidates');
});

test('condition/source set ordering does not create a new wake but actual responsibility revision does', async () => {
  const a = actor();
  a.snapshot.state.actions[0]!.preconditions = [
    { kind: 'observation', sourceId: 's' },
    { kind: 'at_or_after', at: before, sourceId: 'pos' },
  ];
  a.snapshot.state.actions[0]!.sourceIds = ['s', 'pos'];
  sync(a);
  const first = (await collect(view([a]), 'actor_plan')).candidates[0]!.id;
  a.snapshot.state.actions[0]!.preconditions.reverse();
  a.snapshot.state.actions[0]!.sourceIds.reverse();
  sync(a);
  assert.equal((await collect(view([a]), 'actor_plan')).candidates[0]!.id, first);
  responsibility(a, { nextCheck: [{ kind: 'observation', sourceId: 's' }] });
  const prior = (await collect(view([a]), 'responsibility')).candidates[0]!.id;
  a.snapshot.state.responsibilities[0]!.revision = 2;
  sync(a);
  assert.notEqual((await collect(view([a]), 'responsibility')).candidates[0]!.id, prior);
});
test('actual completed action receipt prevents rerunning a stale ready action', async () => {
  const a = actor();
  a.trustedResults = [
    {
      id: 'committed-result',
      worldId: 'w',
      actorId: 'a',
      actionId: 'action',
      eventId: 'committed-event',
      worldVersion: 5,
      at,
      outcome: 'succeeded',
      handledResponsibilityIds: [],
      evidenceSourceIds: ['s'],
    },
  ];
  assert.equal((await collect(view([a]), 'actor_plan')).candidates.length, 0);
});
test('a failed result can satisfy an explicit failure reconsideration, without declaring goal completion', async () => {
  const a = actor(),
    failed = dependency(a, 'failed');
  a.trustedResults = [failed];
  responsibility(a, { nextCheck: [{ kind: 'result', actionId: 'dependency', outcome: 'failed' }] });
  const out = await collect(view([a]), 'responsibility');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0]!.actionId, null);
  assert.equal(a.snapshot.state.goals[0]!.status, 'active');
});
test('future player decision evidence and unproved deadlines do not silently become current authority', async () => {
  const a = actor();
  responsibility(a);
  a.snapshot.state.decisions.push({
    id: 'future',
    responsibilityId: 'r',
    responsibilityRevision: 1,
    kind: 'accepted',
    sourceId: 'input',
    quote: '去',
  });
  a.snapshot.sources.find((s) => s.id === 'input')!.worldVersion = 6;
  sync(a);
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
  a.snapshot.sources.find((s) => s.id === 'input')!.worldVersion = 5;
  a.snapshot.state.responsibilities[0]!.deadline = { at: before, sourceId: 's' };
  sync(a);
  assert.equal((await collect(view([a]), 'responsibility')).candidates.length, 0);
});
test('world/source clock and actor view disagreement fails scoped collection rather than using stale facts', async () => {
  for (const mismatch of ['clock', 'actor-view', 'source-id'] as const) {
    const a = actor();
    if (mismatch === 'clock') a.snapshot.worldContext!.time.storyAt = before;
    if (mismatch === 'actor-view') a.snapshot.viewState.plans[0]!.summary = '伪改计划';
    if (mismatch === 'source-id')
      a.snapshot.sources.push({ ...a.snapshot.sources[0]!, recordId: 'ambiguous' });
    await assert.rejects(collect(view([a])), { code: 'INVALID_COMMAND' });
  }
});

test('actual invitation answers wake only their actor with stable receipt identity, including refusal before appointment time', async () => {
  for (const kind of ['invitation_accepted', 'invitation_declined'] as const) {
    const a = actor();
    a.snapshot.sources.push({
      id: 'appointment:offer',
      kind: 'world_event',
      recordId: 'offer-event',
      worldVersion: 3,
      at,
    });
    a.snapshot.episodeResults = [
      {
        evidenceId: 'proof',
        episodeId: 'episode',
        actorId: 'a',
        kind,
        subject: { kind: 'appointment', id: 'offer' },
        sourceEventId: 'response-event',
        worldVersion: 4,
        occurredAt: before,
        overallOutcome: 'not_certified',
      },
    ];
    const v = view([a]);
    const first = (await collect(v, 'observation')).candidates[0]!;
    assert.ok(first.id.startsWith('episode-answer:'));
    assert.equal(first.actorId, 'a');
    assert.equal(first.actionId, null);
    v.worldVersion++;
    v.storyAt = '2026-10-15T11:00:00.000Z';
    a.snapshot.worldVersion = v.worldVersion;
    a.snapshot.storyAt = v.storyAt;
    a.snapshot.worldContext!.time.storyAt = v.storyAt;
    a.snapshot.sources.at(-1)!.at = v.storyAt;
    assert.equal((await collect(v, 'observation')).candidates[0]!.id, first.id);
    v.consumedCandidateIds = [first.id];
    assert.equal((await collect(v, 'observation')).candidates.length, 0);
    v.consumedCandidateIds = [];
    a.snapshot.episodeResults[0]!.actorId = 'other';
    assert.equal((await collect(v, 'observation')).candidates.length, 0);
  }
});

test('ordinary actionless plan reviews with a durable trigger and also without one', async () => {
  const a = actor();
  a.snapshot.state.actions = [];
  const p = a.snapshot.state.plans[0]!;
  p.actionIds = [];
  p.nextActionId = null;
  p.triggers = [{ kind: 'observation', sourceId: 's' }];
  sync(a);
  const v = view([a]);
  const first = await collect(v, 'actor_plan');
  assert.equal(first.candidates.length, 1);
  const c = first.candidates[0]!;
  assert.equal(c.actionId, null);
  assert.equal(c.episodeId, null);
  const changed = structuredClone(v);
  changed.worldVersion = 6;
  changed.storyAt = '2026-10-15T11:00:00.000Z';
  const s = changed.actors[0]!.snapshot;
  s.worldVersion = 6;
  s.storyAt = changed.storyAt;
  s.state.revision++;
  s.state.projectedWorldVersion = 6;
  s.state.plans[0]!.summary = 'Different wording, same condition';
  s.state.goals[0]!.summary = 'Different goal wording';
  s.worldContext = undefined;
  s.viewState = structuredClone(s.state);
  assert.equal((await collect(changed, 'actor_plan')).candidates[0]!.id, c.id);
  changed.consumedCandidateIds = [c.id];
  assert.equal((await collect(changed, 'actor_plan')).candidates.length, 0);
  for (const mode of ['empty', 'unobserved', 'hidden', 'waiting'] as const) {
    const next = structuredClone(v);
    const snap = next.actors[0]!.snapshot;
    if (mode === 'empty') snap.state.plans[0]!.triggers = [];
    if (mode === 'unobserved') snap.observations = [];
    if (mode === 'hidden') snap.redactedStateIds = ['plan'];
    if (mode === 'waiting')
      snap.state.plans[0]!.triggers = [
        { kind: 'at_or_after', at: '2026-10-16T10:00:00.000Z', sourceId: 's' },
      ];
    snap.viewState = structuredClone(snap.state);
    assert.equal(
      (await collect(next, 'actor_plan')).candidates.length,
      mode === 'empty' ? 1 : 0,
      mode,
    );
  }
});

test('a real terminal next action wakes one plan review without completing the goal or repeating the result', async () => {
  for (const outcome of ['succeeded', 'failed'] as const) {
    const a = actor();
    const result = dependency(a, outcome);
    a.snapshot.state.plans[0]!.actionIds = ['dependency'];
    a.snapshot.state.plans[0]!.nextActionId = 'dependency';
    // The completed action's old execution location no longer gates reflection.
    a.snapshot.state.plans[0]!.triggers = [{ kind: 'at_place', placeId: 'shop' }];
    a.trustedResults = [result];
    sync(a);
    const v = view([a]);
    const candidates = (await collect(v, 'actor_plan')).candidates;
    const c = candidates.find((c) => c.actionId === null);
    assert.ok(c);
    assert.deepEqual(c.planReview, {
      planId: a.snapshot.state.plans[0]!.id,
      goalId: a.snapshot.state.plans[0]!.goalId,
      result,
    });
    assert.equal(a.snapshot.state.goals[0]!.status, 'active');
    v.consumedCandidateIds = [c.id];
    assert.equal(
      (await collect(v, 'actor_plan')).candidates.filter((c) => c.actionId === null).length,
      0,
    );
    v.consumedCandidateIds = [];
    a.trustedResults = []; // A terminal label alone is not execution proof.
    assert.equal(
      (await collect(v, 'actor_plan')).candidates.filter((c) => c.actionId === null).length,
      0,
    );
  }
});

test('a successful result already waiting on its own output does not purchase a repeated confirmation', async () => {
  const a = actor();
  const result = dependency(a, 'succeeded');
  result.outputRefs = [{ kind: 'appointment', id: 'meeting' }];
  a.snapshot.state.plans[0]!.actionIds = ['dependency'];
  a.snapshot.state.plans[0]!.nextActionId = 'dependency';
  a.snapshot.state.responsibilities.push({
    id: 'waiting',
    subject: { kind: 'appointment', id: 'meeting' },
    summary: 'Await an invitation response',
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
    sourceIds: ['s'],
  });
  a.trustedResults = [result];
  sync(a);
  const reviews = async () =>
    (await collect(view([a]), 'actor_plan')).candidates.filter((c) => c.actionId === null);
  assert.equal((await reviews()).length, 0);
  a.snapshot.state.responsibilities[0]!.subject.id = 'different-meeting';
  sync(a);
  assert.equal((await reviews()).length, 1, 'unrelated waiting cannot suppress this result');
  a.snapshot.state.responsibilities[0]!.subject.id = 'meeting';
  a.snapshot.state.responsibilities[0]!.waitingOn = 'self';
  sync(a);
  assert.equal((await reviews()).length, 1, 'a changed responsibility can resume planning');
});

test('successful media enqueue uses media completion lifecycle, failed execution can reconsider', async () => {
  for (const outcome of ['succeeded', 'failed'] as const) {
    const a = actor();
    const result = dependency(a, outcome);
    a.snapshot.state.actions.find((x) => x.id === 'dependency')!.capability =
      'media.generate_image';
    result.outputRefs = [{ kind: 'media', id: 'existing-image-request' }];
    a.snapshot.state.plans[0]!.actionIds = ['dependency'];
    a.snapshot.state.plans[0]!.nextActionId = 'dependency';
    a.trustedResults = [result];
    sync(a);
    const reviews = (await collect(view([a]), 'actor_plan')).candidates.filter(
      (x) => x.actionId === null,
    );
    assert.equal(reviews.length, outcome === 'succeeded' ? 0 : 1);
    assert.equal(a.snapshot.state.goals[0]!.status, 'active');
  }
});
