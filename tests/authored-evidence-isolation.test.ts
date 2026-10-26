import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthoredReconsiderationEvidence } from '../src/modules/world/infrastructure/authored-reconsideration-evidence.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';

test('one stale legacy source cannot suppress a separately authenticated kernel result', async () => {
  const reason = {
    id: 'r1',
    eventId: 'e1',
    worldVersion: 4,
    kind: 'action_result',
    ref: { kind: 'action_result', actorId: 'a', id: 'result' },
  };
  const row = {
    id: 'r1',
    source_event_id: 'e1',
    source_version: 4,
    document: reason,
    previous_state: null,
    payload: {
      id: 'e1',
      worldId: 'w',
      version: 4,
      type: 'agent.state_committed',
      data: {
        actorId: 'a',
        agentRuntime: {
          stateAfter: { actorId: 'a', worldId: 'w', projectedWorldVersion: 4 },
          results: [{ id: 'result', worldId: 'w', actorId: 'a', eventId: 'e1', worldVersion: 4 }],
        },
      },
    },
  };
  const stale = { ...row, id: 'bad', document: { ...reason, id: 'wrong' } };
  let n = 0;
  const sql = {
    query: async () => ({ rows: n++ === 0 ? [stale, row] : [] }),
  } as unknown as SqlClient;
  assert.deepEqual(await readAuthoredReconsiderationEvidence(sql, 'owner', 'w', 4), [reason]);
  assert.equal(n, 2);
});

test('an unproven result is omitted, infrastructure errors still propagate', async () => {
  const sql = {
    query: async () => {
      throw Object.assign(Error('db unavailable'), { code: '08006' });
    },
  } as unknown as SqlClient;
  await assert.rejects(readAuthoredReconsiderationEvidence(sql, 'owner', 'w', 4), {
    code: '08006',
  });
});
