import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  decodeNpcWire,
  npcResponseFormat,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';
import {
  mapNpcSourceFields,
  npcSourceReferences,
} from '../src/modules/world/infrastructure/npc-source-reference.ts';

function fixture() {
  const at = '2026-10-19T09:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 1);
  state.goals = [
    {
      id: 'goal-existing',
      summary: '已有目标',
      status: 'active',
      sourceIds: ['definition:original'],
      resultIds: [],
    },
  ];
  state.plans = [
    {
      id: 'plan-existing',
      goalId: 'goal-existing',
      summary: '等候相关信息',
      status: 'waiting',
      sourceIds: ['definition:original'],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['仍需信息'],
    },
  ];
  const context: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 1,
    storyAt: at,
    input: {
      sourceId: 'accepted-input',
      origin: 'wake',
      text: JSON.stringify({
        type: 'npc_agenda_review',
        grantId: 'review',
        anchorAttemptId: 'previous',
        policyVersion: 'own-agenda-v1',
        family: 'own_agenda',
        basisSourceIds: ['definition:original'],
      }),
    },
    sources: [
      { id: 'accepted-input', kind: 'accepted_input', recordId: 'input', worldVersion: 1, at },
      { id: 'definition:original', kind: 'authored', recordId: 'definition', worldVersion: 0, at },
    ],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
  };
  const wire = {
    protocol: 'npc-wire-v11',
    focusChange: { kind: 'keep' },
    statements: [],
    executions: [],
    consideration: null,
    goals: [
      {
        id: 'goal-existing',
        summary: '根据新情况调整已有目标的做法',
        status: 'active',
        sourceIds: ['source:2'],
      },
    ],
    planIntents: [
      {
        kind: 'update',
        planId: 'plan-existing',
        summary: '保留目标，等待新的实际信息',
        sourceIds: ['source:2'],
        nextStep: { kind: 'wait', conditions: [], missing: ['仍需信息'] },
      },
    ],
    responsibilities: [],
    inputInterpretation: null,
    agendaReview: {
      decision: 'update_plan',
      reason: '调整本人安排，尚未执行。',
      basisSourceIds: ['source:2'],
    },
  };
  return { context, wire };
}

test('v11 attaches accepted-input provenance to an exact existing goal without changing its identity or decision', () => {
  const { context, wire } = fixture();
  const before = structuredClone({ context, wire });
  const p = parseAgentProposal(context, wire);
  assert.equal(p.goals[0]!.id, 'goal-existing');
  assert.equal(p.goals[0]!.summary, wire.goals[0]!.summary);
  assert.equal(p.goals[0]!.status, 'active');
  assert.deepEqual(p.goals[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.deepEqual(p.plans[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.deepEqual(p.goals[0]!.resultIds, []);
  assert.equal(p.actions.length, 0);
  assert.equal(p.statements.length, 0);
  const explicit = structuredClone(wire);
  explicit.protocol = 'npc-wire-v10';
  explicit.goals[0]!.sourceIds.push('source:1');
  assert.deepEqual(
    parseAgentProposal(context, explicit),
    p,
    'only the input provenance differs on the wire',
  );
  assert.deepEqual({ context, wire }, before, 'never mutate old stored goals or model output');
});

test('v11 leaves already declared input and existing legitimate result references intact', () => {
  const { context, wire } = fixture();
  wire.goals[0]!.sourceIds.push('source:1');
  const p = parseAgentProposal(context, wire);
  assert.deepEqual(p.goals[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.equal(p.goals[0]!.sourceIds.length, new Set(p.goals[0]!.sourceIds).size);
});

test('v11 rejects new, other-actor, hidden-full-state-only and terminal goal identities', () => {
  for (const mode of ['new', 'hidden', 'fulfilled', 'withdrawn'] as const) {
    const { context, wire } = fixture();
    if (mode === 'new') wire.goals[0]!.id = 'other-actor-or-new-goal';
    else if (mode === 'hidden') context.viewState!.goals = [];
    else {
      context.state.goals[0]!.status = mode;
      context.viewState = structuredClone(context.state);
    }
    assert.throws(() => decodeNpcWire(context, wire), /NPC_V11_GOAL_UPDATE_SCOPE/);
  }
});

test('v11 rejects empty, unknown, corrupt or duplicate declared source bases rather than adding a fabricated one', () => {
  for (const bad of [
    [],
    ['source:999'],
    ['definition:original'],
    ['source:2', 'source:2'],
    ['source:1', 'source:1'],
  ]) {
    const { context, wire } = fixture();
    wire.goals[0]!.sourceIds = bad;
    assert.throws(() => decodeNpcWire(context, wire));
  }
  const { context, wire } = fixture();
  context.sources.push({ ...context.sources[1]! });
  assert.throws(() => decodeNpcWire(context, wire), /NPC_SOURCE_REFERENCE_INVALID/);
});

test('v11 requires a unique genuine current accepted input and keeps goal duplicate checks', () => {
  const { context, wire } = fixture();
  context.input.sourceId = 'not-visible';
  assert.throws(() => decodeNpcWire(context, wire), /NPC_V11_INPUT_SOURCE/);
  context.input.sourceId = 'definition:original';
  assert.throws(() => decodeNpcWire(context, wire), /NPC_V11_INPUT_SOURCE/);
  const valid = fixture();
  valid.wire.goals.push(structuredClone(valid.wire.goals[0]!));
  assert.throws(() => decodeNpcWire(valid.context, valid.wire), /NPC_V11_GOAL_UPDATE_DUPLICATE/);
});

test('v11 never grants completion, creates execution receipts or discards existing source history', () => {
  const { context, wire } = fixture();
  for (const goal of [
    { ...wire.goals[0]!, status: 'fulfilled' },
    { ...wire.goals[0]!, resultIds: ['invented-result'] },
  ])
    assert.throws(() => parseAgentProposal(context, { ...wire, goals: [goal] }));
  context.sources.push({
    id: 'old-evidence',
    kind: 'world_event',
    recordId: 'old',
    worldVersion: 0,
    at: context.storyAt,
  });
  context.state.goals[0]!.sourceIds.push('old-evidence');
  context.viewState = structuredClone(context.state);
  assert.throws(() => parseAgentProposal(context, wire), /SOURCE_HISTORY_IMMUTABLE/);
});

test('v10, v9, v8 and v7 retain the original paid goal-update rejection without current input', () => {
  const { context, wire } = fixture();
  for (const protocol of ['npc-wire-v10', 'npc-wire-v9'])
    assert.throws(
      () => decodeNpcWire(context, { ...wire, protocol }),
      /NPC_PLAN_GOAL_UPDATE_FORBIDDEN/,
    );
  const { focusChange: _focus, ...old } = wire;
  assert.throws(
    () => decodeNpcWire(context, { ...old, protocol: 'npc-wire-v8' }),
    /NPC_PLAN_GOAL_UPDATE_FORBIDDEN/,
  );
  const canonical = mapNpcSourceFields(
    old,
    npcSourceReferences(context.sources),
    'decode',
  ) as object;
  assert.throws(
    () => decodeNpcWire(context, { ...canonical, protocol: 'npc-wire-v7' }),
    /NPC_PLAN_GOAL_UPDATE_FORBIDDEN/,
  );
});

test('v11 empty goals stay empty rather than manufacturing a goal or requiring action', () => {
  const { context, wire } = fixture();
  for (const goals of [[], null]) {
    const p = parseAgentProposal(context, {
      ...wire,
      goals,
      planIntents: [],
      agendaReview: { ...wire.agendaReview, decision: 'quiet' },
    });
    assert.equal(p.goals.length, 0);
    assert.equal(p.plans.length, 0);
    assert.equal(p.actions.length, 0);
    assert.equal(p.statements.length, 0);
  }
  const format = npcResponseFormat(context.state, 'forbidden', context);
  if (format.format !== 'json_schema') throw Error('schema');
  assert.deepEqual((format.schema as any).properties.protocol.enum, ['npc-wire-v15']);
});

function unchangedGoalReview() {
  const { context, wire } = fixture();
  const unchanged = {
    ...wire,
    protocol: 'npc-wire-v13',
    goals: [
      { id: 'goal-existing', summary: '已有目标', status: 'active', sourceIds: ['source:2'] },
    ],
    planIntents: [],
    agendaReview: { ...wire.agendaReview, decision: 'quiet' },
    continuation: {
      decision: 'no_current_intent',
      reason: 'No semantic change in the current goal; wait for new personal evidence.',
      sourceIds: ['source:2'],
      planIds: [],
      questionIds: [],
      conditions: [],
    },
  };
  return { context, wire: unchanged };
}

test('v13 identical goal echo is no update, while protected v12 keeps the original quiet rejection', () => {
  const { context, wire } = unchangedGoalReview();
  const original = structuredClone({ context, wire });
  const proposal = parseAgentProposal(context, wire);
  assert.deepEqual(proposal.goals, []);
  assert.deepEqual(proposal.plans, []);
  assert.deepEqual(proposal.actions, []);
  assert.deepEqual(proposal.statements, []);
  assert.equal(proposal.continuation!.decision, 'no_current_intent');
  assert.deepEqual(context.state.goals[0]!.sourceIds, ['definition:original']);
  assert.throws(
    () => decodeNpcWire(context, { ...wire, protocol: 'npc-wire-v12' }),
    /NPC_AGENDA_REVIEW_QUIET_CHANGED/,
  );
  assert.deepEqual({ context, wire }, original, 'no rewrite of protected input, output or state');
});

test('v13 echo equality compares source sets and nullable transport without broad provenance exemptions', () => {
  const { context, wire } = unchangedGoalReview();
  const old = {
    id: 'older-fact',
    kind: 'world_event' as const,
    recordId: 'fact',
    worldVersion: 0,
    at: context.storyAt,
  };
  context.sources.push(old);
  context.state.goals[0]!.sourceIds.push(old.id);
  context.viewState = structuredClone(context.state);
  const goal = { ...wire.goals[0]!, sourceIds: ['source:3', 'source:2'], endReason: null };
  assert.deepEqual(parseAgentProposal(context, { ...wire, goals: [goal] }).goals, []);
  for (const sourceIds of [
    ['source:2'],
    ['source:2', 'source:3', 'source:1'],
    ['source:2', 'source:3', 'source:3'],
    ['source:2', 'source:3', 'source:999'],
  ])
    assert.throws(() => parseAgentProposal(context, { ...wire, goals: [{ ...goal, sourceIds }] }));
});

test('v13 true goal changes remain updates with current input provenance and cannot claim quiet', () => {
  for (const change of [
    { summary: 'A genuinely different personal objective' },
    { status: 'deferred' },
    { endReason: 'An explicit changed outcome' },
  ]) {
    const { context, wire } = unchangedGoalReview();
    const changed = { ...wire, goals: [{ ...wire.goals[0]!, ...change }] };
    assert.throws(() => decodeNpcWire(context, changed), /NPC_AGENDA_REVIEW_QUIET_CHANGED/);
    const updating = {
      ...changed,
      agendaReview: { ...changed.agendaReview, decision: 'update_plan' },
    };
    const p = decodeNpcWire(context, updating) as any;
    assert.equal(p.goals.length, 1);
    assert.deepEqual(p.goals[0].sourceIds, ['definition:original', 'accepted-input']);
  }
  const f = unchangedGoalReview();
  f.wire.goals.push(structuredClone(f.wire.goals[0]!));
  assert.throws(() => decodeNpcWire(f.context, f.wire), /NPC_V13_GOAL_UPDATE_DUPLICATE/);
  const hidden = unchangedGoalReview();
  hidden.context.viewState!.goals = [];
  assert.throws(() => decodeNpcWire(hidden.context, hidden.wire), /NPC_V13_GOAL_UPDATE_SCOPE/);
});
