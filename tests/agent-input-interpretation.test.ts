import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  playerReplyTargets,
  bindPlayerInputInterpretation,
  type PlayerInputInterpretation,
} from '../src/modules/world/domain/agent-input-interpretation.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';

function fixture() {
  const at = '2026-10-18T10:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 0);
  state.responsibilities = [
    {
      id: 'budget',
      subject: { kind: 'request', id: 'budget' },
      summary: '等玩家确认预算',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['question-source'],
      nextCheck: [],
      revision: 2,
    },
  ];
  state.questions = [
    {
      id: 'budget-question',
      channel: 'private',
      threadId: 'actor',
      sourceId: 'question-source',
      text: '预算多少？',
      askedAt: at,
      status: 'open',
      responsibilityId: 'budget',
    },
  ];
  const context: AgentValidationContext = {
    state,
    worldVersion: 0,
    storyAt: at,
    input: { origin: 'player', sourceId: 'current-input', text: '预算确认500元。' },
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
    sources: [
      { id: 'question-source', kind: 'accepted_input', recordId: 'original', worldVersion: 0, at },
      { id: 'current-input', kind: 'accepted_input', recordId: 'current', worldVersion: 0, at },
    ],
  };
  const scope = {
    state,
    input: context.input,
    channel: context.channel,
    authorizedSourceIds: new Set(context.sources.map((s) => s.id)),
  };
  const reply = {
    ...playerReplyTargets(scope)[0]!,
    relation: 'answer' as const,
    decision: 'accepted' as const,
  };
  const interpretation: PlayerInputInterpretation = {
    kind: 'related_reply',
    sourceId: context.input.sourceId,
    quote: context.input.text,
    replies: [reply],
  };
  const native = (inputInterpretation: PlayerInputInterpretation | null) => ({
    protocol: 'npc-wire-v5',
    consideration: null,
    statements: [{ text: '收到你的消息。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    responsibilities: [],
    executions: [],
    inputInterpretation,
  });
  return { state, context, scope, reply, interpretation, native };
}

test('one genuine player answer creates source-bound decision and question resolution together', () => {
  const { context, interpretation, native } = fixture();
  const proposal = parseAgentProposal(context, native(interpretation));
  assert.equal(proposal.decisions.length, 1);
  assert.equal(proposal.decisions[0]!.kind, 'accepted');
  assert.equal(proposal.decisions[0]!.responsibilityId, 'budget');
  assert.equal(proposal.replyAssessments?.[0]!.questionId, 'budget-question');
  assert.equal(proposal.replyAssessments?.[0]!.sourceId, proposal.decisions[0]!.sourceId);
  assert.equal(proposal.replyAssessments?.[0]!.quote, proposal.decisions[0]!.quote);
  assert.deepEqual(parseAgentProposal(context, native(interpretation)), proposal);
  assert.equal(context.state.decisions.length, 0);
  assert.equal(context.state.questions![0]!.status, 'open');
});

test('new photo request and NPC own refusal cannot supply a separate old responsibility decision', () => {
  const { context, native } = fixture();
  context.input.text = '方便给我发张日常照片吗？不方便也可以直说。';
  const value = native({
    kind: 'new_request',
    sourceId: context.input.sourceId,
    quote: context.input.text,
  });
  value.statements = [{ text: '今天不想发日常照。', dependsOnActionIds: [] }] as never[];
  const proposal = parseAgentProposal(context, value);
  assert.deepEqual(proposal.decisions, []);
  assert.deepEqual(proposal.replyAssessments, []);
  assert.equal(context.state.responsibilities[0]!.status, 'waiting');
  assert.throws(
    () =>
      parseAgentProposal(context, {
        ...value,
        decisions: [
          {
            id: 'wrong',
            responsibilityId: 'budget',
            kind: 'declined',
            sourceId: context.input.sourceId,
            quote: context.input.text,
          },
        ],
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(context, {
        ...value,
        inputInterpretation: {
          ...value.inputInterpretation,
          replies: [{ ...fixture().reply, decision: 'declined' }],
        },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
});

test('topic change and uncertain input preserve pending questions and responsibilities', () => {
  const { context, native } = fixture();
  for (const kind of ['topic_change', 'uncertain'] as const) {
    const proposal = parseAgentProposal(
      context,
      native({ kind, sourceId: context.input.sourceId, quote: context.input.text }),
    );
    assert.deepEqual(proposal.decisions, []);
    assert.deepEqual(proposal.replyAssessments, []);
  }
});

test('only original waiting-on-player responsibility can be offered; wrong channel and private source excluded', () => {
  const { state, scope } = fixture();
  state.responsibilities[0]!.waitingOn = 'self';
  assert.equal(playerReplyTargets(scope)[0]!.responsibilityId, null);
  state.responsibilities[0]!.waitingOn = 'player';
  scope.channel = { ...scope.channel, kind: 'group' };
  assert.deepEqual(playerReplyTargets(scope), []);
  scope.channel = { ...scope.channel, kind: 'private' };
  scope.authorizedSourceIds.delete('question-source');
  assert.deepEqual(playerReplyTargets(scope), []);
});

test('kernel binding rejects stale revisions, wrong source, invented target and unrelated channel', () => {
  const { context, native, interpretation, reply } = fixture();
  for (const delta of [
    { responsibilityRevision: 1 },
    { questionSourceId: 'invented' },
    { responsibilityId: 'different' },
    { questionId: 'different' },
  ]) {
    assert.throws(
      () =>
        parseAgentProposal(
          context,
          native({ ...interpretation, kind: 'related_reply', replies: [{ ...reply, ...delta }] }),
        ),
      /RESPONSE_WIRE_SHAPE/,
    );
  }
  assert.throws(
    () => parseAgentProposal(context, native({ ...interpretation, sourceId: 'old-input' })),
    /RESPONSE_WIRE_SHAPE/,
  );
  context.channel = { ...context.channel, kind: 'group', threadId: 'group' };
  assert.throws(() => parseAgentProposal(context, native(interpretation)), /RESPONSE_WIRE_SHAPE/);
});

test('refusing to answer information is not declining the underlying invitation or responsibility', () => {
  const { scope, interpretation, reply } = fixture();
  assert.throws(() =>
    bindPlayerInputInterpretation(scope, {
      ...interpretation,
      kind: 'related_reply',
      replies: [{ ...reply, relation: 'decline_to_answer', decision: 'declined' }],
    }),
  );
  const replies = bindPlayerInputInterpretation(scope, {
    ...interpretation,
    kind: 'related_reply',
    replies: [{ ...reply, relation: 'decline_to_answer', decision: null }],
  });
  assert.equal(replies[0]!.decision, null);
});

test('focus-only responsibility requires existing current-channel focus; wake has no player interpretation', () => {
  const { state, scope } = fixture();
  state.questions = [];
  assert.deepEqual(playerReplyTargets(scope), []);
  state.focus = {
    channel: 'private',
    threadId: 'actor',
    subjectId: 'budget',
    questionSourceId: null,
    replyToActorId: null,
  };
  assert.equal(playerReplyTargets(scope)[0]!.responsibilityId, 'budget');
  state.focus.questionSourceId = 'missing-original-question';
  assert.deepEqual(playerReplyTargets(scope), []);
  scope.input = { ...scope.input, origin: 'wake' };
  assert.deepEqual(bindPlayerInputInterpretation(scope, null), []);
  assert.throws(() =>
    bindPlayerInputInterpretation(scope, {
      kind: 'new_request',
      sourceId: scope.input.sourceId,
      quote: scope.input.text,
    }),
  );
});

test('deferring a response preserves the question while recording only a deferred player decision', () => {
  const { context, native, interpretation, reply } = fixture();
  context.input.text = '预算我晚点再确定。';
  const p = parseAgentProposal(
    context,
    native({
      ...interpretation,
      kind: 'related_reply',
      quote: context.input.text,
      replies: [{ ...reply, relation: 'defer_answer', decision: 'deferred' }],
    }),
  );
  assert.equal(p.decisions[0]!.kind, 'deferred');
  assert.equal(p.replyAssessments![0]!.relation, 'defer_answer');
  assert.equal(context.state.questions![0]!.status, 'open');
});
