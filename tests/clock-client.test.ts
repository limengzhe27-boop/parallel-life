import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeClient } from '../src/features/api/client.ts';
const worldId = '00000000-0000-4000-8000-000000000001';
const values = { storyNow: '2026-10-09T00:00:00.000Z', speed: 1, paused: false,
  lastTickAt: '2026-10-09T00:00:00.000Z', missedBeats: 0, summary: null };
test('clock read and committed control receipts expose the same values; unknown receipt states reject', async () => {
  let invalid = false;
  const client = new LifeClient((async (url, init) => {
    const isControl = init?.method === 'POST' && !String(url).endsWith('/session');
    const data = String(url).endsWith('/session') ? { kind: 'guest', csrfToken: 't'.repeat(32) }
      : isControl ? { ...values, ...JSON.parse(String(init?.body)), status: invalid ? 'pending' : 'committed' }
      : values;
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  assert.deepEqual(await client.readWorldClock(worldId), values);
  assert.deepEqual(await client.setWorldClock(worldId, { paused: true, speed: 2 }), { ...values, paused: true, speed: 2 });
  invalid = true;
  await assert.rejects(client.setWorldClock(worldId, { paused: false }));
});
