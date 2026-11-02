import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  npcResponseFormat,
  pruneUnusedNpcSchemaDefinitions,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';

/** Resolve local definitions for structural equivalence, excluding the unused dictionary itself. */
function expanded(schema: Record<string, any>) {
  const defs = schema.$defs ?? {};
  const expand = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(expand);
    if (value.$ref?.startsWith('#/$defs/')) {
      const name = value.$ref.slice(8).replace(/~1/g, '/').replace(/~0/g, '~');
      assert.ok(Object.hasOwn(defs, name), `missing definition: ${name}`);
      const { $ref: _, ...siblings } = value;
      return { ...expand(defs[name]), ...expand(siblings) };
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$defs')
        .map(([key, child]) => [key, expand(child)]),
    );
  };
  return expand(schema);
}

test('schema cleanup follows transitive references, retains constraints and never mutates input', () => {
  const original = {
    type: 'object',
    additionalProperties: false,
    required: ['choice'],
    properties: { choice: { $ref: '#/$defs/outer' } },
    $defs: {
      outer: { anyOf: [{ $ref: '#/$defs/inner' }, { type: 'null' }] },
      inner: { type: 'string', enum: ['declined', 'deferred'] },
      unused: { $ref: '#/$defs/unusedCycle' },
      unusedCycle: { $ref: '#/$defs/unused' },
    },
  };
  const frozen = structuredClone(original);
  const result = pruneUnusedNpcSchemaDefinitions(original);
  assert.deepEqual(Object.keys(result.$defs as object), ['outer', 'inner']);
  assert.deepEqual(expanded(result), expanded(original));
  assert.deepEqual(original, frozen);
  assert.deepEqual(pruneUnusedNpcSchemaDefinitions(result), result);
  assert.deepEqual(pruneUnusedNpcSchemaDefinitions({ type: 'null', $defs: original.$defs }), {
    type: 'null',
  });
  const recursive = {
    $ref: '#/$defs/a',
    $defs: { a: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/a' }] }, unused: { type: 'string' } },
  };
  assert.deepEqual(Object.keys(pruneUnusedNpcSchemaDefinitions(recursive).$defs as object), ['a']);
  const escaped = {
    $ref: '#/$defs/a~1b~0c',
    $defs: { 'a/b~c': { type: 'string' }, unused: { type: 'null' } },
  };
  assert.deepEqual(expanded(pruneUnusedNpcSchemaDefinitions(escaped)), expanded(escaped));
});

test('final NPC grammar has no unused definitions across channel, permission, state and opportunity scopes', () => {
  let scenarios = 0;
  for (const kind of ['private', 'group', 'scene'] as const)
    for (const active of [false, true])
      for (const consideration of ['required', 'optional', 'forbidden'] as const)
        for (const expressionOnly of [false, true])
          for (const changesScope of ['full', 'compact'] as const) {
            const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 0);
            if (active) {
              state.goals.push({
                id: 'goal',
                summary: '相约喝茶',
                status: 'active',
                resultIds: [],
                sourceIds: ['input'],
              });
              state.plans.push({
                id: 'plan',
                goalId: 'goal',
                summary: '商量时间',
                status: 'waiting',
                actionIds: [],
                nextActionId: null,
                triggers: [],
                missingConditions: ['时间'],
                sourceIds: ['input'],
              });
            }
            const current = {
              input: {
                origin: 'player' as const,
                sourceId: 'input',
                text: '这周五不聚餐，其他时间再说。',
              },
              channel: {
                kind,
                threadId: kind === 'private' ? 'actor' : kind,
                allowedCapabilities: active
                  ? ['appointment.propose', 'travel.begin', 'media.generate_image']
                  : [],
              },
              sources: [
                {
                  id: 'input',
                  kind: 'accepted_input' as const,
                  recordId: 'input',
                  worldVersion: 0,
                  at: '2026-11-02T00:00:00Z',
                },
              ],
            };
            const format = npcResponseFormat(
              state,
              consideration,
              current,
              expressionOnly,
              changesScope,
            );
            assert.equal(format.format, 'json_schema');
            if (format.format !== 'json_schema') throw Error('format');
            const schema = format.schema as Record<string, any>;
            const augmented = {
              ...schema,
              $defs: {
                ...schema.$defs,
                unreferenced_test: { type: 'object', properties: { private: { type: 'string' } } },
              },
            };
            assert.deepEqual(
              expanded(pruneUnusedNpcSchemaDefinitions(augmented)),
              expanded(schema),
            );
            assert.deepEqual(pruneUnusedNpcSchemaDefinitions(augmented), schema);
            if (expressionOnly && !active && consideration !== 'required') {
              assert.equal(schema.properties.executions.type, 'null');
              assert.equal(schema.properties.changes.type, 'null');
              assert.ok(
                !schema.$defs,
                'expression-only requests do not carry unused action/source grammar',
              );
            }
            scenarios++;
          }
  assert.equal(scenarios, 72);
});
