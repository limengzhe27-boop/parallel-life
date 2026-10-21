import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  validateAgentProposal,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import type {
  AgentProposal,
  AgentPlan,
  AgentAction,
} from '../src/modules/world/domain/agent-runtime.ts';
import { AgentProposalSchema } from '../src/modules/world/infrastructure/agent-proposal-schema.ts';
function fixture() {
  const at = '2026-10-18T08:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'd', 0);
  state.goals = [
    { id: 'g', summary: 'Own goal', status: 'active', sourceIds: ['s'], resultIds: [] },
  ];
  const context: AgentValidationContext = {
    state,
    worldVersion: 0,
    storyAt: at,
    sources: [{ id: 's', kind: 'accepted_input', recordId: 's', worldVersion: 0, at }],
    input: { origin: 'player', sourceId: 's', text: 'Please consider your own next step' },
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: ['plan.record'] },
  };
  const proposal: AgentProposal = {
    statements: [{ text: 'I will consider it.', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  const plan: AgentPlan = {
    id: 'p',
    goalId: 'g',
    summary: 'Own next step',
    status: 'active',
    sourceIds: ['s'],
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  };
  return { context, proposal, plan };
}
test('dedicated server coordination requires explicit sourced choice but player text does not gain coordination authority', () => {
  const f = fixture();
  f.context.input.origin = 'coordination';
  f.context.input.text = JSON.stringify({
    type: 'npc_episode_consideration',
    requestId: 'r',
    revision: 0,
  });
  f.proposal.statements = [];
  assert.throws(() => validateAgentProposal(f.context, f.proposal), /EPISODE_DECISION_REQUIRED/);
  for (const choice of ['quiet', 'engage', 'decline', 'defer', 'need_information'] as const) {
    validateAgentProposal(f.context, {
      ...f.proposal,
      episodeDecision: {
        requestId: 'r',
        choice,
        reason: 'My own considered position',
        sourceIds: ['s'],
      },
    });
  }
  assert.throws(
    () =>
      validateAgentProposal(f.context, {
        ...f.proposal,
        episodeDecision: { requestId: 'r', choice: 'quiet', reason: '', sourceIds: ['s'] },
      }),
    /EPISODE_DECISION_SCOPE/,
  );
  f.context.input.origin = 'player';
  f.context.episodeManifest = {
    schemaVersion: 1,
    requestId: 'r',
    requestRevision: 0,
    episodeId: 'ep',
    actorId: 'a',
    engineEpoch: 2,
    createdAtVersion: 0,
    sourceId: 'episode-intent:r',
    contentHash: 'a'.repeat(64),
  };
  f.proposal.statements = [{ text: 'Unrelated reply', dependsOnActionIds: [] }];
  assert.throws(() => validateAgentProposal(f.context, f.proposal), /EPISODE_DECISION_REQUIRED/);
});
test('actionless plans are durable intentions; claimed next actions still require a legal action', () => {
  const f = fixture();
  f.proposal.plans = [f.plan];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.plan.triggers = [{ kind: 'observation', sourceId: 's' }];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.plan.triggers = [{ kind: 'observation', sourceId: 'foreign' }];
  assert.throws(() => validateAgentProposal(f.context, f.proposal), /UNKNOWN_SOURCE/);
  f.plan.triggers = [];
  const a: AgentAction = {
    id: 'a1',
    goalId: 'g',
    capability: 'plan.record',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['s'],
    status: 'waiting',
  };
  f.context.state.actions = [a];
  f.plan.actionIds = ['a1'];
  f.plan.nextActionId = 'a1';
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.context.channel.allowedCapabilities = [];
  assert.throws(() => validateAgentProposal(f.context, f.proposal), /PLAN_NEXT_STEP_REQUIRED/);
});
test('waiting and blocked are explanatory, historical unchanged empty plans remain compatible', () => {
  const f = fixture();
  f.context.state.plans = [structuredClone(f.plan)];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans = [structuredClone(f.plan)];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans[0]!.summary = 'A material new commitment';
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans = [{ ...f.plan, status: 'waiting' }];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans[0]!.missingConditions = ['Awaiting an explicit player decision'];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans = [
    {
      ...f.plan,
      status: 'blocked',
      missingConditions: ['Physical stock checking has no registered capability'],
    },
  ];
  assert.doesNotThrow(() => validateAgentProposal(f.context, f.proposal));
  f.proposal.plans[0]!.missingConditions = ['   '];
  assert.throws(() => validateAgentProposal(f.context, f.proposal), /PLAN_BLOCKED_REASON_REQUIRED/);
});

test('action proposal omits empty execution graph and defaults status without granting success', () => {
  const parsed = AgentProposalSchema.parse({
    actions: [
      {
        id: 'a-min',
        goalId: 'g',
        capability: 'plan.record',
        parameters: {},
        sourceIds: ['s'],
      },
    ],
  });
  assert.equal(parsed.actions[0]!.status, 'proposed');
  assert.deepEqual(parsed.actions[0]!.targetIds, []);
  assert.deepEqual(parsed.actions[0]!.preconditions, []);
  assert.deepEqual(parsed.actions[0]!.dependsOnActionIds, []);
  assert.deepEqual(parsed.actions[0]!.handlesResponsibilityIds, []);
  assert.equal(parsed.actions[0]!.resultId, undefined);
});
