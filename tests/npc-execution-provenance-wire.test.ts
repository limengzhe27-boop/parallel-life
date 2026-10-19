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

function fixture(coordination = false) {
  const at = '2026-10-19T09:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 0);
  const context: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 0,
    storyAt: at,
    input: {
      sourceId: 'accepted-input',
      origin: coordination ? 'coordination' : 'player',
      text: coordination
        ? JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request', revision: 0 })
        : '请你考虑今天18点在店里见面。',
    },
    sources: [
      { id: 'accepted-input', kind: 'accepted_input', recordId: 'input', worldVersion: 0, at },
      { id: 'definition:original', kind: 'authored', recordId: 'definition', worldVersion: 0, at },
    ],
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: ['appointment.propose'] },
  };
  const execution = {
    ref: 'action_1',
    goal: { kind: 'new' as const, summary: '提出见面建议', sourceIds: ['source:2'] },
    plan: { summary: '先发送邀请，等待真实答复', sourceIds: ['source:2'], supersedesPlanId: null },
    action: {
      capability: 'appointment.propose',
      targetIds: [],
      parameters: [
        { name: 'title', value: '商量安排' },
        { name: 'at', value: '2026-10-19T10:00:00.000Z' },
      ],
      preconditions: [],
      dependsOnActionIds: [] as string[],
      handlesResponsibilityIds: [] as string[],
      sourceIds: ['source:2'],
    },
  };
  const wire = {
    protocol: 'npc-wire-v10',
    focusChange: { kind: 'keep' },
    statements: [{ text: '我想约你见面，你可以再决定。', dependsOnActionIds: [] }],
    executions: [execution],
    consideration: coordination
      ? { choice: 'engage', reason: '我愿意按本人立场参与。', basisSourceIds: ['source:2'] }
      : null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: coordination
      ? null
      : { kind: 'uncertain', sourceId: 'source:1', quote: context.input.text },
  };
  return { context, wire };
}

test('v10 binds current accepted input to each execution basis without altering explicit intent', () => {
  const { context, wire } = fixture();
  const before = structuredClone({ context, wire });
  const p = parseAgentProposal(context, wire);
  assert.equal(p.actions.length, 1);
  assert.deepEqual(p.goals[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.deepEqual(p.plans[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.deepEqual(p.actions[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.deepEqual(
    p.actions[0]!.parameters,
    Object.fromEntries(wire.executions[0]!.action.parameters.map((p) => [p.name, p.value])),
  );
  assert.equal(p.actions[0]!.capability, 'appointment.propose');
  assert.deepEqual(p.goals[0]!.resultIds, []);
  const explicit = structuredClone(wire);
  explicit.protocol = 'npc-wire-v9';
  for (const sourceIds of [
    explicit.executions[0]!.goal.sourceIds,
    explicit.executions[0]!.plan.sourceIds,
    explicit.executions[0]!.action.sourceIds,
  ])
    sourceIds.push('source:1');
  assert.deepEqual(
    parseAgentProposal(context, explicit),
    p,
    'same canonical old-kernel input, no new authority',
  );
  assert.deepEqual({ context, wire }, before, 'immutable context and paid wire remain untouched');
});

test('v10 does not duplicate an already declared accepted-input source', () => {
  const { context, wire } = fixture();
  for (const ids of [
    wire.executions[0]!.goal.sourceIds,
    wire.executions[0]!.plan.sourceIds,
    wire.executions[0]!.action.sourceIds,
  ])
    ids.push('source:1');
  const p = parseAgentProposal(context, wire);
  assert.deepEqual(p.actions[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.equal(p.actions[0]!.sourceIds.length, new Set(p.actions[0]!.sourceIds).size);
});

test('v10 coordination engagement keeps the explicit actor choice and only adds causal provenance', () => {
  const { context, wire } = fixture(true);
  const p = parseAgentProposal(context, wire);
  assert.equal(p.episodeDecision!.choice, 'engage');
  assert.equal(p.episodeDecision!.requestId, 'request');
  assert.deepEqual(p.actions[0]!.sourceIds, ['definition:original', 'accepted-input']);
  assert.equal(p.statements[0]!.text, wire.statements[0]!.text);
});

test('v10 does not replace or mutate a referenced existing goal', () => {
  const { context, wire } = fixture();
  context.state.goals = [
    {
      id: 'existing',
      summary: '保留原目标',
      status: 'active',
      sourceIds: ['definition:original'],
      resultIds: [],
    },
  ];
  context.viewState = structuredClone(context.state);
  const raw = {
    ...wire,
    executions: [{ ...wire.executions[0]!, goal: { kind: 'existing', id: 'existing' } }],
  };
  const p = parseAgentProposal(context, raw);
  assert.equal(p.goals.length, 0);
  assert.equal(p.plans[0]!.goalId, 'existing');
  assert.deepEqual(context.state.goals[0]!.sourceIds, ['definition:original']);
  assert.deepEqual(p.actions[0]!.sourceIds, ['definition:original', 'accepted-input']);
});

test('v10 rejects unknown, duplicate, or corrupt semantic sources instead of repairing or dropping them', () => {
  for (const bad of [
    ['source:999'],
    ['definition:original'],
    ['source:2', 'source:2'],
    ['source:1', 'source:1'],
  ]) {
    for (const field of ['goal', 'plan', 'action'] as const) {
      const { context, wire } = fixture();
      wire.executions[0]![field].sourceIds = bad;
      assert.throws(() => decodeNpcWire(context, wire));
    }
  }
  const { context, wire } = fixture();
  context.sources.push({ ...context.sources[1]! });
  assert.throws(() => decodeNpcWire(context, wire), /NPC_SOURCE_REFERENCE_INVALID/);
});

test('v10 cannot attach a missing or non-accepted current source', () => {
  const { context, wire } = fixture();
  context.input.sourceId = 'not-in-snapshot';
  assert.throws(() => decodeNpcWire(context, wire), /NPC_V10_INPUT_SOURCE/);
  context.input.sourceId = 'definition:original';
  assert.throws(() => decodeNpcWire(context, wire), /NPC_V10_INPUT_SOURCE/);
});

test('v10 preserves capability, dependency, responsibility, parameter, and supersession rejection', () => {
  const variants = [
    (e: ReturnType<typeof fixture>['wire']['executions'][number]) => {
      e.action.capability = 'media.generate_image';
    },
    (e: ReturnType<typeof fixture>['wire']['executions'][number]) => {
      e.action.capability = 'plan.record';
    },
    (e: ReturnType<typeof fixture>['wire']['executions'][number]) => {
      e.action.dependsOnActionIds = ['unknown-action'];
    },
    (e: ReturnType<typeof fixture>['wire']['executions'][number]) => {
      e.action.handlesResponsibilityIds = ['unknown-responsibility'];
    },
    (e: ReturnType<typeof fixture>['wire']['executions'][number]) => {
      e.action.parameters.push({ ...e.action.parameters[0]! });
    },
  ];
  for (const alter of variants) {
    const { context, wire } = fixture();
    alter(wire.executions[0]!);
    assert.throws(() => parseAgentProposal(context, wire));
  }
  const { context, wire } = fixture();
  assert.throws(() =>
    parseAgentProposal(context, {
      ...wire,
      executions: [
        {
          ...wire.executions[0]!,
          plan: { ...wire.executions[0]!.plan, supersedesPlanId: 'other-plan' },
        },
      ],
    }),
  );
});

test('v9, v8 and v7 keep their old rejection for executions without current input provenance', () => {
  const { context, wire } = fixture();
  assert.throws(
    () => decodeNpcWire(context, { ...wire, protocol: 'npc-wire-v9' }),
    /NPC_EXECUTION_INTENT_SOURCE/,
  );
  const { focusChange: _focus, ...v8 } = wire;
  assert.throws(
    () => decodeNpcWire(context, { ...v8, protocol: 'npc-wire-v8' }),
    /NPC_EXECUTION_INTENT_SOURCE/,
  );
  const v7 = mapNpcSourceFields(v8, npcSourceReferences(context.sources), 'decode') as object;
  assert.throws(
    () => decodeNpcWire(context, { ...v7, protocol: 'npc-wire-v7' }),
    /NPC_EXECUTION_INTENT_SOURCE/,
  );
});

test('latest grammar is v10, and empty execution output remains quiet without synthetic action', () => {
  const { context, wire } = fixture();
  const format = npcResponseFormat(context.state, 'forbidden', context);
  if (format.format !== 'json_schema') throw Error('schema');
  assert.deepEqual((format.schema as any).properties.protocol.enum, ['npc-wire-v10']);
  context.input = { ...context.input, origin: 'wake', text: 'No relevant new changes' };
  const p = parseAgentProposal(context, {
    ...wire,
    executions: [],
    statements: [],
    inputInterpretation: null,
  });
  assert.equal(p.actions.length, 0);
  assert.equal(p.goals.length, 0);
  assert.equal(p.plans.length, 0);
  assert.equal(p.statements.length, 0);
});
