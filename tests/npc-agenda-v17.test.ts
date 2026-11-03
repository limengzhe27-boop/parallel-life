import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  decodeNpcWire,
  npcResponseFormat,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';
function fixture(review = true) {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 3);
  const c: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: {
      sourceId: 'input',
      origin: review ? 'wake' : 'player',
      text: review
        ? JSON.stringify({
            type: 'npc_agenda_review',
            grantId: 'grant',
            anchorAttemptId: 'prior',
            policyVersion: 'own-agenda-v1',
            family: 'own_agenda',
            basisSourceIds: ['definition:def'],
          })
        : 'How is the plan?',
    },
    sources: ['input', 'definition:def', 'episode-intent:own'].map((id) => ({
      id,
      kind: 'accepted_input',
      recordId: id,
      worldVersion: 3,
      at: '2026-10-19T10:00:00.000Z',
    })),
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
  };
  const wire = {
    protocol: 'npc-wire-v7',
    statements: [] as { text: string; dependsOnActionIds: string[] }[],
    executions: [],
    consideration: null,
    goals: [] as unknown[],
    planIntents: [] as unknown[],
    responsibilities: [] as unknown[],
    inputInterpretation: review
      ? null
      : { kind: 'uncertain', sourceId: 'input', quote: c.input.text },
    agendaReview: review
      ? {
          decision: 'quiet',
          reason: 'Own private evaluation, not a message.',
          basisSourceIds: ['definition:def'],
        }
      : null,
  };
  return { c, wire };
}

function wire() {
  return {
    protocol: 'npc-wire-v17',
    statements: [] as { text: string; dependsOnActionIds: string[] }[],
    executions: [] as unknown[],
    changes: { agendaReview: { reason: '本人考虑下一步', basisSourceIds: ['source:2'] } } as Record<
      string,
      unknown
    >,
  };
}
test('v17 quiet requires no manufactured activity and no redundant classification', () => {
  const { c } = fixture();
  const raw = wire();
  const proposal = parseAgentProposal(c, raw);
  assert.deepEqual(proposal.statements, []);
  assert.deepEqual(proposal.actions, []);
  assert.deepEqual(proposal.plans, []);
  assert.equal('agendaReview' in proposal, false);
});
test('v17 permits silent standalone self action without requiring a goal or plan', () => {
  const { c } = fixture();
  c.channel.allowedCapabilities = ['position.establish'];
  c.sources.push({
    id: 'initial-position-policy:world:actor',
    kind: 'authored',
    recordId: 'world',
    worldVersion: 0,
    at: c.storyAt,
  });
  const raw = wire();
  raw.executions = [
    {
      ref: 'self-position',
      action: { capability: 'position.establish', parameters: { placeId: 'shop' } },
    },
  ];
  const p = parseAgentProposal(c, raw);
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0]!.capability, 'position.establish');
  assert.equal(p.plans.length, 0);
  assert.equal(p.statements.length, 0);
});
test('v17 permits quiet plan adjustment and simultaneous message plus plan', () => {
  for (const speaks of [false, true]) {
    const { c } = fixture();
    const raw = wire();
    raw.changes.planIntents = [
      {
        kind: 'create',
        ref: 'self-plan',
        goal: { kind: 'new', summary: '整理本人安排', sourceIds: ['source:2'] },
        summary: '自行整理思路',
        sourceIds: ['source:2'],
      },
    ];
    if (speaks) raw.statements = [{ text: '我有个新想法。', dependsOnActionIds: [] }];
    const p = parseAgentProposal(c, raw);
    assert.equal(p.plans.length, 1);
    assert.equal(p.statements.length, speaks ? 1 : 0);
  }
});
test('v17 retains review scope, required report, source and action capability protection', () => {
  const { c } = fixture();
  for (const change of [
    { agendaReview: { reason: 'x', basisSourceIds: ['unknown'] } },
    { agendaReview: null },
    { agendaReview: { decision: 'quiet', reason: 'x', basisSourceIds: ['source:2'] } },
  ])
    assert.throws(() => parseAgentProposal(c, { ...wire(), changes: change }));
  assert.throws(() => parseAgentProposal(fixture(false).c, wire()));
  const raw = wire();
  raw.executions = [
    {
      ref: 'self-position',
      action: { capability: 'position.establish', parameters: { placeId: 'shop' } },
    },
  ];
  assert.throws(() => parseAgentProposal(c, raw));
});
test('paid v16 keeps classification semantics rather than being decoded as v17', () => {
  const { c } = fixture();
  const raw = { ...wire(), protocol: 'npc-wire-v16' };
  raw.changes.agendaReview = {
    decision: 'quiet',
    reason: '本人暂时安静',
    basisSourceIds: ['source:2'],
  };
  assert.equal(parseAgentProposal(c, raw).plans.length, 0);
  raw.changes.planIntents = [
    {
      kind: 'create',
      ref: 'new',
      goal: { kind: 'new', summary: 'new goal', sourceIds: ['source:2'] },
      summary: 'new plan',
      sourceIds: ['source:2'],
    },
  ];
  assert.throws(() => parseAgentProposal(c, raw), /RESPONSE_WIRE_SHAPE/);
  raw.changes.agendaReview = {
    decision: 'update_plan',
    reason: '调整安排',
    basisSourceIds: ['source:2'],
  };
  assert.equal(parseAgentProposal(c, raw).plans.length, 1);
});
test('v17 and purchased v16 streaming preserve each original execution envelope', async () => {
  const { NpcStreamParser } =
    await import('../src/modules/world/infrastructure/npc-stream-parser.ts');
  for (const protocol of ['npc-wire-v17', 'npc-wire-v16', 'npc-wire-v15']) {
    const parser = new NpcStreamParser({
      channelKind: 'private',
      inputOrigin: 'wake',
      existingResponsibilityIds: [],
    });
    const executions = [
      {
        ref: 'self',
        action: { capability: 'position.establish', parameters: { placeId: 'shop' } },
      },
    ];
    const events = parser.pushChunk(
      JSON.stringify({ protocol, statements: [], executions, changes: null }),
    );
    assert.ok(events.some((e) => e.kind === 'execution_intents' && e.protocol === protocol));
  }
});
