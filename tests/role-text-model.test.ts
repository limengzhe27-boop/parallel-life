import test from 'node:test';
import assert from 'node:assert/strict';
import { roleTextModel } from '../src/server/role-text-model.ts';
import type { TextModel } from '../src/modules/ai/application/ports.ts';

test('only native NPC output selects its configured role model, including private/group/scene callers', async () => {
  const seen: string[] = [];
  const make = (name: string): TextModel => ({
    complete: async () => {
      seen.push(name);
      return name;
    },
  });
  const model = roleTextModel(make('base'), make('npc'));
  await model.complete([], undefined, 4096, {
    format: 'json_schema',
    name: 'npc_agent_response',
    strict: true,
    schema: {},
  });
  await model.complete([], undefined, 4096, {
    format: 'json_schema',
    name: 'director',
    strict: true,
    schema: {},
  });
  await model.complete([]);
  assert.deepEqual(seen, ['npc', 'base', 'base']);
});

test('NPC failure never retries or falls back to another model', async () => {
  let baseCalls = 0,
    npcCalls = 0;
  const model = roleTextModel(
    {
      complete: async () => {
        baseCalls++;
        return '';
      },
    },
    {
      complete: async () => {
        npcCalls++;
        throw Error('UNKNOWN_AFTER_SEND');
      },
    },
  );
  await assert.rejects(
    model.complete([], undefined, 4096, {
      format: 'json_schema',
      name: 'npc_agent_response',
      strict: true,
      schema: {},
    }),
    /UNKNOWN_AFTER_SEND/,
  );
  assert.equal(baseCalls, 0);
  assert.equal(npcCalls, 1);
});
