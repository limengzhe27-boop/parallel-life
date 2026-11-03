import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  currentActorWorkState,
  actorStateContextPayload,
} from '../src/modules/world/application/agent-state-context.ts';
import { NpcAgentModel } from '../src/modules/world/infrastructure/npc-agent-model.ts';
function snapshot(channel: AgentSnapshot['channel']['kind'] = 'private'): AgentSnapshot {
  const state = emptyActorAgentState(
    { worldId: 'world-a', actorId: 'actor-a' },
    'definition-v3',
    9,
  );
  state.revision = 4;
  state.goals = [
    {
      id: 'g1',
      summary: '希望被认真对待',
      status: 'active',
      sourceIds: ['source-1'],
      resultIds: [],
    },
  ];
  state.plans = [
    {
      id: 'p1',
      goalId: 'g1',
      summary: '先听玩家的安排',
      status: 'waiting',
      sourceIds: ['source-1'],
      actionIds: [],
      nextActionId: null,
      triggers: [{ kind: 'observation', sourceId: 'source-1' }],
      missingConditions: ['等待实际回答'],
    },
  ];
  state.responsibilities = [
    {
      id: 'r1',
      subject: { kind: 'request', id: 'request-1' },
      summary: '等待对方是否愿意相见',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['source-1'],
      nextCheck: [],
    },
  ];
  state.focus = {
    channel: 'private',
    threadId: 'previous-thread',
    subjectId: 'request-1',
    questionSourceId: 'source-1',
    replyToActorId: 'actor-a',
  };
  return {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 9,
    storyAt: '2026-10-15T08:00:00Z',
    actor: {
      name: '林白语',
      persona: '大学同学，习惯先询问再行动。',
      boundaries: '不替玩家决定，不公开私密材料。',
      definitionRef: state.definitionRef,
    },
    sources: [
      {
        id: 'source-1',
        recordId: 'DB-POINTER-NOT-FOR-PROMPT',
        kind: 'private_message',
        worldVersion: 9,
        at: '2026-10-15T08:00:00Z',
      },
    ],
    observations: [{ sourceId: 'source-1', text: '你今天方便见面吗？', kind: 'speech' }],
    channel: {
      kind: channel,
      threadId: `${channel}-thread`,
      audienceActorIds: channel === 'group' ? ['actor-a', 'actor-b'] : ['actor-a'],
      allowedCapabilities: [],
    },
    input: { sourceId: 'source-1', text: '我还没决定，先别帮我答应。', origin: 'player' },
  };
}

test('terminal history is removed before request budgets; next steps share the selected graph', async () => {
  const sizes: number[] = [];
  const stateSizes: { before: number; after: number }[] = [];
  for (const count of [0, 100, 10000]) {
    const s = snapshot();
    for (let i = 0; i < count; i++)
      s.viewState.plans.push({
        id: `old-${i}`,
        goalId: null,
        summary: '已完成的无关历史安排',
        status: 'finished',
        sourceIds: ['old-source'],
        actionIds: [],
        nextActionId: null,
        triggers: [],
        missingConditions: [],
      });
    stateSizes.push({
      before: JSON.stringify(actorStateContextPayload(s.viewState)).length,
      after: JSON.stringify(actorStateContextPayload(currentActorWorkState(s.viewState))).length,
    });
    let payload: any;
    const adapter = new NpcAgentModel({
      async complete(messages) {
        sizes.push(JSON.stringify(messages).length);
        payload = JSON.parse(messages[1]!.content);
        return '{}';
      },
    });
    await adapter.decide(s);
    assert.deepEqual(
      payload.state.plans.map((p: any) => p.id),
      ['p1'],
    );
    assert.deepEqual(
      payload.planNextSteps.map((p: any) => p.planId),
      ['p1'],
    );
    assert.equal(s.viewState.plans.length, count + 1, 'persistent input is untouched');
  }
  assert.equal(sizes[1], sizes[2]);
  assert.ok(Math.abs(sizes[0]! - sizes[1]!) < 10, 'only the existing withheld flag changes');
  console.log(
    JSON.stringify({
      historyCounts: [0, 100, 10000],
      modelMessageCharacters: sizes,
      stateCharacters: stateSizes,
    }),
  );
});

test('current graph retains terminal dependencies, refusal scope, unanswered questions and exact references', () => {
  const s = snapshot().viewState;
  s.plans[0]!.actionIds = ['a'];
  s.actions = [
    {
      id: 'a',
      goalId: null,
      capability: 'x',
      targetIds: [],
      parameters: {},
      preconditions: [],
      dependsOnActionIds: ['done'],
      handlesResponsibilityIds: [],
      status: 'ready',
      sourceIds: [],
    },
    {
      id: 'done',
      goalId: null,
      capability: 'x',
      targetIds: [],
      parameters: {},
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      status: 'succeeded',
      resultId: 'real-result',
      sourceIds: [],
    },
  ];
  s.responsibilities.push({
    id: 'refused',
    subject: { kind: 'request', id: 'friday-only' },
    summary: '周五聚餐',
    status: 'withdrawn',
    waitingOn: null,
    nextCheck: [],
    sourceIds: ['refusal'],
    endReason: 'declined',
  });
  s.decisions = [
    {
      id: 'd',
      responsibilityId: 'refused',
      kind: 'declined',
      sourceId: 'refusal',
      quote: '周五不去，以后可以',
    },
  ];
  s.questions = [
    {
      id: 'q',
      channel: 'private',
      threadId: 't',
      sourceId: 'q-source',
      text: '你想去哪',
      askedAt: '2026-10-15T08:00:00Z',
      status: 'open',
    },
  ];
  s.plans.push({
    ...s.plans[0]!,
    id: 'withdrawn',
    status: 'withdrawn',
    sourceIds: ['current-reference'],
    actionIds: [],
    nextActionId: null,
  });
  const selected = currentActorWorkState(s, new Set(['current-reference', 'refusal']));
  assert.deepEqual(
    selected.actions.map((a) => a.id),
    ['a', 'done'],
  );
  assert.equal(selected.actions[1]!.resultId, 'real-result');
  assert.equal(
    selected.responsibilities.find((r) => r.id === 'refused')!.subject.id,
    'friday-only',
  );
  assert.equal(selected.decisions[0]!.quote, '周五不去，以后可以');
  assert.equal(selected.questions![0]!.id, 'q');
  assert.ok(selected.plans.some((p) => p.id === 'withdrawn'));
  assert.deepEqual(
    currentActorWorkState(selected, new Set(['current-reference', 'refusal'])),
    selected,
  );
});

test('condition edges and supersession retain exact terminal evidence, including cycles', () => {
  const s = snapshot().viewState;
  const old = { ...s.plans[0]!, id: 'old', status: 'withdrawn' as const, supersedesPlanId: 'p1' };
  s.plans[0]!.supersedesPlanId = 'old';
  s.plans[0]!.triggers = [{ kind: 'result', actionId: 'done', outcome: 'succeeded' }];
  s.plans.push(old);
  s.actions = [
    {
      id: 'done',
      goalId: 'g1',
      capability: 'x',
      targetIds: [],
      parameters: {},
      preconditions: [{ kind: 'player_decision', responsibilityId: 'r1', decision: 'declined' }],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      status: 'succeeded',
      resultId: 'result-proof',
      sourceIds: [],
    },
  ];
  const view = currentActorWorkState(s);
  assert.deepEqual(
    view.plans.map((p) => p.id),
    ['p1', 'old'],
  );
  assert.equal(view.actions[0]!.resultId, 'result-proof');
  assert.equal(view.responsibilities[0]!.id, 'r1');
});
