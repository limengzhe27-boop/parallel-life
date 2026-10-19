import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentAction,
  type AgentPlan,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  reduceActorAgentState,
  validateAgentProposal,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
const at = '2026-10-19T10:00:00.000Z';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'def', 0);
  state.goals = [
    { id: 'g', summary: 'Own delivery', status: 'active', sourceIds: ['s'], resultIds: [] },
  ];
  const action: AgentAction = {
    id: 'old-action',
    goalId: 'g',
    capability: 'plan.record',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['s'],
    status: 'ready',
  };
  const plan: AgentPlan = {
    id: 'old-plan',
    goalId: 'g',
    summary: 'Original arrangement',
    status: 'active',
    sourceIds: ['s'],
    actionIds: [action.id],
    nextActionId: action.id,
    triggers: [],
    missingConditions: [],
  };
  state.actions = [action];
  state.plans = [plan];
  state.responsibilities = [
    {
      id: 'r',
      subject: { kind: 'matter', id: 'm' },
      summary: 'Still owe a result',
      status: 'open',
      sourceIds: ['s'],
      waitingOn: 'self',
      nextCheck: [],
    },
  ];
  const context: AgentValidationContext = {
    state,
    worldVersion: 0,
    storyAt: at,
    input: { origin: 'wake', sourceId: 's', text: 'new arrangement' },
    sources: [{ id: 's', kind: 'private_message', recordId: 'm', worldVersion: 0, at }],
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: ['plan.record'] },
  };
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [
      {
        ...plan,
        id: 'new-plan',
        supersedesPlanId: plan.id,
        actionIds: [],
        nextActionId: null,
        status: 'blocked',
        missingConditions: ['Need actual delivery capability'],
      },
    ],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  return { context, proposal };
}
function apply(f: ReturnType<typeof fixture>) {
  return reduceActorAgentState(f.context, f.proposal, [], 1).state;
}
test('explicit replacement retires old plan and unexecuted action, preserving goal, responsibility and input history', () => {
  const f = fixture(),
    before = structuredClone(f.context.state),
    state = apply(f);
  assert.equal(state.plans[0]!.status, 'withdrawn');
  assert.equal(state.actions[0]!.status, 'withdrawn');
  assert.equal(state.plans[1]!.status, 'blocked');
  assert.deepEqual(state.goals, before.goals);
  assert.deepEqual(state.responsibilities, before.responsibilities);
  assert.deepEqual(f.context.state, before);
  assert.deepEqual(state.plans[0]!.actionIds, ['old-action']);
});
test('unexecuted action shared by another nonterminal plan is retained', () => {
  const f = fixture();
  f.context.state.plans.push({ ...f.context.state.plans[0]!, id: 'shared-plan' });
  assert.equal(apply(f).actions[0]!.status, 'ready');
});
test('terminal action results and history are never rewritten', () => {
  for (const status of ['succeeded', 'failed', 'withdrawn'] as const) {
    const f = fixture();
    f.context.state.actions[0]!.status = status;
    assert.equal(apply(f).actions[0]!.status, status);
  }
});
test('executing old action or a current result rejects replacement', () => {
  const f = fixture();
  f.context.state.actions[0]!.status = 'executing';
  assert.throws(() => apply(f), /PLAN_SUPERSESSION_INFLIGHT/);
  const g = fixture();
  assert.throws(
    () =>
      reduceActorAgentState(
        g.context,
        g.proposal,
        [
          {
            id: 'result',
            worldId: 'w',
            actorId: 'a',
            actionId: 'old-action',
            eventId: 'e',
            worldVersion: 1,
            at,
            outcome: 'succeeded',
            handledResponsibilityIds: [],
            evidenceSourceIds: ['s'],
          },
        ],
        1,
      ),
    /PLAN_SUPERSESSION_INFLIGHT/,
  );
});
test('forks, cycles, cross-goal and terminal prior plans reject', () => {
  const f = fixture();
  f.proposal.plans.push({ ...f.proposal.plans[0]!, id: 'fork' });
  assert.throws(() => apply(f), /PLAN_SUPERSESSION_FORK/);
  const cycle = fixture();
  cycle.proposal.plans.push({ ...cycle.context.state.plans[0]!, supersedesPlanId: 'new-plan' });
  assert.throws(() => apply(cycle), /PLAN_SUPERSESSION_CONFLICT/);
  const cross = fixture();
  cross.context.state.goals.push({ ...cross.context.state.goals[0]!, id: 'other' });
  cross.proposal.plans[0]!.goalId = 'other';
  assert.throws(() => apply(cross), /INVALID_PREVIOUS_PLAN/);
  for (const status of ['finished', 'withdrawn'] as const) {
    const terminal = fixture();
    terminal.context.state.plans[0]!.status = status;
    assert.throws(() => apply(terminal), /TERMINAL_PREVIOUS_PLAN/);
  }
});
test('ordinary unchanged saved supersession is replayable; terminal plan cannot reopen', () => {
  const f = fixture();
  const state = apply(f);
  const context = { ...f.context, state, worldVersion: 1 };
  validateAgentProposal(context, { ...f.proposal, plans: [state.plans[1]!] });
  const changed = { ...state.plans[1]!, summary: 'Adjusted own blocked plan' };
  const updated = reduceActorAgentState(context, { ...f.proposal, plans: [changed] }, [], 2).state;
  assert.equal(updated.plans[1]!.summary, changed.summary);
  assert.equal(
    updated.plans[0]!.missingConditions.length,
    1,
    'inherited history does not repeat supersession',
  );
  assert.throws(
    () =>
      validateAgentProposal(context, {
        ...f.proposal,
        plans: [{ ...state.plans[0]!, status: 'active' }],
      }),
    /TERMINAL_PLAN/,
  );
});
