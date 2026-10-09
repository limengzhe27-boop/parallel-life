import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldTaskDispatcher } from '../src/server/world-task-dispatcher.ts';
import type { TaskLease } from '../src/modules/tasks/domain/types.ts';
test('one world consumer routes group and scene precisely and refuses ambiguous inputs', async () => {
  const calls: string[] = [];
  const run = worldTaskDispatcher({
    scene: async () => {
      calls.push('scene');
    },
    group: async () => {
      calls.push('group');
    },
  });
  const lease: TaskLease = {
    id: 'task',
    ownerId: 'owner',
    kind: 'world',
    scopeId: 'world',
    token: 'lease',
    input: null,
  };
  for (const input of [{ type: 'scene' }, { channel: 'group' }])
    await run({ ...lease, input }, new AbortController().signal);
  assert.deepEqual(calls, ['scene', 'group']);
  for (const input of [null, {}, { type: 'scene', channel: 'group' }, { channel: 'private' }])
    await assert.rejects(run({ ...lease, input }, new AbortController().signal), {
      code: 'INVALID_COMMAND',
    });
  assert.deepEqual(calls, ['scene', 'group']);
});
