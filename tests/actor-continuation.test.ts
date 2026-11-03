import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorContinuationBasis,
  retireActorContinuation,
  validateActorContinuation,
} from '../src/modules/world/domain/actor-continuation.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 0);
  const context: AgentValidationContext = {
    state,
    worldVersion: 0,
    storyAt: '2026-10-20T00:00:00Z',
    input: { sourceId: 'input', text: '', origin: 'wake' },
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 0,
        at: '2026-10-20T00:00:00Z',
      },
    ],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
  };
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
    continuation: {
      decision: 'no_current_intent',
      reason: 'No relevant change',
      sourceIds: ['input'],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  };
  return { state, context, proposal };
}
test('quiet itself, clock, revision and focus do not create personal reconsideration evidence', () => {
  const { state } = fixture();
  const before = actorContinuationBasis(state);
  state.revision++;
  state.projectedWorldVersion++;
  state.focus = {
    channel: 'private',
    threadId: 'other',
    subjectId: null,
    questionSourceId: null,
    replyToActorId: null,
  };
  assert.equal(actorContinuationBasis(state), before);
  state.knowledgeSourceIds.push('new-visible-fact');
  assert.notEqual(actorContinuationBasis(state), before);
});
test('continuation cannot cite foreign plans/questions or invent deadlines and locations', () => {
  const { context, proposal } = fixture();
  validateActorContinuation(context, proposal);
  for (const delta of [
    { sourceIds: ['hidden'] },
    { planIds: ['foreign'] },
    { questionIds: ['foreign'] },
    { conditions: [{ kind: 'at_place', placeId: 'unknown' }] },
    { decision: 'await_condition' },
    { decision: 'act' },
    { conditions: [{ kind: 'at_or_after', sourceId: 'input', at: '2026-10-20T02:00:00Z' }] },
  ]) {
    assert.throws(
      () =>
        validateActorContinuation(context, {
          ...proposal,
          continuation: { ...proposal.continuation!, ...delta } as any,
        }),
      /INVALID_ACTOR_CONTINUATION/,
    );
  }
});
test('source-backed observation may be awaited without manufacturing an obligation', () => {
  const { context, proposal } = fixture();
  proposal.continuation!.decision = 'await_condition';
  proposal.continuation!.conditions = [{ kind: 'observation', sourceId: 'input' }];
  validateActorContinuation(context, proposal);
  assert.equal(proposal.goals.length, 0);
  assert.equal(proposal.statements.length, 0);
});

test('ordinary conversational waiting needs no new question and changes no existing state', () => {
  const { context, proposal } = fixture();
  proposal.continuation!.decision = 'await_response';
  proposal.statements = [
    { text: '嗯，我在听。', dependsOnActionIds: [], requestsPlayerReply: false },
  ];
  const before = JSON.stringify(context.state);
  validateActorContinuation(context, proposal);
  assert.equal(JSON.stringify(context.state), before);
  assert.deepEqual(proposal.continuation!.questionIds, []);
  for (const delta of [
    { questionIds: ['missing'] },
    { planIds: ['missing'] },
    { sourceIds: ['hidden'] },
  ]) {
    assert.throws(
      () =>
        validateActorContinuation(context, {
          ...proposal,
          continuation: { ...proposal.continuation!, ...delta },
        }),
      /INVALID_ACTOR_CONTINUATION/,
    );
  }
});

test('legacy independent waits become one ordinary plan without a duplicate goal', () => {
  const { state, proposal } = fixture();
  state.continuation = {
    ...proposal.continuation!,
    decision: 'await_condition',
    conditions: [{ kind: 'observation', sourceId: 'input' }],
    version: 1,
    decidedAt: '2026-10-20T00:00:00Z',
    sourceInputId: 'input',
    basisHash: 'basis',
  };
  const old = structuredClone(state);
  const next = retireActorContinuation(state);
  assert.equal(next.continuation, undefined);
  assert.equal(next.goals.length, 0);
  assert.equal(next.plans.length, 1);
  assert.equal(next.plans[0]!.goalId, null);
  assert.deepEqual(next.plans[0]!.triggers, old.continuation!.conditions);
  assert.deepEqual(state, old);
  assert.deepEqual(retireActorContinuation(next), next);
  // A historical duplicate does not create another live wait or revive a closed one.
  assert.equal(
    retireActorContinuation({ ...next, continuation: old.continuation }).plans.length,
    1,
  );
  next.plans[0]!.status = 'finished';
  assert.equal(
    retireActorContinuation({ ...next, continuation: old.continuation }).plans[0]!.status,
    'finished',
  );
});
test('quiet and awaiting a reply do not manufacture plans during retirement', () => {
  const { state, proposal } = fixture();
  for (const decision of ['no_current_intent', 'await_response'] as const) {
    state.continuation = {
      ...proposal.continuation!,
      decision,
      version: 1,
      decidedAt: '2026-10-20T00:00:00Z',
      sourceInputId: 'input',
      basisHash: 'basis',
    };
    const next = retireActorContinuation(state);
    assert.equal(next.continuation, undefined);
    assert.deepEqual(next.plans, []);
    assert.deepEqual(next.responsibilities, state.responsibilities);
  }
});
