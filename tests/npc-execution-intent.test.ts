import test from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { AgentProposalSchema } from '../src/modules/world/infrastructure/agent-proposal-schema.ts';
import {
  compileNpcExecutionIntents,
  NativeExecutionIntentSchema,
  nativeExecutionIntentIds,
} from '../src/modules/world/infrastructure/npc-execution-intent.ts';
function fixture(): AgentValidationContext {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 3);
  return {
    state,
    viewState: structuredClone(state),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: { sourceId: 'input', text: 'Arrange a meeting', origin: 'player' },
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 3,
        at: '2026-10-19T10:00:00.000Z',
      },
    ],
    channel: {
      kind: 'private',
      threadId: 'actor',
      allowedCapabilities: ['appointment.propose', 'media.generate_image'],
    },
  };
}
function intent() {
  return {
    ref: 'invite',
    goal: { kind: 'new', summary: 'Meet', sourceIds: ['input'] },
    plan: { summary: 'Offer meeting', sourceIds: ['input'] },
    action: {
      capability: 'appointment.propose',
      targetIds: ['actor'],
      parameters: [
        { name: 'title', value: 'Meet' },
        { name: 'at', value: '2026-10-19T12:00:00.000Z' },
      ],
      preconditions: [],
      dependsOnActionIds: [],
      handlesResponsibilityIds: [],
      sourceIds: ['input'],
    },
  };
}
test('explicit compact intent binds stable ids and canonical proposal only, preserving input/state', () => {
  const c = fixture(),
    before = structuredClone(c);
  const compiled = compileNpcExecutionIntents(c, [intent()]);
  const e = compiled.executions[0]!;
  assert.equal(e.action.id, compiled.actionIdsByRef.invite);
  assert.equal(e.action.parameters.title, 'Meet');
  const proposal = {
    statements: [],
    goals:
      e.goal.kind === 'new'
        ? [{ ...e.goal, status: 'active', resultIds: [] }].map(({ kind, ...g }) => g)
        : [],
    plans: [
      {
        ...e.plan,
        goalId: e.goal.id,
        status: 'active',
        actionIds: [e.action.id],
        nextActionId: e.action.id,
        triggers: [],
        missingConditions: [],
      },
    ],
    actions: [{ ...e.action, goalId: e.goal.id, status: 'proposed' }],
    responsibilities: [],
    decisions: [],
  };
  assert.ok(AgentProposalSchema.safeParse(proposal).success);
  assert.deepEqual(c, before);
  assert.deepEqual(
    compileNpcExecutionIntents({ ...c, worldVersion: 7 }, [intent()]).executions,
    compiled.executions,
  );
  assert.notEqual(
    nativeExecutionIntentIds({ ...c, input: { ...c.input, sourceId: 'another' } }, 'invite')
      .actionId,
    e.action.id,
  );
  assert.notEqual(
    nativeExecutionIntentIds({ ...c, state: { ...c.state, actorId: 'other' } }, 'invite').actionId,
    e.action.id,
  );
});
test('empty is empty; duplicate ref, fake result and invented id fields are rejected', () => {
  assert.deepEqual(compileNpcExecutionIntents(fixture(), []).executions, []);
  assert.throws(() => compileNpcExecutionIntents(fixture(), [intent(), intent()]), /DUPLICATE_REF/);
  for (const extra of [{ id: 'a' }, { resultId: 'fake' }, { status: 'succeeded' }]) {
    const i = intent();
    Object.assign(i.action, extra);
    assert.throws(() => compileNpcExecutionIntents(fixture(), [i]), /SHAPE/);
  }
});
test('sources must all be legal, unique and include current input in each basis', () => {
  for (const field of ['goal', 'plan', 'action'] as const) {
    for (const sourceIds of [[], ['input', 'input'], ['unknown'], ['input', 'unknown']]) {
      const i = intent();
      i[field].sourceIds = sourceIds;
      assert.throws(() => compileNpcExecutionIntents(fixture(), [i]), /SOURCE|SHAPE/);
    }
  }
  const c = fixture();
  c.sources.push({ ...c.sources[0]! });
  assert.throws(() => compileNpcExecutionIntents(c, [intent()]), /SOURCE/);
});
test('media and unadvertised capabilities are rejected; parameters cannot duplicate', () => {
  for (const capability of ['media.generate_image', 'item.deliver', 'plan.record']) {
    const i = intent();
    i.action.capability = capability;
    assert.throws(() => compileNpcExecutionIntents(fixture(), [i]), /CAPABILITY/);
  }
  const i = intent();
  i.action.parameters.push({ name: 'title', value: 'another' });
  assert.throws(() => compileNpcExecutionIntents(fixture(), [i]), /PARAMETERS/);
});
test('existing goal and superseded plan must be visible and share goal', () => {
  const c = fixture();
  const goal = {
    id: 'g',
    summary: 'goal',
    status: 'active' as const,
    sourceIds: ['input'],
    resultIds: [],
  };
  c.state.goals.push(goal);
  const i = {
    ...intent(),
    goal: { kind: 'existing', id: 'g' },
    plan: { ...intent().plan, supersedesPlanId: 'p' },
  };
  assert.throws(() => compileNpcExecutionIntents(c, [i]), /GOAL/);
  c.viewState!.goals.push(goal);
  assert.throws(() => compileNpcExecutionIntents(c, [i]), /SUPERSEDES/);
  c.viewState!.plans.push({
    id: 'p',
    goalId: 'other',
    summary: 'old',
    sourceIds: ['input'],
    status: 'active',
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  });
  assert.throws(() => compileNpcExecutionIntents(c, [i]), /SUPERSEDES/);
  c.viewState!.plans[0]!.goalId = 'g';
  assert.equal(compileNpcExecutionIntents(c, [i]).executions[0]!.plan.supersedesPlanId, 'p');
});
test('hidden authoritative IDs cannot be overwritten by generated identifiers', () => {
  const c = fixture(),
    ids = nativeExecutionIntentIds(c, 'invite');
  c.state.goals.push({
    id: ids.planId,
    summary: 'hidden',
    sourceIds: ['hidden'],
    status: 'active',
    resultIds: [],
  });
  assert.throws(() => compileNpcExecutionIntents(c, [intent()]), /ID_CONFLICT/);
});
test('action and condition dependencies may name only existing visible state, never local refs', () => {
  const c = fixture();
  for (const id of ['invite', 'not-seen']) {
    const i = intent();
    Object.assign(i.action, { dependsOnActionIds: [id] });
    assert.throws(() => compileNpcExecutionIntents(c, [i]), /DEPENDENCY/);
  }
  const prior = {
    id: 'old',
    goalId: 'g',
    capability: 'appointment.propose',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['input'],
    status: 'succeeded' as const,
  };
  c.state.actions.push(prior);
  const i = intent();
  Object.assign(i.action, {
    dependsOnActionIds: ['old'],
    preconditions: [{ kind: 'result', actionId: 'old', outcome: 'succeeded' }],
  });
  assert.throws(() => compileNpcExecutionIntents(c, [i]), /DEPENDENCY/);
  c.viewState!.actions.push(prior);
  assert.equal(
    compileNpcExecutionIntents(c, [i]).executions[0]!.action.dependsOnActionIds[0],
    'old',
  );
});
test('responsibility refs and condition sources cannot reach hidden state', () => {
  for (const fields of [
    { handlesResponsibilityIds: ['hidden'] },
    {
      preconditions: [
        { kind: 'player_decision', responsibilityId: 'hidden', decision: 'accepted' },
      ],
    },
    { preconditions: [{ kind: 'observation', sourceId: 'hidden' }] },
    {
      preconditions: [{ kind: 'at_or_after', at: '2026-10-19T12:00:00.000Z', sourceId: 'hidden' }],
    },
  ]) {
    const i = intent();
    Object.assign(i.action, fields);
    assert.throws(() => compileNpcExecutionIntents(fixture(), [i]), /RESPONSIBILITY|SOURCE/);
  }
});

// Strict-provider transport sends required optional properties as null.
test('nullable supersedes compiles as absent and reserved dependency namespaces cannot be local refs', () => {
  const i = { ...intent(), plan: { ...intent().plan, supersedesPlanId: null } };
  assert.equal(
    compileNpcExecutionIntents(fixture(), [i]).executions[0]!.plan.supersedesPlanId,
    undefined,
  );
  for (const ref of ['execution:invite', 'media:current'])
    assert.throws(() => compileNpcExecutionIntents(fixture(), [{ ...intent(), ref }]), /SHAPE/);
});

test('intent schema remains JSON-schema exportable', () => {
  assert.doesNotThrow(() => z.toJSONSchema(NativeExecutionIntentSchema));
});
