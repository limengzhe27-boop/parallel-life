import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  playerReplyTargets,
  type PlayerInputInterpretation,
} from '../src/modules/world/domain/agent-input-interpretation.ts';
import {
  playerReplyTargetCatalog,
  expandCompactPlayerInterpretation,
} from '../src/modules/world/domain/player-reply-target-catalog.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { npcResponseFormat } from '../src/modules/world/infrastructure/npc-model-protocol.ts';
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

function wire(interpretation: unknown) {
  return {
    protocol: 'npc-wire-v15',
    statements: [{ text: '好，按这个来。', dependsOnActionIds: [] }],
    executions: [],
    changes: {
      inputInterpretation: JSON.parse(
        JSON.stringify(interpretation)
          .replaceAll('current-input', 'source:2')
          .replaceAll('question-source', 'source:1'),
      ),
    },
  };
}
function compact() {
  const { context, scope, interpretation, reply } = fixture();
  return {
    context,
    scope,
    interpretation,
    reply,
    value: {
      ...interpretation,
      kind: 'related_reply' as const,
      replies: [
        { targetRef: 'reply:1', relation: 'answer' as const, decision: 'accepted' as const },
      ],
    },
  };
}
test('compact aliases expand exact original authorized targets; legacy v15 stays equivalent', () => {
  const { context, scope, interpretation, value } = compact();
  assert.deepEqual(playerReplyTargetCatalog(scope), [
    { ref: 'reply:1', questionId: 'budget-question', responsibilityId: 'budget' },
  ]);
  assert.deepEqual(expandCompactPlayerInterpretation(scope, value), interpretation);
  assert.deepEqual(
    parseAgentProposal(context, wire(value)),
    parseAgentProposal(context, wire(interpretation)),
  );
  assert.equal(context.state.questions![0]!.status, 'open');
});
test('unknown, duplicate, forged tuple and mixed aliases are not repaired or accepted', () => {
  const { context, value, interpretation, reply } = compact();
  const variants = [
    { ...value, replies: [{ ...value.replies[0], targetRef: 'reply:2' }] },
    { ...value, replies: [{ ...value.replies[0], targetRef: 'reply:01' }] },
    { ...value, replies: [value.replies[0], value.replies[0]] },
    { ...value, replies: [{ ...value.replies[0], questionId: 'invented' }] },
    { ...value, replies: [value.replies[0], reply] },
    { ...interpretation, replies: [{ ...reply, responsibilityRevision: 1 }] },
    { ...value, sourceId: 'other-input' },
    { ...value, quote: 'not the player message' },
  ];
  for (const invalid of variants) assert.throws(() => parseAgentProposal(context, wire(invalid)));
  context.channel = { ...context.channel, kind: 'group', threadId: 'group' };
  assert.throws(() => parseAgentProposal(context, wire(value)));
});
test('question-only alias cannot invent player obligation; private source and wake excluded', () => {
  const { context, scope, value } = compact();
  context.state.responsibilities = [];
  assert.throws(() => parseAgentProposal(context, wire(value)));
  assert.deepEqual(
    parseAgentProposal(
      context,
      wire({ ...value, replies: [{ ...value.replies[0], decision: null }] }),
    ).decisions,
    [],
  );
  scope.authorizedSourceIds.delete('question-source');
  assert.deepEqual(playerReplyTargetCatalog(scope), []);
  context.sources = context.sources.filter((s) => s.id !== 'question-source');
  assert.throws(() => parseAgentProposal(context, wire(value)));
  scope.input = { ...scope.input, origin: 'wake' };
  assert.deepEqual(playerReplyTargetCatalog(scope), []);
});
test('38 pending targets produce compact schema with full target coverage', () => {
  const { context } = compact();
  const question = context.state.questions![0]!;
  context.state.questions = Array.from({ length: 38 }, (_, i) => ({
    ...question,
    id: `question-${i}`,
  }));
  const format = npcResponseFormat(context.state, 'optional', context);
  assert.equal(format.format, 'json_schema');
  if (format.format !== 'json_schema') throw Error('schema');
  const changes = (format.schema.properties as any).changes.anyOf.find((n: any) => n.properties);
  const schema = changes.properties.inputInterpretation;
  const encoded = JSON.stringify(schema);
  assert.ok(encoded.length < 2000, `interpretation schema ${encoded.length}`);
  assert.ok(encoded.includes('reply:38'));
  assert.ok(!encoded.includes('responsibilityRevision'));
  assert.ok(!encoded.includes('questionSourceId'));
  const catalog = playerReplyTargetCatalog({
    ...context,
    authorizedSourceIds: new Set(context.sources.map((s) => s.id)),
  });
  assert.equal(catalog.length, 38);
  assert.equal(
    parseAgentProposal(
      context,
      wire({
        kind: 'related_reply',
        sourceId: context.input.sourceId,
        quote: context.input.text,
        replies: [{ targetRef: 'reply:38', relation: 'answer', decision: 'accepted' }],
      }),
    ).replyAssessments![0]!.questionId,
    'question-37',
  );
});
