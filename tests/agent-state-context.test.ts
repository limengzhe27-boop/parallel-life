import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStateContextPayload } from '../src/modules/world/application/agent-state-context.ts';
import {
  emptyActorAgentState,
  type ActorAgentState,
  type AgentCondition,
} from '../src/modules/world/domain/agent-runtime.ts';
import { NpcAgentModel } from '../src/modules/world/infrastructure/npc-agent-model.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
const at = '2026-10-15T08:00:00.000Z';
function fixture(): ActorAgentState {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 9);
  state.revision = 3;
  state.knowledgeSourceIds = ['public', 'private'];
  state.memoryIds = ['memory'];
  state.relationshipIds = ['relationship'];
  const conditions: AgentCondition[] = [
    { kind: 'at_or_after', at, sourceId: 'public' },
    { kind: 'result', actionId: 'action', outcome: 'succeeded' },
    { kind: 'player_decision', responsibilityId: 'request', decision: 'declined' },
    { kind: 'at_place', placeId: 'shop' },
    { kind: 'observation', sourceId: 'public' },
  ];
  state.goals = [
    {
      id: 'goal',
      summary: '已有执行目标',
      status: 'fulfilled',
      sourceIds: ['public'],
      resultIds: ['result'],
      endReason: '真实结果已保存',
    },
  ];
  state.plans = [
    {
      id: 'plan',
      goalId: 'goal',
      summary: '旧计划仍有历史',
      status: 'finished',
      sourceIds: ['public'],
      actionIds: ['action'],
      nextActionId: 'action',
      triggers: conditions,
      missingConditions: ['missing'],
      supersedesPlanId: 'old-plan',
    },
  ];
  state.actions = [
    {
      id: 'action',
      goalId: 'goal',
      capability: 'future.unregistered',
      targetIds: ['target'],
      parameters: { text: '原样参数', number: 2, bool: true, empty: null, array: ['one', 'two'] },
      preconditions: structuredClone(conditions),
      dependsOnActionIds: ['old-action'],
      handlesResponsibilityIds: ['request'],
      sourceIds: ['public'],
      status: 'succeeded',
      resultId: 'result',
    },
  ];
  state.responsibilities = [
    {
      id: 'request',
      revision: 0,
      subject: { kind: 'appointment', id: 'appointment' },
      summary: '已处理的旧责任',
      status: 'fulfilled',
      waitingOn: null,
      sourceIds: ['public'],
      nextCheck: structuredClone(conditions),
      deadline: { at, sourceId: 'public' },
      resolutionResultId: 'result',
      endReason: '真实执行',
    },
    {
      id: 'no-revision',
      subject: { kind: 'request', id: 'request2' },
      summary: '尚待回应',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['public'],
      nextCheck: [],
    },
  ];
  state.decisions = [
    {
      id: 'decision',
      responsibilityId: 'request',
      responsibilityRevision: 0,
      kind: 'declined',
      sourceId: 'private',
      quote: 'PRIVATE_QUOTE',
    },
    {
      id: 'public-decision',
      responsibilityId: 'no-revision',
      kind: 'undecided',
      sourceId: 'public',
      quote: '还没决定',
    },
  ];
  state.focus = {
    channel: 'private',
    threadId: 'actor',
    subjectId: 'appointment',
    questionSourceId: 'public',
    replyToActorId: null,
  };
  return state;
}
function snapshot(state: ActorAgentState): AgentSnapshot {
  return {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 9,
    storyAt: at,
    actor: {
      name: 'NPC',
      persona: '虚构人物',
      boundaries: '仅已知事实',
      definitionRef: state.definitionRef,
    },
    sources: [
      { id: 'public', kind: 'private_message', recordId: 'public-record', worldVersion: 9, at },
      {
        id: 'private',
        kind: 'world_event',
        recordId: 'private-record',
        usage: 'private_strategy',
        worldVersion: 8,
        at,
      },
    ],
    observations: [
      { sourceId: 'public', text: '原话', kind: 'speech' },
      { sourceId: 'private', text: '本人的私有计划', kind: 'plan' },
    ],
    channel: {
      kind: 'private',
      threadId: 'actor',
      audienceActorIds: ['actor'],
      allowedCapabilities: [],
    },
    input: { sourceId: 'public', text: '还没决定', origin: 'player' },
  };
}
test('default NPC shape equals the actual existing adapter serialization and keeps execution state', async () => {
  const state = fixture();
  let captured: ModelMessage[] = [];
  const model = new NpcAgentModel({
    async complete(messages) {
      captured = messages;
      return '{}';
    },
  });
  await model.decide(snapshot(state));
  const actual = JSON.parse(captured.find((m) => m.role === 'user')!.content).state;
  const payload = actorStateContextPayload(state, {
    privateStrategySourceIds: new Set(['private']),
  });
  assert.deepEqual(payload, actual);
  assert.equal(payload.actions[0]?.status, 'succeeded');
  assert.equal(payload.actions[0]?.resultId, 'result');
  assert.equal(payload.actions[0]?.capability, 'future.unregistered');
  assert.deepEqual(payload.goals[0]?.resultIds, ['result']);
  assert.equal(Object.hasOwn(payload.responsibilities[0]!, 'revision'), false);
  assert.equal(Object.hasOwn(payload.decisions[0]!, 'responsibilityRevision'), false);
});
test('root and every nested standard object strip privateProfile/interview extra properties', () => {
  const state = fixture();
  const secret = 'UNAUTHORIZED_EXTRA_SECRET';
  let reads = 0;
  const inject = (value: object) => {
    Object.assign(value, { privateProfile: { text: secret }, interview: secret });
    Object.defineProperty(value, 'unknownPrivateGetter', {
      enumerable: true,
      get() {
        reads++;
        throw Error(secret);
      },
    });
  };
  inject(state);
  for (const g of state.goals) inject(g);
  for (const p of state.plans) {
    inject(p);
    for (const c of p.triggers) inject(c);
  }
  for (const a of state.actions) {
    inject(a);
    for (const c of a.preconditions) inject(c);
  }
  for (const r of state.responsibilities) {
    inject(r);
    inject(r.subject);
    if (r.deadline) inject(r.deadline);
    for (const c of r.nextCheck) inject(c);
  }
  for (const d of state.decisions) inject(d);
  inject(state.focus!);
  inject(state.knowledgeSourceIds);
  const payload = actorStateContextPayload(state, { includeRequestRevisions: true });
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(reads, 0);
  assert.equal(Object.hasOwn(payload, 'privateProfile'), false);
  assert.equal(payload.plans[0]?.triggers.length, 5);
  assert.equal(payload.actions[0]?.preconditions.length, 5);
});
test('private-strategy quote alone is withheld, source IDs/history remain and original state is untouched', () => {
  const state = fixture(),
    before = structuredClone(state),
    ids = new Set(['private']);
  const payload = actorStateContextPayload(state, { privateStrategySourceIds: ids });
  assert.equal(payload.decisions[0]?.quote, '');
  assert.equal(payload.decisions[0]?.sourceId, 'private');
  assert.equal(payload.decisions[1]?.quote, '还没决定');
  assert.deepEqual(state, before);
  assert.deepEqual([...ids], ['private']);
  assert.equal(actorStateContextPayload(state).decisions[0]?.quote, 'PRIVATE_QUOTE');
});
test('director preserves request revision zero/current history without inventing missing revisions', () => {
  const state = fixture(),
    payload = actorStateContextPayload(state, { includeRequestRevisions: true });
  assert.equal(payload.responsibilities[0]?.revision, 0);
  assert.equal(payload.decisions[0]?.responsibilityRevision, 0);
  assert.equal(Object.hasOwn(payload.responsibilities[1]!, 'revision'), false);
  assert.equal(Object.hasOwn(payload.decisions[1]!, 'responsibilityRevision'), false);
  assert.deepEqual(payload, state);
  state.responsibilities[0]!.revision = 7;
  state.decisions[0]!.responsibilityRevision = 6;
  const current = actorStateContextPayload(state, { includeRequestRevisions: true });
  assert.equal(current.responsibilities[0]?.revision, 7);
  assert.equal(current.decisions[0]?.responsibilityRevision, 6);
});
test('all arrays and nested objects detach; modifying payload never changes source state', () => {
  const state = fixture(),
    before = structuredClone(state),
    p = actorStateContextPayload(state, { includeRequestRevisions: true });
  p.knowledgeSourceIds.push('x');
  p.memoryIds.push('x');
  p.relationshipIds.push('x');
  p.goals[0]!.sourceIds.push('x');
  p.goals[0]!.resultIds.push('x');
  p.plans[0]!.actionIds.push('x');
  p.plans[0]!.missingConditions.push('x');
  p.plans[0]!.triggers[0] = { kind: 'at_place', placeId: 'other' };
  (p.actions[0]!.parameters.array as string[]).push('x');
  p.actions[0]!.targetIds.push('x');
  p.actions[0]!.dependsOnActionIds.push('x');
  p.actions[0]!.handlesResponsibilityIds.push('x');
  p.actions[0]!.sourceIds.push('x');
  p.actions[0]!.preconditions.pop();
  p.responsibilities[0]!.subject.id = 'other';
  p.responsibilities[0]!.deadline!.at = 'other';
  p.responsibilities[0]!.sourceIds.push('x');
  p.responsibilities[0]!.nextCheck.pop();
  p.decisions[0]!.quote = 'other';
  p.focus!.threadId = 'other';
  assert.deepEqual(state, before);
});
test('finite JSON parameter boundary rejects nested objects, mixed arrays and non-JSON values without leaking content', () => {
  for (const bad of [
    { privateProfile: 'SECRET' },
    [1],
    ['ok', {}],
    NaN,
    Infinity,
    undefined,
    1n,
    () => true,
    Symbol('SECRET'),
    new Date(),
    new Array(1),
  ]) {
    const state = fixture();
    state.actions[0]!.parameters.bad = bad as never;
    assert.throws(
      () => actorStateContextPayload(state),
      (e) =>
        e instanceof Error &&
        e.message === 'INVALID_AGENT_CONTEXT' &&
        'code' in e &&
        e.code === 'INVALID_AGENT_CONTEXT',
    );
  }
  for (const container of [null, [], new Date(), 'text']) {
    const state = fixture();
    state.actions[0]!.parameters = container as never;
    assert.throws(() => actorStateContextPayload(state), /INVALID_AGENT_CONTEXT/);
  }
});
test('adapter invalid callback preserves exact error identity/code and is called once', () => {
  const state = fixture();
  state.actions[0]!.parameters.bad = { secret: 'DO_NOT_LOG' } as never;
  const expected = Object.assign(Error('ADAPTER_INVALID'), { code: 'ORIGINAL_ADAPTER_CODE' });
  let calls = 0;
  assert.throws(
    () =>
      actorStateContextPayload(state, {}, () => {
        calls++;
        throw expected;
      }),
    (error) => error === expected,
  );
  assert.equal(calls, 1);
});
test('unknown condition and malformed known fields fail closed; unknown extra fields are never read', () => {
  const state = fixture();
  state.plans[0]!.triggers.push({ kind: 'invented', interview: 'SECRET' } as never);
  assert.throws(() => actorStateContextPayload(state), /INVALID_AGENT_CONTEXT/);
  const bad = fixture();
  bad.goals[0]!.summary = { interview: 'SECRET' } as never;
  assert.throws(() => actorStateContextPayload(bad), /INVALID_AGENT_CONTEXT/);
  const accessor = fixture();
  Object.defineProperty(accessor.actions[0]!.parameters, 'x', {
    enumerable: true,
    get() {
      throw Error('PRIVATE_ACCESSOR');
    },
  });
  assert.throws(() => actorStateContextPayload(accessor), /INVALID_AGENT_CONTEXT/);
});
test('empty state/null focus/optional fields and long closed history are retained without summaries or truncation', () => {
  const empty = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'def', 0);
  assert.deepEqual(actorStateContextPayload(empty), empty);
  const state = fixture();
  state.decisions = Array.from({ length: 1200 }, (_, i) => ({
    ...state.decisions[1]!,
    id: `decision-${i}`,
    responsibilityRevision: i,
  }));
  const payload = actorStateContextPayload(state, { includeRequestRevisions: true });
  assert.equal(payload.decisions.length, 1200);
  assert.equal(payload.decisions.at(-1)?.responsibilityRevision, 1199);
  assert.equal(payload.goals[0]?.status, 'fulfilled');
  assert.equal(payload.plans[0]?.status, 'finished');
});
