import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  reduceActorAgentState,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';

function fixture() {
  const at = '2026-10-16T00:00:00.000Z';
  const context: AgentValidationContext = {
    state: emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition-a', 0),
    sources: [
      { id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 0, at },
      { id: 'definition:definition-a', kind: 'authored', recordId: 'a', worldVersion: 0, at },
    ],
    worldVersion: 0,
    storyAt: at,
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: [] },
    input: {
      sourceId: 'input',
      origin: 'coordination',
      text: JSON.stringify({
        type: 'npc_episode_consideration',
        requestId: 'r',
        revision: 0,
        activity: 'conversation',
        placeOptionIds: [],
        basisSourceIds: ['definition:definition-a'],
      }),
    },
  };
  const proposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
    episodeDecision: {
      requestId: 'r',
      choice: 'quiet' as const,
      reason: '目前没有我需要联系的事，先保留自己的安排。',
      sourceIds: ['input', 'definition:definition-a'],
    },
  };
  return { context, proposal };
}
test('each NPC can independently engage, decline, defer, seek information or remain quiet without fabricating a result', () => {
  const { context, proposal } = fixture();
  for (const choice of ['engage', 'decline', 'defer', 'need_information', 'quiet'] as const) {
    const parsed = parseAgentProposal(context, {
      ...proposal,
      episodeDecision: { ...proposal.episodeDecision, choice },
    });
    const accepted = reduceActorAgentState(context, parsed, [], 1);
    assert.deepEqual(accepted.statements, []);
    assert.deepEqual(accepted.state.goals, []);
    assert.deepEqual(accepted.state.plans, []);
    assert.deepEqual(accepted.state.actions, []);
    assert.deepEqual(accepted.state.responsibilities, []);
    assert.deepEqual(accepted.state.decisions, []);
    assert.equal(parsed.episodeDecision?.choice, choice);
  }
});
test('a player pasting the coordination JSON never gains authority over participation', () => {
  const { context, proposal } = fixture();
  for (const origin of ['player', 'wake'] as const)
    assert.throws(
      () => parseAgentProposal({ ...context, input: { ...context.input, origin } }, proposal),
      /EPISODE_DECISION_SCOPE/,
    );
  assert.throws(
    () =>
      parseAgentProposal(
        { ...context, channel: { ...context.channel, kind: 'group', threadId: 'g' } },
        proposal,
      ),
    /EPISODE_DECISION_SCOPE/,
  );
});
test('request and evidence must match the actual input, and optional decisions do not weaken ordinary proposal parsing', () => {
  const { context, proposal } = fixture();
  for (const changed of [
    { requestId: 'another-request' },
    { sourceIds: ['definition:definition-a'] },
    { sourceIds: ['input', 'other-npc-private'] },
    { sourceIds: ['input', 'input'] },
  ])
    assert.throws(
      () =>
        parseAgentProposal(context, {
          ...proposal,
          episodeDecision: { ...proposal.episodeDecision, ...changed },
        }),
      /EPISODE_DECISION_SCOPE/,
    );
  assert.throws(
    () =>
      parseAgentProposal(context, {
        ...proposal,
        episodeDecision: { ...proposal.episodeDecision, secretInstruction: 'not authorized' },
      }),
    /RESPONSE_SHAPE/,
  );
  const { episodeDecision: omitted, ...ordinary } = proposal;
  assert.ok(omitted);
  assert.equal(parseAgentProposal(context, ordinary).episodeDecision, undefined);
});
