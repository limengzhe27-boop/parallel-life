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
const plan = () => ({
  kind: 'create',
  ref: 'own-plan',
  goal: { kind: 'new', summary: 'Consider a future arrangement', sourceIds: ['definition:def'] },
  summary: 'Wait for a relevant reply',
  sourceIds: ['episode-intent:own'],
  nextStep: { kind: 'wait', conditions: [], missing: ['The player has not decided yet.'] },
});
function reject(c: AgentValidationContext, raw: unknown) {
  assert.throws(() => parseAgentProposal(c, raw), /RESPONSE_WIRE_SHAPE/);
}

test('v7 own-review quiet is a private decision, not a contact message or forced plan', () => {
  const { c, wire } = fixture();
  const before = structuredClone(wire),
    proposal = parseAgentProposal(c, wire);
  assert.deepEqual(wire, before);
  assert.deepEqual(proposal.statements, []);
  assert.deepEqual(proposal.goals, []);
  assert.deepEqual(proposal.plans, []);
  assert.equal('agendaReview' in proposal, false, 'private reason remains only in protected raw');
  reject(c, {
    ...wire,
    statements: [{ text: 'Currently no action; observing.', dependsOnActionIds: [] }],
  });
  reject(c, { ...wire, planIntents: [plan()] });
});
test('v7 update_plan needs an actual agenda change and cannot deliver its private report', () => {
  const { c, wire } = fixture();
  wire.agendaReview!.decision = 'update_plan';
  reject(c, wire);
  wire.planIntents = [plan()];
  const proposal = parseAgentProposal(c, wire);
  assert.equal(proposal.plans.length, 1);
  assert.deepEqual(proposal.statements, []);
  reject(c, {
    ...wire,
    statements: [{ text: 'Reporting my private evaluation.', dependsOnActionIds: [] }],
  });
  c.state = { ...c.state, goals: proposal.goals, plans: proposal.plans };
  c.viewState = structuredClone(c.state);
  wire.planIntents = [
    {
      kind: 'update',
      planId: proposal.plans[0]!.id,
      summary: proposal.plans[0]!.summary,
      sourceIds: ['episode-intent:own'],
      nextStep: { kind: 'wait', conditions: [], missing: ['The player has not decided yet.'] },
    },
  ];
  reject(c, wire); // Rewriting the same plan is not an update.
  c.input = { ...c.input, sourceId: 'next-input' };
  c.sources.push({ ...c.sources[0]!, id: 'next-input', recordId: 'next-input' });
  reject(c, wire); // Merely binding a new receipt source is provenance, not new agenda substance.
});
test('v7 contact requires a real outward statement but does not require a manufactured goal', () => {
  const { c, wire } = fixture();
  wire.agendaReview!.decision = 'contact';
  reject(c, wire);
  wire.statements = [
    { text: 'I have a concrete idea for the display; want to see?', dependsOnActionIds: [] },
  ];
  const p = parseAgentProposal(c, wire);
  assert.equal(p.statements.length, 1);
  assert.deepEqual(p.goals, []);
});
test('v7 plan source binding mechanically adds only this input and preserves every declared source', () => {
  const { c, wire } = fixture();
  wire.agendaReview!.decision = 'update_plan';
  wire.planIntents = [plan()];
  const before = structuredClone(wire),
    p = parseAgentProposal(c, wire);
  assert.deepEqual(p.plans[0]!.sourceIds, ['episode-intent:own', 'input']);
  assert.deepEqual(p.goals[0]!.sourceIds, ['definition:def', 'input']);
  assert.deepEqual(wire, before);
  const { agendaReview: _review, ...old } = wire;
  reject(c, { ...old, protocol: 'npc-wire-v6' }); // Paid old sources are never repaired.
  const already = plan();
  already.sourceIds = ['episode-intent:own', 'input'];
  already.goal.sourceIds = ['definition:def', 'input'];
  assert.deepEqual(
    parseAgentProposal(c, { ...wire, planIntents: [already] }).plans[0]!.sourceIds,
    already.sourceIds,
  );
});
test('v7 source binding cannot authorize invented sources, duplicates, missing input or malformed goals', () => {
  const { c, wire } = fixture();
  wire.agendaReview!.decision = 'update_plan';
  for (const ids of [[], ['unknown'], ['definition:def', 'definition:def']])
    reject(c, { ...wire, planIntents: [{ ...plan(), sourceIds: ids }] });
  reject(c, {
    ...wire,
    planIntents: [{ ...plan(), goal: { ...plan().goal, sourceIds: ['unknown'] } }],
  });
  const missing = { ...plan() } as any;
  delete missing.goal;
  reject(c, { ...wire, planIntents: [missing] });
  c.sources = c.sources.filter((s) => s.id !== 'input');
  reject(c, { ...wire, planIntents: [plan()] });
});
test('ordinary player chat cannot claim an own-review quiet disposition to bypass its reply', () => {
  const { c, wire } = fixture(false);
  assert.throws(() => parseAgentProposal(c, wire), /MISSING_REPLY/);
  reject(c, {
    ...wire,
    agendaReview: {
      decision: 'quiet',
      reason: 'Not a player reply.',
      basisSourceIds: ['definition:def'],
    },
  });
  wire.statements = [{ text: 'Here is where I am with it.', dependsOnActionIds: [] }];
  assert.equal(parseAgentProposal(c, wire).statements.length, 1);
});
test('v6 historical outward quiet report remains unchanged rather than reclassified or repaired', () => {
  const { c, wire } = fixture();
  const { agendaReview: _review, ...old } = wire;
  old.protocol = 'npc-wire-v6';
  old.statements = [{ text: 'I am observing quietly.', dependsOnActionIds: [] }];
  const p = parseAgentProposal(c, old);
  assert.equal(p.statements[0]!.text, old.statements[0]!.text);
});
test('v7 provider grammar binds review scope and source validation remains explicit', () => {
  const own = fixture(),
    player = fixture(false);
  const a: any = npcResponseFormat(own.c.viewState!, 'forbidden', own.c),
    b: any = npcResponseFormat(player.c.viewState!, 'forbidden', player.c);
  assert.deepEqual(a.schema.properties.protocol.enum, ['npc-wire-v13']);
  assert.equal(a.schema.properties.agendaReview.type, 'object');
  assert.deepEqual(a.schema.properties.agendaReview.properties.decision.enum, [
    'quiet',
    'update_plan',
    'contact',
  ]);
  assert.equal(b.schema.properties.agendaReview.type, 'null');
  reject(own.c, { ...own.wire, agendaReview: null });
  reject(own.c, {
    ...own.wire,
    agendaReview: { ...own.wire.agendaReview, basisSourceIds: ['unknown'] },
  });
  assert.throws(() =>
    decodeNpcWire(own.c, { ...own.wire, agendaReview: { ...own.wire.agendaReview, extra: true } }),
  );
});

test('v12 quiet carries a persistent continuation while paid v11 stays unchanged', () => {
  const { c, wire } = fixture();
  const { focus: _focus, ...base } = { ...wire, focus: null };
  const old = {
    ...base,
    protocol: 'npc-wire-v11',
    agendaReview: { ...wire.agendaReview!, basisSourceIds: ['source:2'] },
    focusChange: { kind: 'keep' },
    questionWithdrawals: null,
    locationReports: null,
  };
  const before = JSON.stringify(old);
  const legacy = parseAgentProposal(c, old);
  assert.equal(legacy.continuation, undefined);
  assert.equal(JSON.stringify(old), before);
  const continuation = {
    decision: 'no_current_intent',
    reason: 'No new personal evidence since my last decision.',
    sourceIds: ['input'],
    planIds: [],
    questionIds: [],
    conditions: [],
  };
  const current = parseAgentProposal(c, {
    ...old,
    protocol: 'npc-wire-v12',
    continuation: { ...continuation, sourceIds: ['source:1'] },
  });
  assert.deepEqual(current.continuation, continuation);
  assert.equal(current.statements.length, 0);
  assert.throws(() => parseAgentProposal(c, { ...old, protocol: 'npc-wire-v12' }));
});
