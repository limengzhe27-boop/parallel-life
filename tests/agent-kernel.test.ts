import test from 'node:test';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  transitionAgentAttempt,
} from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentProposal,
  AgentActionResult,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  reduceActorAgentState,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import {
  authorizedAgentState,
  currentPlayerDecision,
} from '../src/modules/world/domain/agent-kernel.ts';

const at = '2026-10-15T10:00:00.000Z';
function fixture(): { context: AgentValidationContext; proposal: AgentProposal } {
  const state = emptyActorAgentState({ worldId: 'world-a', actorId: 'actor-a' }, 'author-v1', 4);
  state.goals.push({
    id: 'goal-a',
    summary: '安排自己的周末',
    sourceIds: ['opening'],
    status: 'active',
    resultIds: [],
  });
  state.responsibilities.push({
    id: 'invitation-a',
    subject: { kind: 'appointment', id: 'appointment-a' },
    summary: '等待玩家回应邀请',
    sourceIds: ['opening'],
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
  });
  return {
    context: {
      state,
      worldVersion: 4,
      storyAt: at,
      sources: [
        { id: 'opening', kind: 'private_message', recordId: 'm1', worldVersion: 1, at },
        { id: 'player-now', kind: 'private_message', recordId: 'm2', worldVersion: 4, at },
      ],
      input: { sourceId: 'player-now', text: '这次我不去了，今天的天气怎么样？', origin: 'player' },
      channel: {
        kind: 'private',
        threadId: 'actor-a',
        allowedCapabilities: ['appointment.propose', 'own.schedule'],
      },
    },
    proposal: {
      statements: [{ text: '知道了，我另外安排。今天是晴天。', dependsOnActionIds: [] }],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
    },
  };
}
function action(proposal: AgentProposal) {
  proposal.actions.push({
    id: 'a1',
    goalId: 'goal-a',
    sourceIds: ['opening'],
    capability: 'own.schedule',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: ['invitation-a'],
    status: 'ready',
  });
}
function result(outcome: 'succeeded' | 'failed' = 'succeeded'): AgentActionResult {
  return {
    id: 'r1',
    actionId: 'a1',
    eventId: 'event5',
    worldId: 'world-a',
    actorId: 'actor-a',
    worldVersion: 5,
    at,
    outcome,
    handledResponsibilityIds: outcome === 'succeeded' ? ['invitation-a'] : [],
    evidenceSourceIds: ['opening'],
  };
}
test('unrelated chat leaves the exact invitation responsibility open', () => {
  const { context, proposal } = fixture();
  const next = reduceActorAgentState(context, proposal, [], 5).state;
  assert.deepEqual(next.responsibilities, context.state.responsibilities);
  assert.equal(next.goals[0]!.status, 'active');
  assert.equal(next.revision, 1);
});
test('refusal is stored with player evidence; it is neither fulfilled work nor a closed NPC goal', () => {
  const { context, proposal } = fixture();
  proposal.decisions.push({
    id: 'decision1',
    responsibilityId: 'invitation-a',
    sourceId: 'player-now',
    quote: '这次我不去了',
    kind: 'declined',
  });
  const next = reduceActorAgentState(
    context,
    parseAgentProposal(context, JSON.stringify(proposal)),
    [],
    5,
  ).state;
  assert.equal(next.decisions[0]!.kind, 'declined');
  assert.equal(next.responsibilities[0]!.status, 'waiting');
  assert.equal(next.goals[0]!.status, 'active');
});
test('undecided, negotiating, deferred and accepted remain distinct recorded judgments', () => {
  for (const kind of ['undecided', 'negotiating', 'deferred', 'accepted'] as const) {
    const { context, proposal } = fixture();
    proposal.decisions.push({
      id: 'decision',
      responsibilityId: 'invitation-a',
      sourceId: 'player-now',
      quote: '今天的天气怎么样',
      kind,
    });
    assert.equal(reduceActorAgentState(context, proposal, [], 5).state.decisions[0]!.kind, kind);
  }
});
test('wake and NPC text cannot manufacture a player decision', () => {
  const { context, proposal } = fixture();
  context.input.origin = 'wake';
  proposal.decisions.push({
    id: 'decision',
    responsibilityId: 'invitation-a',
    sourceId: 'player-now',
    quote: '我不去了',
    kind: 'declined',
  });
  assert.throws(() => parseAgentProposal(context, proposal), /DECISION_NOT_PLAYER_INPUT/);
});
test('decision requires exact current source, quote and a real responsibility', () => {
  for (const patch of [
    { quote: '我答应去' },
    { sourceId: 'opening' },
    { responsibilityId: 'invented' },
  ]) {
    const { context, proposal } = fixture();
    proposal.decisions.push({
      id: 'decision',
      responsibilityId: 'invitation-a',
      sourceId: 'player-now',
      quote: '我不去了',
      kind: 'declined',
      ...patch,
    });
    assert.throws(() => parseAgentProposal(context, proposal));
  }
});
test('silence has no invented deadline; only a source-bound deadline can expire', () => {
  const { context, proposal } = fixture();
  proposal.responsibilities.push({
    ...context.state.responsibilities[0]!,
    status: 'expired',
    endReason: '超时',
  });
  assert.throws(() => parseAgentProposal(context, proposal), /NOT_EXPIRED/);
  proposal.responsibilities[0]!.deadline = { sourceId: 'opening', at };
  assert.throws(() => parseAgentProposal(context, proposal), /UNSOURCED_DEADLINE/);
  context.sources[0]!.deadlineAt = at;
  assert.equal(parseAgentProposal(context, proposal).responsibilities[0]!.status, 'expired');
});
test('an NPC may propose work but cannot claim it has already executed', () => {
  const { context, proposal } = fixture();
  action(proposal);
  proposal.actions[0]!.status = 'succeeded';
  assert.throws(() => parseAgentProposal(context, proposal), /MODEL_EXECUTION_CLAIM/);
});
test('kernel results update only this actor and do not mutate the prior snapshot', () => {
  const { context, proposal } = fixture();
  action(proposal);
  const before = JSON.stringify(context.state),
    input = JSON.stringify(proposal);
  const next = reduceActorAgentState(context, proposal, [result()], 5).state;
  assert.equal(next.actions[0]!.status, 'succeeded');
  assert.equal(JSON.stringify(context.state), before);
  assert.equal(JSON.stringify(proposal), input);
  assert.throws(
    () => reduceActorAgentState(context, proposal, [{ ...result(), actorId: 'actor-b' }], 5),
    /RESULT_SCOPE/,
  );
});
test('failed or unexecuted action cannot release dependent success dialogue', () => {
  const { context, proposal } = fixture();
  action(proposal);
  proposal.statements.push({ text: '已处理完成。', dependsOnActionIds: ['a1'] });
  const failed = reduceActorAgentState(context, proposal, [result('failed')], 5);
  assert.equal(failed.statements.length, 1);
  assert.equal(failed.statements[0]!.text, proposal.statements[0]!.text);
  proposal.statements.shift();
  assert.throws(
    () => reduceActorAgentState(context, proposal, [], 5),
    /REPLY_DEPENDS_ON_UNEXECUTED_ACTION/,
  );
});
test('fulfillment needs an actual successful result that handles that responsibility', () => {
  const { context, proposal } = fixture();
  action(proposal);
  proposal.responsibilities.push({
    ...context.state.responsibilities[0]!,
    status: 'fulfilled',
    resolutionResultId: 'r1',
    endReason: '已执行安排',
  });
  assert.throws(
    () => reduceActorAgentState(context, proposal, [], 5),
    /UNCONFIRMED_RESPONSIBILITY_RESULT/,
  );
  assert.throws(
    () => reduceActorAgentState(context, proposal, [result('failed')], 5),
    /UNCONFIRMED_RESPONSIBILITY_RESULT/,
  );
  assert.equal(
    reduceActorAgentState(context, proposal, [result()], 5).state.responsibilities[0]!.status,
    'fulfilled',
  );
});
test('cycle, future evidence, unauthorized capability and cross-channel focus are rejected', () => {
  const { context, proposal } = fixture();
  action(proposal);
  proposal.actions.push({ ...proposal.actions[0]!, id: 'a2', dependsOnActionIds: ['a1'] });
  proposal.actions[0]!.dependsOnActionIds = ['a2'];
  assert.throws(() => parseAgentProposal(context, proposal), /CYCLIC_ACTION_DEPENDENCY/);
  proposal.actions = [];
  proposal.focus = {
    channel: 'group',
    threadId: 'another',
    subjectId: null,
    questionSourceId: null,
    replyToActorId: null,
  };
  assert.throws(() => parseAgentProposal(context, proposal), /FOCUS_CHANNEL/);
  delete proposal.focus;
  action(proposal);
  proposal.actions[0]!.capability = 'unregistered';
  assert.throws(() => parseAgentProposal(context, proposal), /UNAUTHORIZED_CAPABILITY/);
  proposal.actions = [];
  context.sources[0]!.worldVersion = 5;
  assert.throws(() => parseAgentProposal(context, proposal), /FUTURE_SOURCE/);
});
test('unknown attempts may receive the original result, never become a new request', () => {
  assert.equal(
    transitionAgentAttempt('unknown_after_send', 'response_received'),
    'response_received',
  );
  assert.throws(
    () => transitionAgentAttempt('unknown_after_send', 'request_sent'),
    /INVALID_ATTEMPT_TRANSITION/,
  );
  assert.throws(
    () => transitionAgentAttempt('invalid_output', 'request_sent'),
    /INVALID_ATTEMPT_TRANSITION/,
  );
});
test('forgotten goal and decision text is absent from model view but survives canonical state unchanged', () => {
  const { context, proposal } = fixture();
  context.state.goals[0]!.summary = '被忘却的私密计划';
  context.state.decisions.push({
    id: 'old-decision',
    responsibilityId: 'invitation-a',
    kind: 'accepted',
    sourceId: 'opening',
    quote: '被忘却的原话',
  });
  const before = JSON.stringify(context.state);
  const view = authorizedAgentState(context.state, new Set(['player-now']));
  assert.equal(view.viewState.goals.length, 0);
  assert.equal(view.viewState.decisions.length, 0);
  assert.ok(!JSON.stringify(view.viewState).includes('被忘却'));
  assert.equal(JSON.stringify(context.state), before);
  context.viewState = view.viewState;
  const next = reduceActorAgentState(context, proposal, [], 5).state;
  assert.equal(next.goals[0]!.summary, '被忘却的私密计划');
  proposal.goals.push({
    ...context.state.goals[0]!,
    sourceIds: ['player-now'],
    summary: '用新文字覆盖旧记录',
  });
  assert.throws(() => parseAgentProposal(context, proposal), /REDACTED_STATE_MUTATION/);
});
test('authorization closure prunes dependent actions, plan conditions, waiting conditions and focus to a fixed point', () => {
  const { context, proposal } = fixture();
  action(proposal);
  const first = {
    ...proposal.actions[0]!,
    preconditions: [{ kind: 'observation' as const, sourceId: 'forgotten' }],
  };
  context.state.actions = [
    first,
    { ...first, id: 'a2', preconditions: [], dependsOnActionIds: ['a1'] },
  ];
  context.state.plans = [
    {
      id: 'p',
      goalId: 'goal-a',
      summary: 'dependant plan',
      sourceIds: ['opening'],
      status: 'active',
      actionIds: ['a2'],
      nextActionId: 'a2',
      triggers: [{ kind: 'result', actionId: 'a1', outcome: 'succeeded' }],
      missingConditions: [],
    },
  ];
  context.state.responsibilities[0]!.nextCheck = [{ kind: 'observation', sourceId: 'forgotten' }];
  context.state.focus = {
    channel: 'private',
    threadId: 'actor-a',
    subjectId: 'p',
    questionSourceId: null,
    replyToActorId: null,
  };
  const { viewState } = authorizedAgentState(context.state, new Set(['opening', 'player-now']));
  assert.equal(viewState.actions.length, 0);
  assert.equal(viewState.plans.length, 0);
  assert.equal(viewState.responsibilities.length, 0);
  assert.equal(viewState.focus, null);
});
test('recording a plan cannot fulfill an external objective merely because the action succeeded', () => {
  const { context, proposal } = fixture();
  action(proposal);
  context.state.actions = [{ ...proposal.actions[0]!, status: 'succeeded', resultId: 'r1' }];
  proposal.actions = [];
  context.knownActionResults = [{ ...result(), completedGoalIds: [] }];
  proposal.goals = [
    {
      ...context.state.goals[0]!,
      summary: '修好轮胎',
      status: 'fulfilled',
      resultIds: ['r1'],
      endReason: '记下计划',
    },
  ];
  assert.throws(() => reduceActorAgentState(context, proposal, [], 5), /UNCONFIRMED_GOAL_RESULT/);
});
test('the latest refusal supersedes an old acceptance and a revised request requires its own decision', () => {
  const { context, proposal } = fixture();
  context.state.decisions = [
    {
      id: 'old-yes',
      responsibilityId: 'invitation-a',
      kind: 'accepted',
      sourceId: 'opening',
      quote: '以前答应',
      responsibilityRevision: 0,
    },
  ];
  proposal.decisions = [
    {
      id: 'now-no',
      responsibilityId: 'invitation-a',
      kind: 'declined',
      sourceId: 'player-now',
      quote: '我不去了',
    },
  ];
  assert.equal(currentPlayerDecision(context, proposal, 'invitation-a')?.kind, 'declined');
  proposal.decisions = [];
  proposal.responsibilities = [
    { ...context.state.responsibilities[0]!, summary: '改为另一时间和安排' },
  ];
  assert.equal(currentPlayerDecision(context, proposal, 'invitation-a'), undefined);
});
