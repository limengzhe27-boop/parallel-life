import test from 'node:test';
import assert from 'node:assert/strict';
import { readActorSceneRecall } from '../src/modules/world/infrastructure/actor-observation-inbox.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';

test('scene recall without witnessed scenes is bounded and neither reads nor writes delivery consumption', async () => {
  const calls: string[] = [];
  const sql = {
    async query(text: string, values: unknown[]) {
      calls.push(text);
      assert.deepEqual(values, ['world', 'owner', 'actor']);
      assert.match(text, /LIMIT 3/);
      assert.match(text, /presence/);
      return { rows: [] };
    },
  } as unknown as SqlClient;
  const snapshot = {
    state: { worldId: 'world', actorId: 'actor' },
    worldVersion: 2,
    storyAt: '2026-11-04T00:00:00Z',
  } as AgentSnapshot;
  assert.deepEqual(await readActorSceneRecall(sql, 'owner', snapshot), {
    sources: [],
    observations: [],
  });
  assert.equal(calls.length, 1);
  assert.ok(calls.every((sql) => !/consumption|INSERT|UPDATE/.test(sql)));
});
