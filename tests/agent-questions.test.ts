import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQuestionChanges,
  selectQuestionResponder,
  type AgentQuestion,
  type QuestionContext,
  type QuestionState,
  type QuestionReplyAssessment,
  type ProvenPendingQuestion,
} from '../src/modules/world/domain/agent-questions.ts';

const askedAt = '2026-10-15T09:00:00.000Z';
const storyAt = '2026-10-15T09:02:00.000Z';
function question(id = 'question-a'): AgentQuestion {
  return {
    id,
    channel: 'group',
    threadId: 'group-a',
    sourceId: 'group:actual-message-' + id,
    text: '你想喝什么？\n茶还是咖啡？',
    askedAt,
    status: 'open',
  };
}
function fixture() {
  const state: QuestionState = {
    worldId: 'world-a',
    actorId: 'actor-a',
    questions: [
      question(),
      { ...question('private-question'), channel: 'private', threadId: 'actor-a' },
    ],
  };
  const context: QuestionContext = {
    worldId: state.worldId,
    actorId: state.actorId,
    storyAt,
    input: {
      origin: 'player',
      channel: 'group',
      threadId: 'group-a',
      sourceId: 'accepted:current',
      text: '不了，谢谢。\n我想喝茶，先不去。',
    },
    questionSources: state.questions.map((q) => ({
      questionId: q.id,
      sourceId: q.sourceId,
      channel: q.channel,
      threadId: q.threadId,
    })),
    withdrawalSourceIds: ['own:decision'],
  };
  const reply: QuestionReplyAssessment = {
    questionId: 'question-a',
    sourceId: 'accepted:current',
    quote: '我想喝茶',
    relation: 'answer',
  };
  return { state, context, reply };
}
function rejected(run: () => unknown, reason: string) {
  assert.throws(run, { name: 'AgentQuestionError', code: 'INVALID_QUESTION_CHANGE', reason });
}

test('answers keep the exact multiline original and evidence without fulfilling any responsibility', () => {
  const { state, context, reply } = fixture();
  state.questions[0]!.responsibilityId = 'appointment:waiting';
  reply.quote = '不了，谢谢。\n我想喝茶';
  const before = structuredClone({ state, context, reply });
  const result = applyQuestionChanges(state, context, { replyAssessments: [reply] });
  assert.deepEqual({ state, context, reply }, before);
  assert.equal(result.state.questions[0]!.status, 'answered');
  assert.equal(result.state.questions[0]!.text, state.questions[0]!.text);
  assert.deepEqual(result.state.questions[0]!.resolution, {
    sourceId: context.input!.sourceId,
    quote: reply.quote,
    at: storyAt,
    kind: 'answer',
  });
  assert.equal(result.state.questions[0]!.responsibilityId, 'appointment:waiting');
  assert.deepEqual(Object.keys(result).sort(), ['applied', 'state']);
  assert.deepEqual(Object.keys(result.state).sort(), ['actorId', 'questions', 'worldId']);
  assert.deepEqual(result.state.questions[1], state.questions[1]);
  assert.equal(result.applied[0]!.statusAfter, 'answered');
  assert.equal(result.applied[0]!.replayed, false);
  result.state.questions[0]!.resolution!.quote = 'mutated';
  result.applied[0]!.sourceIds.push('mutated');
  assert.deepEqual({ state, context, reply }, before);
});
test('declining to answer records answered/decline_to_answer, never withdrawal or appointment rejection', () => {
  const { state, context, reply } = fixture();
  reply.relation = 'decline_to_answer';
  reply.quote = '不了，谢谢';
  const result = applyQuestionChanges(state, context, { replyAssessments: [reply] });
  assert.equal(result.state.questions[0]!.status, 'answered');
  assert.equal(result.state.questions[0]!.resolution!.kind, 'decline_to_answer');
  assert.ok(!('decisions' in result.state));
});
for (const relation of ['defer_answer', 'unrelated', 'uncertain'] as const)
  test(`${relation} keeps the question open and emits an explicitly unfinished receipt`, () => {
    const { state, context, reply } = fixture();
    reply.relation = relation;
    const result = applyQuestionChanges(state, context, { replyAssessments: [reply] });
    assert.deepEqual(result.state, state);
    assert.equal(result.applied[0]!.relation, relation);
    assert.equal(result.applied[0]!.statusBefore, 'open');
    assert.equal(result.applied[0]!.statusAfter, 'open');
    assert.equal(result.applied[0]!.replayed, false);
  });
test('ordinary messages and a later evaluation time never close any pending question', () => {
  const { state, context } = fixture();
  context.storyAt = '2027-10-15T09:00:00.000Z';
  assert.deepEqual(applyQuestionChanges(state, context, {}), { state, applied: [] });
});
for (const [name, mutate, reason] of [
  [
    'foreign world',
    (c: QuestionContext) => {
      c.worldId = 'other';
    },
    'QUESTION_IDENTITY',
  ],
  [
    'foreign actor',
    (c: QuestionContext) => {
      c.actorId = 'other';
    },
    'QUESTION_IDENTITY',
  ],
  [
    'missing actual player input',
    (c: QuestionContext) => {
      delete c.input;
    },
    'NOT_CURRENT_PLAYER_INPUT',
  ],
  [
    'unseen question',
    (c: QuestionContext) => {
      c.questionSources = [];
    },
    'QUESTION_SOURCE_NOT_AUTHORIZED',
  ],
  [
    'wrong message handle',
    (c: QuestionContext) => {
      c.questionSources[0]!.sourceId = 'other';
    },
    'QUESTION_SOURCE_NOT_AUTHORIZED',
  ],
  [
    'wrong source thread',
    (c: QuestionContext) => {
      c.questionSources[0]!.threadId = 'other';
    },
    'QUESTION_SOURCE_NOT_AUTHORIZED',
  ],
  [
    'different current input',
    (c: QuestionContext) => {
      c.input!.sourceId = 'other';
    },
    'NOT_CURRENT_INPUT_SOURCE',
  ],
  [
    'same channel different thread',
    (c: QuestionContext) => {
      c.input!.threadId = 'other';
    },
    'CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED',
  ],
] as const)
  test(`rejects ${name} without changing the original state`, () => {
    const { state, context, reply } = fixture();
    const before = structuredClone(state);
    mutate(context);
    rejected(() => applyQuestionChanges(state, context, { replyAssessments: [reply] }), reason);
    assert.deepEqual(state, before);
  });
for (const quote of ['', '  ', '想喝咖啡', '我想喝茶先不去', '谢谢。我想喝茶'])
  test(`missing, invented or discontinuous quote is rejected: ${JSON.stringify(quote)}`, () => {
    const { state, context, reply } = fixture();
    reply.quote = quote;
    rejected(
      () => applyQuestionChanges(state, context, { replyAssessments: [reply] }),
      'ANSWER_QUOTE',
    );
  });
test('a question cannot cite its own message as the later player input', () => {
  const { state, context, reply } = fixture();
  context.input!.sourceId = state.questions[0]!.sourceId;
  reply.sourceId = context.input!.sourceId;
  rejected(
    () => applyQuestionChanges(state, context, { replyAssessments: [reply] }),
    'QUESTION_CANNOT_ANSWER_ITSELF',
  );
});
test('cross-channel grants are exact to question, original message, input and both threads', () => {
  const { state, context, reply } = fixture();
  reply.questionId = 'private-question';
  const q = state.questions[1]!;
  rejected(
    () => applyQuestionChanges(state, context, { replyAssessments: [reply] }),
    'CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED',
  );
  const grant = {
    questionId: q.id,
    questionSourceId: q.sourceId,
    inputSourceId: reply.sourceId,
    from: { channel: q.channel, threadId: q.threadId },
    to: { channel: context.input!.channel, threadId: context.input!.threadId },
  };
  context.crossChannelGrants = [grant];
  const allowed = applyQuestionChanges(state, context, { replyAssessments: [reply] });
  assert.equal(allowed.state.questions[1]!.status, 'answered');
  for (const field of ['questionId', 'questionSourceId', 'inputSourceId'] as const) {
    context.crossChannelGrants = [{ ...grant, [field]: 'other' }];
    rejected(
      () => applyQuestionChanges(state, context, { replyAssessments: [reply] }),
      'CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED',
    );
  }
  for (const side of ['from', 'to'] as const) {
    context.crossChannelGrants = [{ ...grant, [side]: { ...grant[side], threadId: 'other' } }];
    rejected(
      () => applyQuestionChanges(state, context, { replyAssessments: [reply] }),
      'CROSS_CHANNEL_ANSWER_NOT_AUTHORIZED',
    );
  }
});
test('terminal answer only replays the same source, quote and result; its original evaluation time stays intact', () => {
  const { state, context, reply } = fixture();
  const first = applyQuestionChanges(state, context, { replyAssessments: [reply] });
  context.storyAt = '2026-10-15T10:00:00.000Z';
  const replay = applyQuestionChanges(first.state, context, { replyAssessments: [reply] });
  assert.deepEqual(replay.state, first.state);
  assert.equal(replay.applied[0]!.replayed, true);
  assert.equal(replay.state.questions[0]!.resolution!.at, storyAt);
  for (const changed of [
    { ...reply, quote: '先不去' },
    { ...reply, relation: 'decline_to_answer' as const },
  ])
    rejected(
      () => applyQuestionChanges(first.state, context, { replyAssessments: [changed] }),
      'TERMINAL_QUESTION',
    );
  context.input!.sourceId = 'later:input';
  reply.sourceId = 'later:input';
  rejected(
    () => applyQuestionChanges(first.state, context, { replyAssessments: [reply] }),
    'TERMINAL_QUESTION',
  );
});
test('withdrawal is the owner NPC decision, with authorized evidence and reason; it is not a player refusal', () => {
  const { state, context } = fixture();
  delete context.input;
  const withdrawal = {
    questionId: 'question-a',
    sourceIds: ['own:decision'],
    reason: '本人不再需要这个答复。',
  };
  const result = applyQuestionChanges(state, context, { withdrawals: [withdrawal] });
  assert.equal(result.state.questions[0]!.status, 'withdrawn');
  assert.deepEqual(result.state.questions[0]!.resolution, {
    sourceId: 'own:decision',
    at: storyAt,
    kind: 'withdrawal',
    reason: withdrawal.reason,
  });
  context.storyAt = '2026-10-15T10:00:00.000Z';
  const replay = applyQuestionChanges(result.state, context, { withdrawals: [withdrawal] });
  assert.deepEqual(replay.state, result.state);
  assert.equal(replay.applied[0]!.replayed, true);
  rejected(
    () =>
      applyQuestionChanges(result.state, context, {
        withdrawals: [{ ...withdrawal, reason: 'different' }],
      }),
    'TERMINAL_QUESTION',
  );
  for (const changed of [
    { ...withdrawal, sourceIds: [] },
    { ...withdrawal, sourceIds: ['player:untrusted'] },
    { ...withdrawal, sourceIds: ['own:decision', 'own:decision'] },
  ])
    rejected(
      () => applyQuestionChanges(state, context, { withdrawals: [changed] }),
      'WITHDRAWAL_SOURCE_NOT_AUTHORIZED',
    );
  rejected(
    () => applyQuestionChanges(state, context, { withdrawals: [{ ...withdrawal, reason: ' ' }] }),
    'WITHDRAWAL_REASON',
  );
});
test('one invalid change rejects a whole detached batch, never partially changing the caller state', () => {
  const { state, context, reply } = fixture();
  const before = structuredClone(state);
  rejected(
    () =>
      applyQuestionChanges(state, context, {
        replyAssessments: [reply, { ...reply, questionId: 'unknown' }],
      }),
    'UNKNOWN_QUESTION',
  );
  assert.deepEqual(state, before);
  rejected(
    () => applyQuestionChanges(state, context, { replyAssessments: [reply, reply] }),
    'DUPLICATE_QUESTION_CHANGE',
  );
  rejected(
    () =>
      applyQuestionChanges(state, context, {
        replyAssessments: [reply],
        withdrawals: [
          { questionId: reply.questionId, sourceIds: ['own:decision'], reason: 'stop' },
        ],
      }),
    'DUPLICATE_QUESTION_CHANGE',
  );
  assert.deepEqual(state, before);
});
test('invalid times, future questions and malformed stored resolutions are rejected without fabricating occurrence time', () => {
  const { state, context } = fixture();
  context.storyAt = '2026-02-30T00:00:00.000Z';
  rejected(() => applyQuestionChanges(state, context, {}), 'INVALID_TIME');
  context.storyAt = '2026-10-15T08:00:00.000Z';
  rejected(() => applyQuestionChanges(state, context, {}), 'FUTURE_QUESTION');
  context.storyAt = storyAt;
  state.questions[0]!.resolution = { sourceId: 'x', at: storyAt, kind: 'answer', quote: 'tea' };
  rejected(() => applyQuestionChanges(state, context, {}), 'OPEN_QUESTION_HAS_RESOLUTION');
});
function pending(actorId: string, id: string, version: number): ProvenPendingQuestion {
  return { actorId, question: question(id), sourceWorldVersion: version };
}
test('A pending question survives B ordinary interjection because routing uses questions, not last speaker', () => {
  const questions = [pending('A', 'a', 4)];
  assert.deepEqual(selectQuestionResponder({ channel: 'group', threadId: 'group-a', questions }), {
    kind: 'selected',
    actorId: 'A',
    questionIds: ['a'],
  });
  questions.push(pending('B', 'b', 7));
  assert.deepEqual(selectQuestionResponder({ channel: 'group', threadId: 'group-a', questions }), {
    kind: 'selected',
    actorId: 'B',
    questionIds: ['b'],
  });
  questions[1]!.question.status = 'withdrawn';
  questions[1]!.question.resolution = {
    sourceId: 'b-own',
    at: storyAt,
    kind: 'withdrawal',
    reason: 'stop',
  };
  assert.equal(selectQuestionResponder({ questions }).kind, 'selected');
  assert.deepEqual(selectQuestionResponder({ questions }), {
    kind: 'selected',
    actorId: 'A',
    questionIds: ['a'],
  });
});
test('same actor can have multiple questions in the same actual source; output is order independent', () => {
  const a = pending('A', 'a', 5),
    b = pending('A', 'b', 5);
  b.question.sourceId = a.question.sourceId;
  const expected = { kind: 'selected', actorId: 'A', questionIds: ['a', 'b'] };
  assert.deepEqual(selectQuestionResponder({ questions: [a, b] }), expected);
  assert.deepEqual(selectQuestionResponder({ questions: [b, a] }), expected);
});
test('different actors at the same latest version are ambiguous, never array-first fallback', () => {
  const a = pending('A', 'a', 5),
    b = pending('B', 'b', 5);
  const expected = { kind: 'ambiguous', actorIds: ['A', 'B'], reason: 'same_version' };
  assert.deepEqual(selectQuestionResponder({ questions: [a, b] }), expected);
  assert.deepEqual(selectQuestionResponder({ questions: [b, a] }), expected);
});
test('cross-thread pending questions are ambiguous unless the server supplies an exact thread', () => {
  const a = pending('A', 'a', 5),
    b = pending('B', 'b', 7);
  b.question.threadId = 'group-b';
  assert.deepEqual(selectQuestionResponder({ questions: [a, b] }), {
    kind: 'ambiguous',
    actorIds: ['A', 'B'],
    reason: 'multiple_threads',
  });
  assert.deepEqual(
    selectQuestionResponder({ channel: 'group', threadId: 'group-a', questions: [a, b] }),
    { kind: 'selected', actorId: 'A', questionIds: ['a'] },
  );
  assert.deepEqual(
    selectQuestionResponder({ channel: 'scene', threadId: 'group-a', questions: [a, b] }),
    { kind: 'none' },
  );
});
test('no open question returns none and malformed version or duplicate IDs cannot pick an arbitrary speaker', () => {
  assert.deepEqual(selectQuestionResponder({ questions: [] }), { kind: 'none' });
  const a = pending('A', 'a', 5);
  a.sourceWorldVersion = NaN;
  rejected(() => selectQuestionResponder({ questions: [a] }), 'INVALID_SOURCE_VERSION');
  a.sourceWorldVersion = 5;
  rejected(() => selectQuestionResponder({ questions: [a, a] }), 'DUPLICATE_QUESTION');
});
