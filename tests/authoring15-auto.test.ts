import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeClient } from '../src/features/api/client.ts';
const worldId = '00000000-0000-4000-8000-000000000001';
const ready = { totalNodes: 2, presented: [], pending: null };
test('story reads validate only public progress and never send an advance or accept hidden scripts', async () => {
  const calls: string[] = [];
  let payload: unknown = { currentStageKeys: [], ...ready };
  const client = new LifeClient(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    if (String(url).endsWith('/session'))
      return Response.json({ kind: 'guest', csrfToken: 'a'.repeat(43) });
    assert.equal(String(url), `/api/v1/worlds/${worldId}/story`);
    return Response.json(payload);
  });
  assert.deepEqual(await client.readWorldStory(worldId), payload);
  assert.ok(calls.every((call) => !call.includes('/advance')));
  payload = { currentStageKeys: [], ...ready, editorialIntent: 'HIDDEN_SCRIPT' };
  await assert.rejects(client.readWorldStory(worldId));
  payload = { currentStageKeys: [], ...ready, presented: [{ playerCompleted: true }] };
  await assert.rejects(client.readWorldStory(worldId));
});
