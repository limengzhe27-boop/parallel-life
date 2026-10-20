import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentActionResult,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  authorizedAgentState,
  reduceActorAgentState,
  validateAgentProposal,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { evaluateAgentActionEligibility } from '../src/modules/world/domain/agent-eligibility.ts';
import { AgentProposalSchema } from '../src/modules/world/infrastructure/agent-proposal-schema.ts';

const at = '2026-10-20T08:00:00.000Z';
function fixture(capability = 'media.generate_image') {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 7);
  state.goals.push({
    id: 'unrelated-goal',
    summary: '今晚安排',
    status: 'active',
    resultIds: [],
    sourceIds: ['input'],
  });
  const context: AgentValidationContext = {
    state,
    worldVersion: 7,
    storyAt: at,
    sources: [{ id: 'input', kind: 'accepted_input', recordId: 'receipt', worldVersion: 7, at }],
    input: { sourceId: 'input', text: '给我发张自拍', origin: 'player' },
    channel: {
      kind: 'private',
      threadId: 'actor',
      allowedCapabilities: [
        'media.generate_image',
        'media.generate_video',
        'media.share',
        'travel.begin',
      ],
    },
  };
  const proposal: AgentProposal = {
    statements: [{ text: '我找个光线好的位置。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    responsibilities: [],
    decisions: [],
    actions: [
      {
        id: 'photo',
        goalId: null,
        capability,
        targetIds: [],
        parameters: {},
        preconditions: [],
        dependsOnActionIds: [],
        handlesResponsibilityIds: [],
        status: 'ready',
        sourceIds: ['input'],
      },
    ],
  };
  return { context, proposal };
}
function result(outcome: 'succeeded' | 'failed'): AgentActionResult {
  return {
    id: 'result',
    actionId: 'photo',
    eventId: 'event',
    worldId: 'world',
    actorId: 'actor',
    worldVersion: 8,
    at,
    outcome,
    handledResponsibilityIds: [],
    evidenceSourceIds: ['input'],
    completedGoalIds: [],
    ...(outcome === 'failed' ? { failureCode: 'MEDIA_UNAVAILABLE' } : {}),
  };
}
function eligibility(context: AgentValidationContext, proposal: AgentProposal) {
  return evaluateAgentActionEligibility(
    {
      ...context,
      viewState: structuredClone(context.state),
      redactedStateIds: [],
      observations: [],
    },
    proposal,
    proposal.actions[0]!,
    { storyAt: at },
  );
}

test('immediate media executes without invented goal or plan and retains unrelated state', () => {
  for (const capability of ['media.generate_image', 'media.generate_video', 'media.share']) {
    const { context, proposal } = fixture(capability);
    assert.equal(AgentProposalSchema.safeParse(proposal).success, true);
    validateAgentProposal(context, proposal);
    assert.equal(eligibility(context, proposal).status, 'ready');
    const next = reduceActorAgentState(context, proposal, [result('succeeded')], 8);
    assert.deepEqual(next.state.goals, context.state.goals);
    assert.deepEqual(next.state.plans, []);
    assert.equal(next.state.actions[0]!.goalId, null);
    assert.equal(next.state.actions[0]!.status, 'succeeded');
    assert.equal(next.state.actions[0]!.resultId, 'result');
  }
});

test('null goal is not a general bypass for other capabilities or missing permission/source', () => {
  const { context, proposal } = fixture('travel.begin');
  assert.throws(() => validateAgentProposal(context, proposal), /UNKNOWN_GOAL/);
  assert.equal(eligibility(context, proposal).status, 'blocked');
  proposal.actions[0]!.capability = 'media.generate_image';
  context.channel.allowedCapabilities = [];
  assert.throws(() => validateAgentProposal(context, proposal), /UNAUTHORIZED_CAPABILITY/);
  context.channel.allowedCapabilities = ['media.generate_image'];
  proposal.actions[0]!.sourceIds = ['private-secret'];
  assert.throws(() => validateAgentProposal(context, proposal), /UNKNOWN_SOURCE/);
  assert.equal(eligibility(context, proposal).status, 'blocked');
});

test('standalone media stays in its authorized view, hidden source remains hidden', () => {
  const { context, proposal } = fixture();
  context.state.actions.push(proposal.actions[0]!);
  const visible = authorizedAgentState(context.state, new Set(['input']));
  assert.equal(visible.viewState.actions.length, 1);
  assert.deepEqual(visible.redactedStateIds, []);
  const hidden = authorizedAgentState(context.state, new Set());
  assert.equal(hidden.viewState.actions.length, 0);
  assert.ok(hidden.redactedStateIds.includes('photo'));
});

test('media failure keeps independent text but cannot show success-dependent text', () => {
  const { context, proposal } = fixture();
  proposal.statements.push({ text: '已经发好了。', dependsOnActionIds: ['photo'] });
  const next = reduceActorAgentState(context, proposal, [result('failed')], 8);
  assert.deepEqual(next.statements, [proposal.statements[0]]);
  assert.equal(next.state.actions[0]!.status, 'failed');
  assert.deepEqual(next.state.goals, context.state.goals);
});

test('an existing planned action cannot unlink its goal and completed standalone action cannot execute again', () => {
  const { context, proposal } = fixture();
  context.state.actions.push({ ...proposal.actions[0]!, goalId: 'unrelated-goal' });
  assert.throws(() => validateAgentProposal(context, proposal), /ACTION_GOAL_UNLINK/);
  assert.equal(eligibility(context, proposal).status, 'blocked');
  context.state.actions = [{ ...proposal.actions[0]!, status: 'succeeded', resultId: 'already' }];
  assert.throws(() => validateAgentProposal(context, proposal), /TERMINAL_ACTION/);
  assert.equal(eligibility(context, proposal).status, 'blocked');
});
