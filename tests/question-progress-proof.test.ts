import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentInputReceipt,
} from '../src/modules/world/domain/agent-runtime.ts';
import { questionProgressReason } from '../src/modules/world/domain/question-progress-proof.ts';
import {
  committedAwarenessDelta,
  type CommittedAwarenessEvent,
} from '../src/modules/world/domain/world-awareness.ts';
import { authoredReconsiderationEvidence } from '../src/modules/world/domain/authored-reconsideration.ts';

function fixture() {
  const at = '2026-10-27T08:00:00.000Z';
  const previous = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 0);
  previous.goals = [
    {
      id: 'goal',
      summary: '安排见面',
      status: 'active',
      sourceIds: ['question-source'],
      resultIds: [],
    },
  ];
  previous.plans = [
    {
      id: 'plan',
      goalId: 'goal',
      summary: '等玩家答复再安排',
      sourceIds: ['question-source'],
      status: 'waiting',
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['等待答复'],
    },
  ];
  previous.questions = [
    {
      id: 'question',
      sourceId: 'question-source',
      channel: 'private',
      threadId: 'actor',
      status: 'open',
      text: '参加吗？',
      askedAt: at,
    },
  ];
  const input: AgentInputReceipt = {
    id: 'input',
    worldId: 'world',
    commandId: 'command',
    inputHash: 'a'.repeat(64),
    channel: 'private',
    threadId: 'actor',
    recipientActorId: 'actor',
    expectedWorldVersion: 0,
    origin: 'player',
    text: '这次先不去了，你自行安排',
    receivedAt: at,
    storyAt: at,
  };
  const next = structuredClone(previous);
  next.projectedWorldVersion = 1;
  next.questions![0]!.status = 'answered';
  next.questions![0]!.resolution = { sourceId: 'input', quote: input.text, kind: 'answer', at };
  const event: CommittedAwarenessEvent = {
    id: 'event',
    commandId: 'command',
    worldId: 'world',
    version: 1,
    type: 'agent.state_committed',
    storyAt: at,
    occurredAt: at,
    data: {
      actorId: 'actor',
      agentRuntime: {
        inputReceiptId: 'input',
        results: [],
        stateAfter: next,
        proposal: {
          replyAssessments: [
            { questionId: 'question', sourceId: 'input', quote: input.text, relation: 'answer' },
          ],
        },
        questionChanges: [
          {
            questionId: 'question',
            questionSourceId: 'question-source',
            sourceIds: ['input'],
            at,
            quote: input.text,
            relation: 'answer',
            statusBefore: 'open',
            statusAfter: 'answered',
            replayed: false,
          },
        ],
      },
    },
  };
  return { previous, input, event };
}
test('related information answer without responsibility yields cast-filtered progress, never formal decision', () => {
  const { event, previous, input } = fixture();
  const reason = questionProgressReason(event, previous, input)!;
  assert.equal(reason.kind, 'cross_impact');
  assert.equal(reason.actorId, 'actor');
  assert.deepEqual(previous.decisions, []);
  assert.deepEqual(authoredReconsiderationEvidence(['actor'], [reason], 1), [reason.id]);
  assert.deepEqual(authoredReconsiderationEvidence(['other'], [reason], 1), []);
  const delta = committedAwarenessDelta(
    {
      schemaVersion: 1,
      id: 'world',
      ownerId: 'owner',
      title: 'test',
      version: 1,
      time: event.storyAt!,
      actors: [{ id: 'actor', name: '甲', persona: '独立' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
    event,
    { previousAgentState: previous, questionInput: input },
  );
  assert.equal(delta.reasons.filter((r) => r.kind === 'cross_impact').length, 1);
  assert.equal(delta.reasons.filter((r) => r.kind === 'player_decision').length, 0);
});
test('quiet, ordinary greeting, uncertain, stale/replayed, forged input or unsaved result cannot create progress', () => {
  const variants = [
    (f: ReturnType<typeof fixture>) => {
      f.previous.plans = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.origin = 'wake';
    },
    (f: ReturnType<typeof fixture>) => {
      (f.event.data as any).stream = { unit: 'statement' };
    },
    (f: ReturnType<typeof fixture>) => {
      (f.event.data as any).agentRuntime.questionChanges[0].replayed = true;
    },
    (f: ReturnType<typeof fixture>) => {
      (f.event.data as any).agentRuntime.questionChanges[0].relation = 'uncertain';
    },
    (f: ReturnType<typeof fixture>) => {
      (f.event.data as any).agentRuntime.proposal.replyAssessments = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.input.text = '另一个输入';
    },
    (f: ReturnType<typeof fixture>) => {
      (f.event.data as any).agentRuntime.stateAfter.questions[0].status = 'open';
    },
    (f: ReturnType<typeof fixture>) => {
      f.previous.questions![0]!.status = 'answered';
    },
  ];
  for (const mutate of variants) {
    const f = fixture();
    mutate(f);
    assert.equal(questionProgressReason(f.event, f.previous, f.input), null);
  }
});

test('one event with question progress and episode participation keeps one reason while retaining other refs in order', () => {
  const { event, previous, input } = fixture();
  const runtime = (event.data as any).agentRuntime;
  runtime.episodeDecision = { requestId: 'request', choice: 'engage' };
  runtime.proposal.episodeDecision = runtime.episodeDecision;
  runtime.stateAfter.plans[0].summary = '根据新信息调整';
  const world = {
    schemaVersion: 1 as const,
    id: 'world',
    ownerId: 'owner',
    title: 'test',
    version: 1,
    time: event.storyAt!,
    actors: [{ id: 'actor', name: '甲', persona: '独立' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const delta = committedAwarenessDelta(world, event, {
    previousAgentState: previous,
    questionInput: input,
  });
  assert.deepEqual(
    delta.reasons.map((r) => [r.kind, r.ref.id]),
    [
      ['cross_impact', 'event'],
      ['plan_changed', 'plan'],
    ],
  );
});
