import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  NPC_RESPONSE_FORMAT,
  npcResponseFormat,
  shareNpcConditionSchema,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';

function inline(schema: Record<string, any>): unknown {
  const visit = (value: any, seen: string[] = []): any => {
    if (Array.isArray(value)) return value.map((v) => visit(v, seen));
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) {
      assert.equal(typeof value.$ref, 'string');
      assert(value.$ref.startsWith('#/$defs/'));
      assert(!seen.includes(value.$ref), 'no factoring cycle');
      const target = schema.$defs[value.$ref.slice('#/$defs/'.length)];
      assert(target, 'all definition references resolve');
      const { $ref, ...siblings } = value;
      return { ...visit(target, [...seen, $ref]), ...visit(siblings, seen) };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== '$defs')
        .map(([k, v]) => [k, visit(v, seen)]),
    );
  };
  return visit(schema);
}
function repeatedSchema() {
  if (NPC_RESPONSE_FORMAT.format !== 'json_schema') throw Error('schema');
  const c = structuredClone(
    (NPC_RESPONSE_FORMAT.schema as any).properties.continuation.properties.conditions.items,
  );
  const array = () => ({ type: 'array', items: structuredClone(c) });
  const narrow = structuredClone(c);
  narrow.anyOf[0].properties.sourceId = { type: 'string', enum: ['only-this-source'] };
  return {
    type: 'object',
    properties: {
      responsibility: {
        type: 'object',
        properties: { nextCheck: array() },
        required: ['nextCheck'],
        additionalProperties: false,
      },
      continuation: {
        type: 'object',
        properties: { conditions: array() },
        required: ['conditions'],
        additionalProperties: false,
      },
      actions: {
        anyOf: Array.from({ length: 3 }, () => ({
          type: 'object',
          properties: { preconditions: array() },
          required: ['preconditions'],
          additionalProperties: false,
        })),
      },
      narrow,
    },
    required: ['responsibility', 'continuation', 'actions', 'narrow'],
    additionalProperties: false,
    $defs: {
      npc_plan_next_step: {
        anyOf: [
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['reconsider'] },
              conditions: { ...array(), minItems: 1 },
              missing: { type: 'array', items: { type: 'string' } },
            },
            required: ['kind', 'conditions', 'missing'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['wait'] },
              conditions: array(),
              missing: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
            required: ['kind', 'conditions', 'missing'],
            additionalProperties: false,
          },
        ],
      },
    },
  };
}
test('identical condition factoring expands to the exact original grammar while preserving narrower source scope', () => {
  const original = repeatedSchema(),
    before = structuredClone(original),
    factored = shareNpcConditionSchema(original) as any;
  assert.deepEqual(inline(factored), inline(original));
  assert.deepEqual(original, before);
  assert(factored.$defs.npc_condition);
  assert.deepEqual(
    factored.properties.narrow,
    original.properties.narrow,
    'different source enum cannot share broader condition authority',
  );
  assert.equal(factored.$defs.npc_plan_next_step.anyOf[0].properties.conditions.minItems, 1);
  assert.equal(factored.$defs.npc_plan_next_step.anyOf[1].properties.missing.minItems, 1);
  assert(JSON.stringify(factored).length < JSON.stringify(original).length - 4000);
  assert.deepEqual(
    shareNpcConditionSchema(factored),
    factored,
    'already factored schema is stable',
  );
});
test('condition factoring does not overwrite reserved definitions or manufacture a missing template', () => {
  const collision: any = repeatedSchema();
  collision.$defs.npc_condition = { type: 'string', enum: ['reserved'] };
  assert.deepEqual(shareNpcConditionSchema(collision), collision);
  const absent = {
    type: 'object',
    properties: { source: { type: 'string' } },
    required: ['source'],
    additionalProperties: false,
  };
  assert.deepEqual(shareNpcConditionSchema(absent), absent);
});
test('current NPC response schema shares common conditions and preserves scoped reschedule parameters', () => {
  const at = '2026-10-19T09:00:00.000Z',
    state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 1);
  state.goals = [
    { id: 'g', summary: 'Existing plan', status: 'active', sourceIds: ['input'], resultIds: [] },
  ];
  state.plans = [
    {
      id: 'p',
      goalId: 'g',
      summary: 'Existing plan',
      status: 'waiting',
      sourceIds: ['input'],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['Await the player response'],
    },
  ];
  state.responsibilities = [
    {
      id: 'r',
      subject: { kind: 'appointment', id: 'appointment' },
      summary: 'Existing appointment',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['input'],
      nextCheck: [],
    },
  ];
  const sources = Array.from({ length: 20 }, (_, i) => ({
    id: i ? `source-id-${i}` : 'input',
    recordId: `record-${i}`,
    kind: 'accepted_input' as const,
    worldVersion: 1,
    at,
  }));
  const format = npcResponseFormat(state, 'forbidden', {
    input: { sourceId: 'input', origin: 'wake', text: 'A source-backed observation' },
    channel: {
      kind: 'private',
      threadId: 'actor',
      allowedCapabilities: [
        'appointment.propose',
        'appointment.reschedule',
        'media.generate_image',
      ],
    },
    sources,
  });
  if (format.format !== 'json_schema') throw Error('schema');
  const schema: any = format.schema;
  assert.deepEqual(schema.properties.protocol.enum, ['npc-wire-v15']);
  assert(schema.$defs.npc_condition);
  const expanded: any = inline(schema);
  const nodes = (v: any): any[] =>
    v && typeof v === 'object' ? [v, ...Object.values(v).flatMap(nodes)] : [];
  const reschedule = nodes(expanded).find((n) =>
    n.properties?.capability?.enum?.includes('appointment.reschedule'),
  );
  assert(reschedule);
  assert.deepEqual(reschedule.properties.parameters.properties.appointmentId.enum, ['appointment']);
  assert.equal(reschedule.properties.parameters.additionalProperties, false);
  assert(
    JSON.stringify(format).length < 16_000,
    'grammar factoring leaves room for protected personal input',
  );
});
