import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAgentActionEligibility as evaluate,
  type AgentEligibilitySnapshot,
  type AgentEligibilityContext,
} from '../src/modules/world/domain/agent-eligibility.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentProposal,
  AgentAction,
  AgentActionResult,
} from '../src/modules/world/domain/agent-runtime.ts';

const at = '2026-10-15T10:00:00.000Z';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'npc' }, 'def', 4);
  state.goals.push({
    id: 'g',
    summary: '自己的安排',
    status: 'active',
    resultIds: [],
    sourceIds: ['s'],
  });
  state.responsibilities.push({
    id: 'r',
    revision: 2,
    subject: { kind: 'request', id: 'request' },
    summary: '询问是否参加',
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
    sourceIds: ['s'],
  });
  const snapshot: AgentEligibilitySnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 4,
    storyAt: at,
    sources: [
      { id: 's', kind: 'authored', recordId: 'source', worldVersion: 0, at },
      { id: 'input', kind: 'accepted_input', recordId: 'receipt', worldVersion: 4, at },
    ],
    observations: [{ sourceId: 's' }],
    input: { sourceId: 'input', text: '', origin: 'wake' },
    channel: { kind: 'private', threadId: 'npc', allowedCapabilities: ['own.schedule'] },
  };
  const action: AgentAction = {
    id: 'a',
    goalId: 'g',
    capability: 'own.schedule',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    status: 'proposed',
    sourceIds: ['s'],
  };
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [action],
    responsibilities: [],
    decisions: [],
  };
  const context: AgentEligibilityContext = { storyAt: at };
  return { snapshot, action, proposal, context };
}
function receipt(outcome: 'succeeded' | 'failed' = 'succeeded'): AgentActionResult {
  return {
    id: 'result',
    worldId: 'w',
    actorId: 'npc',
    actionId: 'dependency',
    eventId: 'event',
    worldVersion: 5,
    at,
    outcome,
    handledResponsibilityIds: [],
    evidenceSourceIds: ['s'],
  };
}
function addDependency(f: ReturnType<typeof fixture>) {
  f.snapshot.viewState.actions.push({
    ...structuredClone(f.action),
    id: 'dependency',
    status: 'succeeded',
  });
  f.snapshot.state.actions = structuredClone(f.snapshot.viewState.actions);
  f.action.dependsOnActionIds = ['dependency'];
}
function addPlan(f: ReturnType<typeof fixture>) {
  f.proposal.plans.push({
    id: 'p',
    goalId: 'g',
    summary: '等到约定时间再行动',
    status: 'active',
    actionIds: ['a'],
    nextActionId: 'a',
    triggers: [{ kind: 'at_or_after', at: '2026-10-15T11:00:00Z', sourceId: 's' }],
    missingConditions: [],
    sourceIds: ['s'],
  });
}
const run = (f: ReturnType<typeof fixture>) =>
  evaluate(f.snapshot, f.proposal, f.action, f.context);

test('quiet proposal and no deadline permit independent action without mutating any input', () => {
  const f = fixture();
  const before = structuredClone(f);
  assert.deepEqual(run(f), { status: 'ready', missing: [] });
  assert.deepEqual(f, before);
});
test('an empty action precondition cannot bypass a related plan trigger', () => {
  const f = fixture();
  addPlan(f);
  assert.equal(run(f).status, 'waiting');
  f.context.storyAt = '2026-10-15T11:00:00Z';
  assert.equal(run(f).status, 'ready');
});
test('plan nextAction and null nextAction wait without inventing an action', () => {
  const f = fixture();
  addPlan(f);
  f.proposal.plans[0]!.triggers = [];
  f.proposal.plans[0]!.nextActionId = null;
  assert.equal(run(f).missing[0]!.code, 'plan_next_action');
  f.proposal.plans[0]!.nextActionId = 'a';
  assert.equal(run(f).status, 'ready');
});
test('waiting plan can become eligible; blocked or terminal plans cannot execute', () => {
  const f = fixture();
  addPlan(f);
  f.proposal.plans[0]!.triggers = [];
  for (const status of ['waiting', 'blocked', 'finished', 'withdrawn'] as const) {
    f.proposal.plans[0]!.status = status;
    assert.equal(run(f).status, status === 'waiting' ? 'ready' : 'blocked');
  }
});
test('unlinking an existing plan cannot evade its conditions', () => {
  const f = fixture();
  addPlan(f);
  f.snapshot.state.plans = structuredClone(f.proposal.plans);
  f.snapshot.viewState.plans = structuredClone(f.proposal.plans);
  f.proposal.plans[0]!.actionIds = [];
  f.proposal.plans[0]!.nextActionId = null;
  assert.equal(run(f).status, 'blocked');
});
test('unknown place stays waiting; only trusted exact location satisfies arrival', () => {
  const f = fixture();
  f.action.preconditions = [{ kind: 'at_place', placeId: 'shop' }];
  assert.equal(run(f).status, 'waiting');
  f.context.actorPlaceId = 'street';
  assert.equal(run(f).status, 'waiting');
  f.context.actorPlaceId = 'shop';
  assert.equal(run(f).status, 'ready');
});
test('observation requires an actual authorized observation, not source presence alone', () => {
  const f = fixture();
  f.action.preconditions = [{ kind: 'observation', sourceId: 's' }];
  f.snapshot.observations = [];
  assert.equal(run(f).status, 'waiting');
  f.snapshot.observations = [{ sourceId: 's' }];
  assert.equal(run(f).status, 'ready');
});
test('model succeeded status is never a dependency receipt', () => {
  const f = fixture();
  addDependency(f);
  assert.equal(run(f).status, 'waiting');
  f.context.trustedResults = [receipt()];
  assert.equal(run(f).status, 'ready');
});
test('failed dependency blocks while explicit failed-result condition can trigger an alternative', () => {
  const f = fixture();
  addDependency(f);
  f.context.trustedResults = [receipt('failed')];
  assert.equal(run(f).status, 'blocked');
  f.action.dependsOnActionIds = [];
  f.action.preconditions = [{ kind: 'result', actionId: 'dependency', outcome: 'failed' }];
  assert.equal(run(f).status, 'ready');
});
test('cross-world, cross-actor, future, non-receipt and unregistered-action results do not authorize', () => {
  const variants = [
    { worldId: 'else' },
    { actorId: 'else' },
    { worldVersion: 6 },
    { at: '2026-10-15T11:00:00Z' },
    { eventId: '' },
    { actionId: 'unknown' },
  ];
  for (const patch of variants) {
    const f = fixture();
    addDependency(f);
    f.context.trustedResults = [{ ...receipt(), ...patch }];
    assert.equal(run(f).status, 'waiting', JSON.stringify(patch));
  }
});
test('current responsibility revision rejects old acceptance and accepts a current decision', () => {
  const f = fixture();
  f.action.preconditions = [
    { kind: 'player_decision', responsibilityId: 'r', decision: 'accepted' },
  ];
  f.snapshot.viewState.decisions.push({
    id: 'd',
    responsibilityId: 'r',
    responsibilityRevision: 1,
    kind: 'accepted',
    sourceId: 's',
    quote: '去',
  });
  assert.equal(run(f).status, 'waiting');
  f.snapshot.viewState.decisions[0]!.responsibilityRevision = 2;
  assert.equal(run(f).status, 'ready');
  f.proposal.decisions.push({
    id: 'no',
    responsibilityId: 'r',
    kind: 'declined',
    sourceId: 'input',
    quote: '不去了',
  });
  assert.equal(run(f).status, 'waiting');
  f.action.preconditions = [
    { kind: 'player_decision', responsibilityId: 'r', decision: 'declined' },
  ];
  assert.equal(run(f).status, 'ready');
});
test('changed responsibility invalidates acceptance of its earlier version', () => {
  const f = fixture();
  f.action.preconditions = [
    { kind: 'player_decision', responsibilityId: 'r', decision: 'accepted' },
  ];
  f.snapshot.viewState.decisions.push({
    id: 'd',
    responsibilityId: 'r',
    responsibilityRevision: 2,
    kind: 'accepted',
    sourceId: 's',
    quote: '去',
  });
  f.proposal.responsibilities.push({
    ...f.snapshot.viewState.responsibilities[0]!,
    summary: '改成另一件事',
  });
  assert.equal(run(f).status, 'waiting');
});
test('hidden linked plans block without returning their private conditions', () => {
  const f = fixture();
  addPlan(f);
  f.snapshot.state.plans = structuredClone(f.proposal.plans);
  f.proposal.plans = [];
  const result = run(f);
  assert.deepEqual(result, { status: 'blocked', missing: [{ code: 'hidden_state' }] });
});
test('hidden action, goal, responsibility and dependency cannot be reintroduced', () => {
  for (const id of ['a', 'g', 'r', 'dependency']) {
    const f = fixture();
    addDependency(f);
    f.action.handlesResponsibilityIds = ['r'];
    f.snapshot.redactedStateIds = [id];
    assert.equal(run(f).status, 'blocked', id);
  }
});
test('terminal persisted action and goal cannot be reopened by a proposal', () => {
  const f = fixture();
  f.snapshot.state.actions.push({ ...f.action, status: 'succeeded' });
  assert.equal(run(f).status, 'blocked');
  f.snapshot.state.actions = [];
  f.snapshot.state.goals[0]!.status = 'fulfilled';
  f.proposal.goals.push({ ...f.snapshot.viewState.goals[0]!, status: 'active' });
  assert.equal(run(f).status, 'blocked');
});
test('terminal responsibility cannot be handled again; indefinite waiting does not expire', () => {
  const f = fixture();
  f.action.handlesResponsibilityIds = ['r'];
  f.context.storyAt = '2027-10-15T10:00:00Z';
  assert.equal(run(f).status, 'ready');
  f.snapshot.state.responsibilities[0]!.status = 'fulfilled';
  assert.equal(run(f).status, 'blocked');
});
test('future sources, unavailable bases and invalid snapshot fail closed', () => {
  const f = fixture();
  f.snapshot.sources[0]!.worldVersion = 5;
  assert.equal(run(f).status, 'blocked');
  f.snapshot.sources[0]!.worldVersion = 0;
  f.snapshot.sources[0]!.at = '2026-10-15T12:00:00Z';
  assert.equal(run(f).status, 'blocked');
  f.snapshot.viewState.actorId = 'other';
  assert.equal(run(f).missing[0]!.code, 'invalid_snapshot');
});

test('hidden result evidence cannot satisfy an otherwise visible dependency', () => {
  const f = fixture();
  addDependency(f);
  f.context.trustedResults = [{ ...receipt(), evidenceSourceIds: ['private-secret'] }];
  assert.equal(run(f).status, 'waiting');
});
test('proposal cannot reopen a terminal responsibility to reuse its decision', () => {
  const f = fixture();
  f.snapshot.state.responsibilities[0]!.status = 'fulfilled';
  f.action.preconditions = [
    { kind: 'player_decision', responsibilityId: 'r', decision: 'accepted' },
  ];
  f.proposal.responsibilities.push({ ...f.snapshot.viewState.responsibilities[0]! });
  f.proposal.decisions.push({
    id: 'd',
    responsibilityId: 'r',
    kind: 'accepted',
    sourceId: 'input',
    quote: '去',
  });
  assert.equal(run(f).status, 'waiting');
});
