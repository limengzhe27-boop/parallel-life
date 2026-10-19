import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import { readAgentObservationScheduleCandidatesInTransaction as read } from '../src/modules/world/infrastructure/agent-observation-schedule-read.ts';
const frame = {
  worldId: 'world',
  engineEpoch: 2,
  worldVersion: 3,
  storyAt: '2026-10-20T00:00:00.000Z',
};
test('stale frame fails before any actor hydration or evidence access', async () => {
  let calls = 0;
  const sql = {
    query: async () => {
      calls++;
      return { rows: [{ version: 4, engine_epoch: 2 }] };
    },
  } as unknown as SqlClient;
  await assert.rejects(() => read(sql, 'owner', frame), { code: 'VERSION_CONFLICT' });
  assert.equal(calls, 1);
});
test('actors with protected unknown attempts cannot become lightweight observation work', async () => {
  const sql = {
    query: async (query: string, values: unknown[]) => {
      if (query.includes('SELECT w.version')) return { rows: [{ version: 3, engine_epoch: 2 }] };
      if (query.includes('SELECT s.actor_id')) {
        assert.deepEqual(values[2], ['handled']);
        return { rows: [{ actor_id: 'actor', revision: 1 }] };
      }
      if (query.includes('agent_attempts'))
        return { rows: [{ actor_id: 'actor', status: 'unknown_after_send', document: null }] };
      throw Error('Protected actor must not read personal context: ' + query);
    },
  } as unknown as SqlClient;
  assert.deepEqual(await read(sql, 'owner', frame, ['handled']), []);
});
test('world without committed narrative knowledge requires no personality or recall queries', async () => {
  let calls = 0;
  const sql = {
    query: async (query: string) => {
      calls++;
      if (query.includes('SELECT w.version')) return { rows: [{ version: 3, engine_epoch: 2 }] };
      if (query.includes('SELECT s.actor_id')) return { rows: [] };
      throw Error('Unexpected hydration');
    },
  } as unknown as SqlClient;
  assert.deepEqual(await read(sql, 'owner', frame), []);
  assert.equal(calls, 2);
});
