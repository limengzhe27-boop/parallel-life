import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  validateAgentProposal,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { AgentProposalSchema } from '../src/modules/world/infrastructure/agent-proposal-schema.ts';
import {
  compileNpcPlanIntents,
  nativePlanIntentIds,
  NativePlanIntentSchema,
} from '../src/modules/world/infrastructure/npc-plan-intent.ts';
import { nativeExecutionIntentIds } from '../src/modules/world/infrastructure/npc-execution-intent.ts';
function fixture(): AgentValidationContext {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 3);
  return {
    state,
    viewState: structuredClone(state),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: { sourceId: 'input', text: 'Consider later', origin: 'player' },
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 3,
        at: '2026-10-19T10:00:00.000Z',
      },
    ],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
  };
}
function create() {
  return {
    kind: 'create',
    ref: 'plan_1',
    goal: { kind: 'new', summary: 'An explicit future intention', sourceIds: ['input'] },
    summary: 'Wait for a real reply',
    sourceIds: ['input'],
    nextStep: { kind: 'wait', conditions: [], missing: ['The player has not decided.'] },
  };
}
function existing(c = fixture()) {
  c.state.goals.push({
    id: 'g',
    summary: 'Existing intention',
    status: 'active',
    sourceIds: ['input'],
    resultIds: [],
  });
  c.state.plans.push({
    id: 'p',
    goalId: 'g',
    summary: 'Existing wait',
    status: 'waiting',
    sourceIds: ['input'],
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: ['Await reply'],
  });
  c.viewState = structuredClone(c.state);
  return c;
}
function update() {
  return {
    kind: 'update',
    planId: 'p',
    summary: 'Continue waiting',
    sourceIds: ['input'],
    nextStep: { kind: 'blocked', missing: ['Unknown destination'] },
  };
}
function rejects(c: AgentValidationContext, intents: unknown, reason?: string) {
  assert.throws(
    () => compileNpcPlanIntents(c, intents),
    reason ? { reason } : { code: 'INVALID_PROPOSAL' },
  );
}
test('explicit new goal and non-executing plan compile deterministically and pass the original kernel', () => {
  const c = fixture(),
    before = structuredClone(c),
    input = create();
  const compiled = compileNpcPlanIntents(c, [input]);
  assert.deepEqual(c, before);
  assert.deepEqual(compiled, compileNpcPlanIntents(c, [input]));
  assert.equal(compiled.goals.length, 1);
  assert.equal(compiled.plans[0]!.goalId, compiled.goals[0]!.id);
  assert.deepEqual(compiled.goals[0]!.resultIds, []);
  assert.deepEqual(compiled.plans[0]!.actionIds, []);
  const proposal = AgentProposalSchema.parse({
    statements: [{ text: 'I need to think about the next arrangement.', dependsOnActionIds: [] }],
    ...compiled,
    actions: [],
    responsibilities: [],
    decisions: [],
  });
  validateAgentProposal(c, proposal);
  assert.notEqual(
    nativePlanIntentIds(c, 'plan_1').planId,
    nativeExecutionIntentIds(c, 'plan_1').planId,
  );
  assert.notEqual(
    nativePlanIntentIds(c, 'plan_1').planId,
    nativePlanIntentIds({ ...c, input: { ...c.input, sourceId: 'other' } }, 'plan_1').planId,
  );
});
test('existing goals are referenced explicitly; omitted goal is inferred from the plan', () => {
  const c = existing(),
    intent = { ...create(), goal: { kind: 'existing', id: 'g' } };
  const r = compileNpcPlanIntents(c, [intent]);
  assert.deepEqual(r.goals, []);
  assert.equal(r.plans[0]!.goalId, 'g');
  rejects(c, [{ ...intent, goal: { kind: 'existing', id: 'goal_1' } }]);
  const absent = { ...create() } as any;
  delete absent.goal;
  const inferred = compileNpcPlanIntents(c, [absent]);
  assert.equal(inferred.goals.length, 1);
  assert.equal(inferred.goals[0]!.summary, absent.summary);
  assert.equal(inferred.plans[0]!.goalId, inferred.goals[0]!.id);
});
test('full-state-only and terminal goals or plans cannot be changed', () => {
  const c = existing();
  c.viewState!.goals = [];
  rejects(c, [{ ...create(), goal: { kind: 'existing', id: 'g' } }]);
  rejects(c, [update()]);
  c.viewState = structuredClone(c.state);
  c.viewState!.plans = [];
  rejects(c, [update()]);
  for (const status of ['fulfilled', 'withdrawn'] as const) {
    c.viewState = structuredClone(c.state);
    c.viewState!.goals[0]!.status = status;
    rejects(c, [update()]);
  }
  for (const status of ['finished', 'withdrawn'] as const) {
    c.viewState = structuredClone(c.state);
    c.viewState!.plans[0]!.status = status;
    rejects(c, [update()]);
  }
});
test('replace binds the old goal and records supersession without creating another goal', () => {
  const c = existing(),
    r = compileNpcPlanIntents(c, [{ ...update(), kind: 'replace', ref: 'replacement' }]);
  assert.deepEqual(r.goals, []);
  assert.equal(r.plans[0]!.goalId, 'g');
  assert.equal(r.plans[0]!.supersedesPlanId, 'p');
  assert.notEqual(r.plans[0]!.id, 'p');
  validateAgentProposal(
    c,
    AgentProposalSchema.parse({
      statements: [{ text: 'I need to think about the next arrangement.', dependsOnActionIds: [] }],
      ...r,
      actions: [],
      responsibilities: [],
      decisions: [],
    }),
  );
  rejects(c, [
    {
      ...update(),
      kind: 'replace',
      ref: 'replacement',
      goal: { kind: 'new', summary: 'Other', sourceIds: ['input'] },
    },
  ]);
});
test('update and close preserve identity, history, completed child evidence and never complete goals', () => {
  const c = existing();
  c.state.plans[0]!.supersedesPlanId = 'historical';
  c.viewState = structuredClone(c.state);
  const updated = compileNpcPlanIntents(c, [update()]);
  assert.equal(updated.plans[0]!.id, 'p');
  assert.equal(updated.plans[0]!.goalId, 'g');
  assert.equal(updated.plans[0]!.supersedesPlanId, 'historical');
  for (const status of ['finished', 'withdrawn']) {
    const closed = compileNpcPlanIntents(c, [
      { kind: 'close', planId: 'p', status, reason: 'Own plan changed', sourceIds: ['input'] },
    ]);
    assert.deepEqual(closed.goals, []);
    assert.equal(closed.plans[0]!.status, status);
    assert.equal(closed.plans[0]!.supersedesPlanId, 'historical');
    assert.equal(closed.plans[0]!.nextActionId, null);
  }
});
test('in-flight or hidden child actions cannot be silently erased; explicit replace retires only unexecuted children in the original kernel', () => {
  const c = existing();
  const action = {
    id: 'a',
    goalId: 'g',
    capability: 'plan.record',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['input'],
    status: 'ready' as const,
  };
  c.state.actions.push(action);
  c.state.plans[0]!.actionIds = ['a'];
  c.state.plans[0]!.nextActionId = 'a';
  c.viewState = structuredClone(c.state);
  rejects(c, [update()], 'NPC_PLAN_INTENT_UNFINISHED_ACTION');
  rejects(c, [
    { kind: 'close', planId: 'p', status: 'withdrawn', reason: 'Changed', sourceIds: ['input'] },
  ]);
  assert.equal(
    compileNpcPlanIntents(c, [{ ...update(), kind: 'replace', ref: 'r' }]).plans[0]!
      .supersedesPlanId,
    'p',
  );
  c.viewState!.actions[0]!.status = 'executing';
  rejects(c, [{ ...update(), kind: 'replace', ref: 'r' }]);
  c.viewState!.actions = [];
  rejects(c, [{ ...update(), kind: 'replace', ref: 'r' }]);
});
test('duplicate refs, duplicate target changes, ID collisions and unknown keys are rejected', () => {
  const c = existing(),
    a = create();
  rejects(c, [a, a], 'NPC_PLAN_INTENT_DUPLICATE_REF');
  rejects(
    c,
    [update(), { ...update(), kind: 'replace', ref: 'r' }],
    'NPC_PLAN_INTENT_DUPLICATE_TARGET',
  );
  rejects(c, [{ ...a, goalId: 'invented' }]);
  rejects(c, [{ ...update(), extra: 'value' }]);
  c.state.goals[0]!.id = nativePlanIntentIds(c, 'plan_1').planId;
  rejects(c, [a], 'NPC_PLAN_INTENT_ID_CONFLICT');
});
test('sources must uniquely authorize the current input, goal intent and trigger references', () => {
  const c = fixture();
  rejects(c, [{ ...create(), sourceIds: ['unknown'] }]);
  rejects(c, [{ ...create(), goal: { ...create().goal, sourceIds: ['unknown'] } }]);
  rejects(c, [{ ...create(), sourceIds: ['input', 'input'] }]);
  rejects(c, [
    {
      ...create(),
      nextStep: {
        kind: 'reconsider',
        conditions: [{ kind: 'observation', sourceId: 'unknown' }],
        missing: [],
      },
    },
  ]);
  rejects(c, [
    {
      ...create(),
      nextStep: {
        kind: 'reconsider',
        conditions: [{ kind: 'result', actionId: 'unknown', outcome: 'succeeded' }],
        missing: [],
      },
    },
  ]);
  c.sources.push(c.sources[0]!);
  rejects(c, [create()]);
});
test('nonexecuting next steps are explicit and cannot smuggle actions, completion or missing semantics', () => {
  const c = fixture();
  for (const nextStep of [
    { kind: 'action', actionId: 'invented' },
    { kind: 'closed', status: 'finished', reason: 'Done' },
    { kind: 'wait', conditions: [], missing: [] },
    { kind: 'reconsider', conditions: [], missing: [] },
  ])
    rejects(c, [{ ...create(), nextStep }]);
  assert.equal(
    NativePlanIntentSchema.safeParse({
      ...create(),
      nextStep: { kind: 'blocked', missing: ['No verified location.'] },
    }).success,
    true,
  );
  rejects(c, null);
  rejects(c, [{ ...create(), goal: null }]);
});

test('foreign visible identity and undocumented nullable semantics are rejected', () => {
  const c = existing();
  c.viewState!.actorId = 'another-actor';
  rejects(c, [create()], 'NPC_PLAN_INTENT_SCOPE');
  const a = create();
  rejects(fixture(), [{ ...a, sourceIds: null }]);
  rejects(fixture(), [{ ...a, nextStep: null }]);
});
