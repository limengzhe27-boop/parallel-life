import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  authorizedAgentState,
  reduceActorAgentState,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { actorStateContextPayload } from '../src/modules/world/application/agent-state-context.ts';

const at = '2026-10-15T08:00:00.000Z';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 5);
  state.questions = [
    {
      id: 'q',
      sourceId: 'question-source',
      text: '你想几点见？',
      askedAt: at,
      status: 'open',
      channel: 'group',
      threadId: 'g',
      responsibilityId: 'r',
    },
  ];
  state.responsibilities = [
    {
      id: 'r',
      subject: { kind: 'appointment', id: 'dinner' },
      summary: '晚餐邀请',
      sourceIds: ['question-source'],
      status: 'waiting',
      waitingOn: 'player',
      nextCheck: [],
    },
  ];
  state.focus = {
    channel: 'group',
    threadId: 'g',
    subjectId: 'r',
    questionSourceId: 'question-source',
    replyToActorId: 'a',
  };
  const context: AgentValidationContext = {
    state,
    worldVersion: 5,
    storyAt: at,
    sources: [
      { id: 'question-source', kind: 'group_message', recordId: 'm', at, worldVersion: 3 },
      { id: 'input', kind: 'accepted_input', recordId: 'input', at, worldVersion: 5 },
    ],
    input: { sourceId: 'input', text: '今天天气如何？', origin: 'player' },
    channel: { kind: 'group', threadId: 'g', allowedCapabilities: [] },
  };
  const proposal: AgentProposal = {
    statements: [{ text: '看起来不错。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };
  return { context, proposal };
}

for (const relation of ['unrelated', 'defer_answer', 'uncertain'] as const)
  test(`${relation} persists the original question, focus and appointment responsibility`, () => {
    const { context, proposal } = fixture();
    proposal.replyAssessments = [
      { questionId: 'q', sourceId: 'input', quote: context.input.text, relation },
    ];
    const result = reduceActorAgentState(context, parseAgentProposal(context, proposal), [], 6);
    assert.equal(result.state.questions?.[0]?.status, 'open');
    assert.deepEqual(result.state.responsibilities, context.state.responsibilities);
    assert.deepEqual(result.state.focus, context.state.focus);
    assert.equal(result.questionChanges[0]?.relation, relation);
  });

for (const relation of ['answer', 'decline_to_answer'] as const)
  test(`${relation} closes only the question and never confirms attendance or commitment`, () => {
    const { context, proposal } = fixture();
    context.input.text = '六点吧';
    proposal.replyAssessments = [{ questionId: 'q', sourceId: 'input', quote: '六点', relation }];
    const result = reduceActorAgentState(context, parseAgentProposal(context, proposal), [], 6);
    assert.equal(result.state.questions?.[0]?.status, 'answered');
    assert.deepEqual(result.state.responsibilities, context.state.responsibilities);
    assert.deepEqual(result.state.decisions, []);
  });

test('question source visibility is independent of conversation focus and blocks redacted mutation', () => {
  const { context, proposal } = fixture();
  const authorized = authorizedAgentState(context.state, new Set(['input']));
  assert.deepEqual(authorized.viewState.questions, []);
  assert.ok(authorized.redactedStateIds.includes('q'));
  context.viewState = authorized.viewState;
  proposal.replyAssessments = [
    { questionId: 'q', sourceId: 'input', quote: context.input.text, relation: 'answer' },
  ];
  assert.throws(() => parseAgentProposal(context, proposal), /QUESTION_SOURCE_NOT_AUTHORIZED/);
});

test('another channel cannot answer a question or remove it merely by changing topic focus', () => {
  const { context, proposal } = fixture();
  context.channel = { kind: 'private', threadId: 'a', allowedCapabilities: [] };
  proposal.focus = {
    channel: 'private',
    threadId: 'a',
    subjectId: null,
    questionSourceId: null,
    replyToActorId: null,
  };
  const quiet = reduceActorAgentState(context, proposal, [], 6);
  assert.equal(quiet.state.questions?.[0]?.status, 'open');
  proposal.replyAssessments = [
    { questionId: 'q', sourceId: 'input', quote: context.input.text, relation: 'answer' },
  ];
  assert.throws(() => parseAgentProposal(context, proposal), /CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED/);
});

test('withdrawal is a sourced personal choice, never a player decision or fabricated result', () => {
  const { context, proposal } = fixture();
  proposal.questionWithdrawals = [
    { questionId: 'q', sourceIds: ['input'], reason: '我重新安排自己的晚餐' },
  ];
  const result = reduceActorAgentState(context, parseAgentProposal(context, proposal), [], 6);
  assert.equal(result.state.questions?.[0]?.status, 'withdrawn');
  assert.equal(result.state.responsibilities[0]?.status, 'waiting');
  assert.deepEqual(result.state.decisions, []);
  assert.equal(result.questionChanges[0]?.relation, 'withdrawal');
});

test('question metadata carries continuity while cross-channel private quotes remain withheld', () => {
  const { context } = fixture();
  const q = context.state.questions![0]!;
  q.status = 'answered';
  q.resolution = {
    sourceId: 'private-answer',
    at,
    kind: 'answer',
    quote: 'PRIVATE_REPLY',
    reason: 'PRIVATE_REASON',
  };
  const projected = actorStateContextPayload(context.state, {
    privateStrategySourceIds: new Set(['question-source', 'private-answer']),
  });
  const value = JSON.stringify(projected);
  assert.equal(projected.questions?.[0]?.text, '');
  assert.equal(projected.questions?.[0]?.status, 'answered');
  for (const secret of ['你想几点见', 'PRIVATE_REPLY', 'PRIVATE_REASON'])
    assert.equal(value.includes(secret), false);
});

test('a model cannot inject stored question IDs or reference an unowned responsibility', () => {
  const { context, proposal } = fixture();
  assert.throws(() => parseAgentProposal(context, { ...proposal, questions: [] }));
  proposal.statements[0] = {
    text: '你呢？',
    dependsOnActionIds: [],
    requestsPlayerReply: true,
    questionForResponsibilityId: 'other-actor-request',
  };
  assert.throws(() => parseAgentProposal(context, proposal), /UNKNOWN_QUESTION_RESPONSIBILITY/);
});
