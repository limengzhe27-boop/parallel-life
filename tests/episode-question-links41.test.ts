import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import { readEpisodeQuestionLinksInTransaction } from '../src/modules/world/infrastructure/episode-question-links.ts';

function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'def', 0);
  const question = {
    id: 'e_question_0',
    channel: 'private' as const,
    threadId: 'a',
    sourceId: 'message:m',
    text: '愿意参加吗？',
    askedAt: '2026-11-03T00:00:00.000Z',
    status: 'open' as const,
  };
  const responsibility = {
    id: 'request:followup',
    subject: { kind: 'request' as const, id: 'request' },
    summary: '参加意愿',
    status: 'waiting' as const,
    waitingOn: 'player' as const,
    sourceIds: ['input'],
    nextCheck: [],
  };
  const receipt = {
    id: 'input',
    channel: 'private',
    recipientActorId: 'a',
    threadId: 'a',
    origin: 'coordination',
    text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request', revision: 0 }),
  };
  const snapshot = {
    state: structuredClone(state),
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 0,
        at: question.askedAt,
      },
    ],
    worldVersion: 0,
    storyAt: question.askedAt,
    input: { sourceId: 'input', text: receipt.text, origin: 'coordination' },
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: [] },
  };
  const proposal: AgentProposal = {
    statements: [{ text: question.text, dependsOnActionIds: [], requestsPlayerReply: true }],
    responsibilities: [responsibility],
    goals: [],
    plans: [],
    actions: [],
    decisions: [],
    episodeDecision: {
      requestId: 'request',
      choice: 'engage',
      reason: '询问',
      sourceIds: ['input'],
    },
  };
  state.questions = [question];
  state.responsibilities = [responsibility];
  state.projectedWorldVersion = 1;
  const row = {
    id: 'e',
    snapshot,
    receipt,
    payload: {
      data: {
        effects: [{ type: 'message.received', id: 'm' }],
        agentRuntime: { proposal, stateAfter: structuredClone(state) },
      },
    },
  };
  row.payload.data.agentRuntime.stateAfter.responsibilities[0]!.revision = 0;
  const sql = { query: async () => ({ rows: [row] }) } as unknown as SqlClient;
  return { state, row, sql };
}

test('authenticated complete original turn derives only question responsibility link', async () => {
  const { state, sql } = fixture();
  const before = structuredClone(state);
  const next = await readEpisodeQuestionLinksInTransaction(sql, 'owner', state);
  assert.equal(next.questions![0]!.responsibilityId, 'request:followup');
  assert.deepEqual(state, before);
  assert.deepEqual(next.responsibilities, state.responsibilities);
  assert.deepEqual(
    { ...next.questions![0], responsibilityId: undefined },
    { ...state.questions![0], responsibilityId: undefined },
  );
  assert.strictEqual(await readEpisodeQuestionLinksInTransaction(sql, 'owner', next), next);
});

test('changed source, ordinal, question, actor, wait, original input and ambiguous question cannot infer links', async () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.state.questions![0]!.sourceId = 'message:other';
    },
    (f) => {
      f.state.questions![0]!.id = 'e_question_1';
    },
    (f) => {
      f.state.questions![0]!.text = '另一个问题';
    },
    (f) => {
      f.state.questions![0]!.askedAt = '2026-11-04T00:00:00.000Z';
    },
    (f) => {
      f.state.questions![0]!.status = 'answered';
    },
    (f) => {
      f.row.snapshot.state.actorId = 'other';
    },
    (f) => {
      f.row.receipt.text = 'different';
    },
    (f) => {
      f.row.payload.data.effects[0]!.id = 'other';
    },
    (f) => {
      f.state.responsibilities[0]!.status = 'withdrawn';
    },
    (f) => {
      f.state.responsibilities[0]!.sourceIds = [];
    },
    (f) => {
      f.row.payload.data.agentRuntime.proposal.statements.push({
        text: '另一个请求',
        dependsOnActionIds: [],
        requestsPlayerReply: true,
      });
    },
    (f) => {
      f.row.snapshot.state.responsibilities.push({
        ...f.state.responsibilities[0]!,
        id: 'other',
        subject: { kind: 'request', id: 'other' },
      });
    },
    (f) => {
      f.row.payload.data.agentRuntime.proposal.episodeDecision!.requestId = 'other';
    },
    (f) => {
      f.row.payload.data.agentRuntime.proposal.responsibilities[0]!.sourceIds = ['invisible'];
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.strictEqual(
      await readEpisodeQuestionLinksInTransaction(f.sql, 'owner', f.state),
      f.state,
    );
  }
});

test('no authenticated row preserves unknown; empty work performs no query', async () => {
  const { state } = fixture();
  const sql = { query: async () => ({ rows: [] }) } as unknown as SqlClient;
  assert.strictEqual(await readEpisodeQuestionLinksInTransaction(sql, 'owner', state), state);
  state.questions = [];
  assert.strictEqual(
    await readEpisodeQuestionLinksInTransaction(
      {
        query: async () => {
          throw Error('unnecessary query');
        },
      } as unknown as SqlClient,
      'owner',
      state,
    ),
    state,
  );
});
