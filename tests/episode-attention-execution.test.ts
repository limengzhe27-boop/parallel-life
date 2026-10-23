import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEpisodeDeliveryInTransaction } from '../src/modules/world/infrastructure/agent-episode-attention.ts';
import { requireActiveAgentDeliveryInTransaction } from '../src/modules/world/infrastructure/agent-delivery-activity.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';

function storage(clock: Record<string, unknown>, version = 3) {
  const calls: string[] = [];
  const sql = {
    query: async (query: string, params: unknown[]) => {
      calls.push(query);
      assert.deepEqual(params, ['world', 'owner']);
      if (query.includes('parallel_life.worlds')) return { rows: [{ version }] };
      if (query.includes('parallel_life.world_clock ')) return { rows: [clock] };
      throw Error('Delivery must not load presentation focus or other actors private content');
    },
  } as unknown as SqlClient;
  return { sql, calls };
}
const frame = { worldId: 'world', worldVersion: 3, actorId: 'B' };

test('independent B delivery only checks world and clock; A focus is not execution authority', async () => {
  const { sql, calls } = storage({ paused: false, continuity_mode: 'continuous' });
  await requireEpisodeDeliveryInTransaction(sql, 'owner', frame);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((q) => q.includes('FOR UPDATE')));
  await requireActiveAgentDeliveryInTransaction(sql, 'owner', 'world', 'NPC_DELIVERY_DEFERRED');
  assert.equal(calls.length, 4);
});

for (const clock of [
  { paused: true, continuity_mode: 'continuous' },
  { paused: false, managed: true, active_until: '2000-01-01T00:00:00Z' },
])
  test('real pause or expired noncontinuous activity still defers delivery', async () => {
    const { sql } = storage(clock);
    await assert.rejects(requireEpisodeDeliveryInTransaction(sql, 'owner', frame), {
      code: 'EPISODE_DELIVERY_DEFERRED',
    });
    await assert.rejects(
      requireActiveAgentDeliveryInTransaction(sql, 'owner', 'world', 'NPC_DELIVERY_DEFERRED'),
      { code: 'NPC_DELIVERY_DEFERRED' },
    );
  });

test('unrelated attention removal does not remove the exact commit-frame version check', async () => {
  const { sql, calls } = storage({ paused: false }, 4);
  await assert.rejects(requireEpisodeDeliveryInTransaction(sql, 'owner', frame), {
    code: 'VERSION_CONFLICT',
  });
  assert.equal(calls.length, 1);
});
