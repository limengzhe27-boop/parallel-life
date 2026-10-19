import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  decodeNpcWire,
  npcResponseFormat,
  NPC_WIRE_PROTOCOL,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 3);
  const c: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: { sourceId: 'input', text: 'Think about your plan', origin: 'player' },
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 3,
        at: '2026-10-19T10:00:00.000Z',
      },
    ],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: ['appointment.propose'] },
  };
  const wire = {
    protocol: 'npc-wire-v6',
    statements: [{ text: 'I need to decide what to do next.', dependsOnActionIds: [] }],
    goals: [] as unknown[],
    planIntents: [] as unknown[],
    executions: [] as unknown[],
    consideration: null,
    responsibilities: [],
    inputInterpretation: { kind: 'uncertain', sourceId: 'input', quote: 'Think about your plan' },
  };
  return { c, wire };
}
function existing() {
  const f = fixture();
  f.c.state.goals.push({
    id: 'g',
    summary: 'Existing goal',
    status: 'active',
    sourceIds: ['input'],
    resultIds: [],
  });
  f.c.state.plans.push({
    id: 'p',
    goalId: 'g',
    summary: 'Original plan',
    status: 'waiting',
    sourceIds: ['input'],
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: ['Need reply'],
  });
  f.c.viewState = structuredClone(f.c.state);
  return f;
}
const plan = () => ({
  kind: 'create',
  ref: 'future_1',
  goal: { kind: 'new', summary: 'A self-proposed intention', sourceIds: ['input'] },
  summary: 'Wait for information',
  sourceIds: ['input'],
  nextStep: { kind: 'wait', conditions: [], missing: ['A real player response.'] },
});
const execution = () => ({
  ref: 'action_1',
  goal: { kind: 'existing', id: 'g' },
  plan: { summary: 'Offer a meeting', sourceIds: ['input'] },
  action: {
    capability: 'appointment.propose',
    targetIds: [],
    parameters: [],
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['input'],
  },
});

test('v6 nested nonexecuting intent creates its explicitly chosen goal and plan through original parser/kernel', () => {
  const { c, wire } = fixture();
  wire.planIntents = [plan()];
  const before = structuredClone(c),
    p = parseAgentProposal(c, wire);
  assert.deepEqual(c, before);
  assert.equal(p.goals.length, 1);
  assert.equal(p.plans.length, 1);
  assert.equal(p.plans[0]!.goalId, p.goals[0]!.id);
  assert.equal(p.plans[0]!.status, 'waiting');
  assert.deepEqual(p.actions, []);
  assert.deepEqual(parseAgentProposal(c, wire), p);
  assert.throws(() => parseAgentProposal(c, { ...wire, plans: [] }), /RESPONSE_WIRE_SHAPE/);
});
test('v6 top-level goals cannot invent local IDs or mutate invisible or terminal goals', () => {
  const { c, wire } = existing();
  const goal = { id: 'g', summary: 'Updated intention', status: 'active', sourceIds: ['input'] };
  wire.goals = [goal];
  assert.equal(parseAgentProposal(c, wire).goals[0]!.id, 'g');
  for (const id of ['goal_1', 'unknown'])
    assert.throws(
      () => parseAgentProposal(c, { ...wire, goals: [{ ...goal, id }] }),
      /RESPONSE_WIRE_SHAPE/,
    );
  c.viewState!.goals = [];
  assert.throws(() => parseAgentProposal(c, wire), /RESPONSE_WIRE_SHAPE/);
  c.viewState = structuredClone(c.state);
  c.viewState!.goals[0]!.status = 'withdrawn';
  assert.throws(() => parseAgentProposal(c, wire), /RESPONSE_WIRE_SHAPE/);
});
test('v6 existing goal result receipts stay trusted and cannot be supplied by the model', () => {
  const { c, wire } = existing();
  c.state.goals[0]!.resultIds = ['actual-prior-result'];
  c.viewState = structuredClone(c.state);
  wire.goals = [{ id: 'g', summary: 'Same intention', status: 'deferred', sourceIds: ['input'] }];
  const p: any = decodeNpcWire(c, wire);
  assert.deepEqual(p.goals[0].resultIds, ['actual-prior-result']);
  assert.throws(() =>
    decodeNpcWire(c, {
      ...wire,
      goals: [{ ...(wire.goals[0] as object), resultIds: ['invented'] }],
    }),
  );
});
test('v6 updates and closes existing plans, preserving IDs rather than minting unrelated work', () => {
  const { c, wire } = existing();
  wire.planIntents = [
    {
      kind: 'update',
      planId: 'p',
      summary: 'Revised wait',
      sourceIds: ['input'],
      nextStep: { kind: 'blocked', missing: ['No details yet'] },
    },
  ];
  assert.equal(parseAgentProposal(c, wire).plans[0]!.id, 'p');
  wire.planIntents = [
    {
      kind: 'close',
      planId: 'p',
      status: 'withdrawn',
      reason: 'My own arrangement changed.',
      sourceIds: ['input'],
    },
  ];
  const p = parseAgentProposal(c, wire);
  assert.equal(p.plans[0]!.goalId, 'g');
  assert.deepEqual(p.goals, []);
});
test('v6 conflicts across execution and nonexecuting plans reject instead of creating duplicate responsibility paths', () => {
  const { c, wire } = existing();
  wire.executions = [execution()];
  wire.planIntents = [{ ...plan(), goal: { kind: 'existing', id: 'g' } }];
  assert.throws(() => decodeNpcWire(c, wire), /NPC_PLAN_EXECUTION_CONFLICT/);
  wire.planIntents = [
    { kind: 'close', planId: 'p', status: 'withdrawn', reason: 'Stop', sourceIds: ['input'] },
  ];
  assert.throws(() => decodeNpcWire(c, wire), /NPC_PLAN_EXECUTION_CONFLICT/);
  wire.planIntents = [];
  wire.executions = [execution(), { ...execution(), ref: 'action_2' }];
  assert.throws(() => decodeNpcWire(c, wire)); // Single action limit is unchanged.
});
test('v6 does not allow goal withdrawal to coexist with a newly waiting plan', () => {
  const { c, wire } = existing();
  wire.goals = [
    {
      id: 'g',
      summary: 'Stop intention',
      status: 'withdrawn',
      endReason: 'Changed',
      sourceIds: ['input'],
    },
  ];
  wire.planIntents = [{ ...plan(), goal: { kind: 'existing', id: 'g' } }];
  assert.throws(() => decodeNpcWire(c, wire), /NPC_PLAN_GOAL_STATUS_CONFLICT/);
});
test('v5 protected completions preserve previous local identifiers and fail genuine dangling goals without repair', () => {
  const { c, wire } = fixture();
  const { planIntents: _unused, ...base } = wire;
  const old = {
    ...base,
    protocol: 'npc-wire-v5',
    plans: [
      {
        id: 'old_plan',
        goalId: 'goal_1',
        summary: 'Wait',
        sourceIds: ['input'],
        nextStep: { kind: 'wait', conditions: [], missing: ['Reply'] },
      },
    ],
  };
  assert.throws(() => parseAgentProposal(c, old), /UNKNOWN_GOAL/);
  const p = parseAgentProposal(c, {
    ...old,
    goals: [{ id: 'goal_1', summary: 'Explicit old goal', status: 'active', sourceIds: ['input'] }],
  });
  assert.equal(p.goals[0]!.id, 'goal_1');
  assert.equal(p.plans[0]!.id, 'old_plan');
  assert.throws(() => parseAgentProposal(c, { ...old, planIntents: [] }), /RESPONSE_WIRE_SHAPE/);
});
test('scoped v6 grammar offers only visible editable old IDs and fits current provider envelope', () => {
  const { c } = existing();
  const format: any = npcResponseFormat(c.viewState!, 'forbidden', c);
  const properties = format.schema.properties;
  assert.deepEqual(properties.protocol.enum, [NPC_WIRE_PROTOCOL]);
  assert.deepEqual(
    new Set(format.schema.$defs.npc_authorized_basis.items.enum),
    new Set(c.sources.map((s) => s.id)),
  );
  assert.equal(
    format.schema.$defs.npc_authorized_basis.items.enum.includes('episode-request:invented'),
    false,
  );
  assert.equal(properties.plans, undefined);
  assert.deepEqual(properties.goals.items.properties.id.enum, ['g']);
  const variants = properties.planIntents.items.anyOf;
  assert.deepEqual(
    variants.filter((v: any) => v.properties.planId).map((v: any) => v.properties.planId.enum),
    [['p'], ['p'], ['p']],
  );
  const c0 = fixture().c;
  const empty: any = npcResponseFormat(c0.viewState!, 'forbidden', c0);
  assert.equal(empty.schema.properties.goals.type, 'null');
  assert.equal(empty.schema.properties.planIntents.items.anyOf.length, 1);
  assert(JSON.stringify(format.schema).length < 32_000);
  const raw = fixture();
  assert.doesNotThrow(() => parseAgentProposal(raw.c, { ...raw.wire, goals: null }));
});

test('different-goal plan and single execution coexist while dependency refs still bind only real execution intents', () => {
  const { c, wire } = existing();
  wire.executions = [execution()];
  wire.planIntents = [plan()];
  const withDependency = {
    ...wire,
    statements: [
      { text: 'Only if that action succeeds.', dependsOnActionIds: ['execution:action_1'] },
    ],
  };
  const proposal: any = decodeNpcWire(c, withDependency);
  assert.equal(proposal.actions.length, 1);
  assert.equal(proposal.plans.length, 2);
  assert.notEqual(proposal.plans[0].goalId, proposal.plans[1].goalId);
  assert.deepEqual(proposal.statements[0].dependsOnActionIds, [proposal.actions[0].id]);
  assert.throws(() =>
    decodeNpcWire(c, {
      ...withDependency,
      statements: [{ text: 'No synthetic success.', dependsOnActionIds: ['execution:future_1'] }],
    }),
  );
});
test('v6 still requires explicit current-input interpretation and prohibits direct decisions', () => {
  const { c, wire } = fixture();
  const proposal = parseAgentProposal(c, wire);
  assert.deepEqual(proposal.decisions, []);
  assert.throws(
    () => parseAgentProposal(c, { ...wire, inputInterpretation: null }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        inputInterpretation: { ...wire.inputInterpretation, sourceId: 'old-input' },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(() => parseAgentProposal(c, { ...wire, decisions: [] }), /RESPONSE_WIRE_SHAPE/);
});
