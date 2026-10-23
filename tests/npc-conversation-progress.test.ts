import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentSource } from '../src/modules/world/domain/agent-runtime.ts';
import { projectNpcConversationProgress } from '../src/modules/world/infrastructure/npc-conversation-progress.ts';

const at = '2026-10-19T10:00:00.000Z';
const source = (id: string, usage?: AgentSource['usage']): AgentSource => ({
  id,
  kind: 'private_message',
  recordId: id,
  worldVersion: 1,
  at,
  ...(usage ? { usage } : {}),
});
function fixture() {
  const viewState = emptyActorAgentState(
    { worldId: 'world1', actorId: 'actor1' },
    'definition1',
    1,
  );
  viewState.questions = [
    {
      id: 'budget-question',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'question-source',
      text: '预算是多少？',
      askedAt: at,
      status: 'answered',
      responsibilityId: 'design-request',
      resolution: { sourceId: 'budget-answer', quote: '预算就是500元', at, kind: 'answer' },
    },
    {
      id: 'new-question',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'new-question-source',
      text: '还需要看材料吗？',
      askedAt: at,
      status: 'open',
      responsibilityId: 'design-request',
    },
  ];
  viewState.responsibilities = [
    {
      id: 'design-request',
      subject: { kind: 'request', id: 'request1' },
      summary: '等待玩家说明设计条件',
      sourceIds: ['request-source'],
      status: 'waiting',
      waitingOn: 'player',
      nextCheck: [],
    },
  ];
  return {
    viewState,
    channel: {
      kind: 'private' as const,
      threadId: 'actor1',
      audienceActorIds: ['actor1'],
      allowedCapabilities: [],
    },
    sources: ['question-source', 'budget-answer', 'new-question-source', 'request-source'].map(
      (id) => source(id),
    ),
  };
}

test('projects answered evidence and the still-waiting linked responsibility without completing it', () => {
  const input = fixture();
  const result = projectNpcConversationProgress(input);
  assert.deepEqual(
    result.questions.map((question) => [question.id, question.status]),
    [
      ['budget-question', 'answered'],
      ['new-question', 'open'],
    ],
  );
  assert.deepEqual(result.questions[0]?.answer, {
    sourceId: 'budget-answer',
    quote: '预算就是500元',
    kind: 'answer',
    at,
  });
  assert.deepEqual(result.waitingOnPlayer, [
    {
      id: 'design-request',
      summary: '等待玩家说明设计条件',
      status: 'waiting',
      sourceIds: ['request-source'],
      relatedQuestionIds: ['budget-question', 'new-question'],
    },
  ]);
  result.questions[0]!.text = 'edited';
  result.waitingOnPlayer[0]!.sourceIds.push('edited');
  assert.equal(input.viewState.questions?.[0]?.text, '预算是多少？');
  assert.deepEqual(input.viewState.responsibilities[0]?.sourceIds, ['request-source']);
});

test('does not reveal hidden, private-strategy, other-thread or unlinked state', () => {
  const input = fixture();
  input.viewState.questions!.push(
    {
      id: 'other-thread',
      channel: 'group',
      threadId: 'group1',
      sourceId: 'other-source',
      text: '群里秘密',
      askedAt: at,
      status: 'open',
    },
    {
      id: 'hidden-answer',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'hidden-question',
      text: '隐蔽问题',
      askedAt: at,
      status: 'answered',
      resolution: { sourceId: 'hidden-resolution', quote: '私密答案', at, kind: 'answer' },
    },
    {
      id: 'strategy-question',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'strategy-source',
      text: '幕后策略',
      askedAt: at,
      status: 'open',
    },
  );
  input.sources.push(
    source('other-source'),
    source('hidden-question'),
    source('strategy-source', 'private_strategy'),
  );
  input.viewState.responsibilities.push({
    id: 'unlinked',
    subject: { kind: 'request', id: 'request2' },
    summary: '别的会话待办',
    sourceIds: ['request-source'],
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
  });
  const result = projectNpcConversationProgress(input);
  assert.deepEqual(
    result.questions.map((question) => question.id),
    ['budget-question', 'new-question'],
  );
  assert.deepEqual(
    result.waitingOnPlayer.map((responsibility) => responsibility.id),
    ['design-request'],
  );
  assert.doesNotMatch(JSON.stringify(result), /群里秘密|私密答案|幕后策略|别的会话待办/);
});

test('limits both collections to the latest eight authorized items', () => {
  const input = fixture();
  input.viewState.questions = [];
  input.viewState.responsibilities = [];
  for (let index = 0; index < 12; index++) {
    input.sources.push(source(`question-${index}`), source(`request-${index}`));
    input.viewState.questions.push({
      id: `question-${index}`,
      channel: 'private',
      threadId: 'actor1',
      sourceId: `question-${index}`,
      text: `问题${index}`,
      askedAt: at,
      status: 'open',
      responsibilityId: `request-${index}`,
    });
    input.viewState.responsibilities.push({
      id: `request-${index}`,
      subject: { kind: 'request', id: `request-${index}` },
      summary: `等待${index}`,
      sourceIds: [`request-${index}`],
      status: 'waiting',
      waitingOn: 'player',
      nextCheck: [],
    });
  }
  const result = projectNpcConversationProgress(input);
  assert.equal(result.questions.length, 8);
  assert.equal(result.waitingOnPlayer.length, 8);
  assert.equal(result.questions[0]?.id, 'question-4');
  assert.equal(result.waitingOnPlayer[0]?.id, 'request-4');
});

test('bounds long excerpts and marks them as incomplete without changing source state', () => {
  const input = fixture();
  const longQuestion = '问'.repeat(501);
  const longAnswer = '答'.repeat(502);
  const longSummary = '待'.repeat(503);
  input.viewState.questions![0]!.text = longQuestion;
  input.viewState.questions![0]!.resolution!.quote = longAnswer;
  input.viewState.responsibilities[0]!.summary = longSummary;

  const result = projectNpcConversationProgress(input);
  assert.equal(result.questions[0]?.text, '问'.repeat(500));
  assert.equal(result.questions[0]?.textTruncated, true);
  assert.equal(result.questions[0]?.answer?.quote, '答'.repeat(500));
  assert.equal(result.questions[0]?.answer?.quoteTruncated, true);
  assert.equal(result.waitingOnPlayer[0]?.summary, '待'.repeat(500));
  assert.equal(result.waitingOnPlayer[0]?.summaryTruncated, true);
  assert.equal(input.viewState.questions![0]!.text, longQuestion);
  assert.equal(input.viewState.questions![0]!.resolution!.quote, longAnswer);
  assert.equal(input.viewState.responsibilities[0]!.summary, longSummary);
});

test('keeps only the latest open ask per responsibility or wording', () => {
  const input = fixture();
  input.viewState.questions!.push(
    {
      id: 'duplicate-open',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'new-question-source',
      text: '还需要看材料吗？',
      askedAt: at,
      status: 'open',
      responsibilityId: 'design-request',
    },
    {
      id: 'reworded-open',
      channel: 'private',
      threadId: 'actor1',
      sourceId: 'new-question-source',
      text: '材料还要不要再看一次？',
      askedAt: at,
      status: 'open',
      responsibilityId: 'design-request',
    },
  );
  const result = projectNpcConversationProgress(input);
  assert.deepEqual(
    result.questions.map((question) => question.id),
    ['budget-question', 'reworded-open'],
  );
});
