import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorContinuationBasis,
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
