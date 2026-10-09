import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneClient } from '../src/features/phone/scenes/client.ts';
const id = '00000000-0000-4000-8000-000000000001';
const owner = '00000000-0000-4000-8000-000000000002';
const scene = '00000000-0000-4000-8000-000000000003';
const command = '00000000-0000-4000-8000-000000000004';
const session = { kind: 'guest', csrfToken: 't'.repeat(32) };
function response(v: unknown) {
  return new Response(JSON.stringify(v), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
test('scene reads do not run tasks, source mismatch rejects and raw free input contains no client outcome', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  let wrong = false;
  const transport = (async (u, o) => {
    const url = String(u);
    calls.push({ url, options: o });
    if (url.endsWith('/session')) return response(session);
    if (o?.method === 'POST')
      return response({ worldId: id, sceneId: scene, commandId: command, version: 2, task: null });
    return response({
      worldVersion: 1,
      storyNow: '2026-10-09T00:00:00.000Z',
      paused: false,
      experience: { ownerId: owner, worldId: wrong ? owner : id, view: { kind: 'phone' } },
      scene: null,
      entries: [],
      actions: [],
      matters: [],
      task: null,
    });
  }) as typeof fetch;
  const client = new SceneClient(transport);
  await client.read(id);
  assert.equal(calls.length, 2);
  assert(calls.every((c) => !c.url.endsWith('/run')));
  await client.input(id, scene, {
    commandId: command,
    expectedVersion: 1,
    text: '  我试着拿起灯。  ',
  });
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.options!.body)), {
    commandId: command,
    expectedVersion: 1,
    text: '  我试着拿起灯。  ',
  });
  assert.equal(new Headers(calls.at(-1)!.options!.headers).get('X-CSRF-Token'), 't'.repeat(32));
  wrong = true;
  await assert.rejects(client.read(id), /来源不一致/);
});
