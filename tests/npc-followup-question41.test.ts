import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  bindPlayerInputInterpretation,
  playerReplyTargets,
} from '../src/modules/world/domain/agent-input-interpretation.ts';
import {
  bindNpcFollowUpQuestion,
  CURRENT_NPC_WIRE_PROTOCOL,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';

function fixture() {
  const at = '2026-11-03T09:00:00.000Z';
  const context: AgentValidationContext = {
    state: emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 0),
    worldVersion: 0,
    storyAt: at,
    sources: [{ id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 0, at }],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
    input: {
      sourceId: 'input',
      origin: 'coordination',
      text: JSON.stringify({
        type: 'npc_episode_consideration',
        requestId: 'request',
        revision: 0,
      }),
    },
  };
  const wire = {
    protocol: 'npc-wire-v15',
    statements: [
      {
        text: '愿意参加吗？',
        dependsOnActionIds: [],
        requestsPlayerReply: true,
        questionForResponsibilityId: null,
      },
    ],
    executions: [],
    changes: {
      consideration: {
        choice: 'engage',
        reason: '先询问意愿',
        basisSourceIds: [],
        followUp: { waitingOn: 'player', missing: ['参加意愿'] },
      },
    },
  };
  return { context, wire };
}

test('same complete episode turn binds its sole question to generated player wait without accepting anything', () => {
  const { context, wire } = fixture();
  const p = parseAgentProposal(context, wire);
  assert.equal(p.statements[0]?.questionForResponsibilityId, 'request:followup');
  assert.equal(p.responsibilities[0]?.status, 'waiting');
  assert.deepEqual(p.decisions, []);
  assert.deepEqual(p.actions, []);
  assert.deepEqual(bindNpcFollowUpQuestion(context, p), p, 'idempotent final compilation');
  assert.equal(wire.statements[0]?.questionForResponsibilityId, null, 'input wire immutable');
});

test('multiple questions and multiple live waits remain unbound', () => {
  const { context, wire } = fixture();
  wire.statements.push({ ...wire.statements[0]!, text: '另一件事也答应吗？' });
  assert.ok(
    parseAgentProposal(context, wire).statements.every((s) => !s.questionForResponsibilityId),
  );
  wire.statements.pop();
  context.state.responsibilities.push({
    id: 'other',
    subject: { kind: 'request', id: 'different' },
    summary: '另一件事',
    status: 'waiting',
    waitingOn: 'player',
    sourceIds: ['input'],
    nextCheck: [],
  });
  assert.equal(
    parseAgentProposal(context, wire).statements[0]?.questionForResponsibilityId,
    undefined,
  );
});

test('existing same followup reused by this consideration does not duplicate responsibility', () => {
  const { context, wire } = fixture();
  const original = parseAgentProposal(context, wire);
  context.state.responsibilities = original.responsibilities;
  const result = parseAgentProposal(context, wire);
  assert.equal(result.responsibilities.length, 1);
  assert.equal(result.statements[0]?.questionForResponsibilityId, 'request:followup');
});

test('only same-turn episode provenance permits binding, never a globally sole old wait', () => {
  const { context, wire } = fixture();
  const p = parseAgentProposal(context, wire);
  const unbound: AgentProposal = {
    ...p,
    statements: p.statements.map(({ questionForResponsibilityId, ...s }) => s),
  };
  for (const proposal of [
    { ...unbound, episodeDecision: undefined },
    { ...unbound, episodeDecision: { ...p.episodeDecision!, requestId: 'other' } },
    { ...unbound, episodeDecision: { ...p.episodeDecision!, sourceIds: [] } },
    { ...unbound, responsibilities: p.responsibilities.map((r) => ({ ...r, sourceIds: [] })) },
  ])
    assert.equal(
      bindNpcFollowUpQuestion(context, proposal).statements[0]?.questionForResponsibilityId,
      undefined,
    );
  const ordinary = {
    ...context,
    input: { ...context.input, origin: 'player' as const, text: '今天好呀' },
  };
  assert.equal(
    bindNpcFollowUpQuestion(ordinary, unbound).statements[0]?.questionForResponsibilityId,
    undefined,
  );
});

test('need_information stays a request for information, not consent; non-player wait and no question stay unchanged', () => {
  const { context, wire } = fixture();
  wire.changes.consideration.choice = 'need_information';
  wire.statements[0]!.text = '具体时间是什么？';
  const p = parseAgentProposal(context, wire);
  assert.equal(p.episodeDecision?.choice, 'need_information');
  assert.deepEqual(p.decisions, []);
  assert.equal(p.statements[0]?.questionForResponsibilityId, 'request:followup');
  wire.changes.consideration.followUp.waitingOn = 'world';
  assert.equal(
    parseAgentProposal(context, wire).statements[0]?.questionForResponsibilityId,
    undefined,
  );
  wire.changes.consideration.followUp.waitingOn = 'player';
  wire.statements[0]!.requestsPlayerReply = false;
  assert.equal(
    parseAgentProposal(context, wire).statements[0]?.questionForResponsibilityId,
    undefined,
  );
});

test('current protocol and full legacy response yield the same binding; an early prefix cannot guess it', () => {
  const { context, wire } = fixture();
  const legacy = parseAgentProposal(context, wire);
  const current = parseAgentProposal(context, { ...wire, protocol: CURRENT_NPC_WIRE_PROTOCOL });
  assert.deepEqual(current.statements, legacy.statements);
  const prefix: Pick<AgentProposal, 'statements' | 'responsibilities' | 'episodeDecision'> = {
    statements: legacy.statements.map(({ questionForResponsibilityId, ...s }) => s),
    responsibilities: [],
    episodeDecision: undefined,
  };
  assert.equal(
    bindNpcFollowUpQuestion(context, prefix).statements[0]?.questionForResponsibilityId,
    undefined,
  );
});

test('linked question exposes correct response target; asking details and explicit defer cannot become acceptance', () => {
  const { context, wire } = fixture();
  const p = parseAgentProposal(context, wire);
  context.state.responsibilities = p.responsibilities;
  context.state.questions = [
    {
      id: 'question',
      channel: 'private',
      threadId: 'actor',
      sourceId: 'question-message',
      text: wire.statements[0]!.text,
      askedAt: context.storyAt,
      status: 'open',
      responsibilityId: p.statements[0]!.questionForResponsibilityId,
    },
  ];
  const scope = {
    state: context.state,
    channel: context.channel,
    input: { origin: 'player', sourceId: 'reply', text: '具体是什么？我还没有确定参加。' },
    authorizedSourceIds: new Set(['input', 'question-message', 'reply']),
  };
  const target = playerReplyTargets(scope)[0]!;
  assert.equal(target.responsibilityId, 'request:followup');
  assert.deepEqual(
    bindPlayerInputInterpretation(scope, {
      kind: 'uncertain',
      sourceId: 'reply',
      quote: scope.input.text,
    }),
    [],
  );
  const deferred = bindPlayerInputInterpretation(scope, {
    kind: 'related_reply',
    sourceId: 'reply',
    quote: scope.input.text,
    replies: [{ ...target, relation: 'defer_answer', decision: 'undecided' }],
  });
  assert.equal(deferred[0]?.decision, 'undecided');
  assert.throws(
    () =>
      bindPlayerInputInterpretation(scope, {
        kind: 'related_reply',
        sourceId: 'reply',
        quote: scope.input.text,
        replies: [{ ...target, relation: 'defer_answer', decision: 'accepted' }],
      }),
    /PLAYER_INPUT_INTERPRETATION_SCOPE/,
  );
});
