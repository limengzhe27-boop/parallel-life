import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GroupClient } from '../src/features/phone/groups/client.ts';
const worldId = randomUUID(),
  groupId = randomUUID(),
  commandId = randomUUID(),
  taskId = randomUUID();
const task = {
  id: taskId,
  scope: { kind: 'world', worldId },
  status: 'queued',
  errorCode: null,
  resultVersion: null,
  createdAt: '2026-10-09T03:00:00.000Z',
  updatedAt: '2026-10-09T03:00:00.000Z',
};
test('group client reuses session/CSRF and strips cached identity from sends', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const client = new GroupClient(async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return Response.json(
      String(path).endsWith('/session')
        ? { kind: 'guest', csrfToken: 'x'.repeat(43) }
        : { task, groupId, version: 2 },
    );
  });
  const input = { commandId, expectedVersion: 1, text: 'hello', worldId, groupId, taskId };
  const value = await client.send(worldId, groupId, input);
  assert.equal(value.task.id, taskId);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.init.credentials, 'same-origin');
  assert.equal(calls[1]!.init.cache, 'no-store');
  assert.equal(new Headers(calls[1]!.init.headers).get('x-csrf-token'), 'x'.repeat(43));
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), {
    commandId,
    expectedVersion: 1,
    text: 'hello',
    conversationId: groupId,
  });
  await client.send(worldId, groupId, input);
  assert.equal(calls.filter((c) => c.path.endsWith('/session')).length, 1);
});
test('malformed success and foreign-world receipts cannot become accepted group sends', async () => {
  for (const receipt of [
    { task: { ...task, scope: { kind: 'world', worldId: randomUUID() } }, groupId, version: 2 },
    { task, groupId: randomUUID(), version: 2 },
    { task: { ...task, status: 'invented' }, groupId, version: 2 },
  ]) {
    const client = new GroupClient(async (path) =>
      Response.json(
        String(path).endsWith('/session') ? { kind: 'guest', csrfToken: 'x'.repeat(43) } : receipt,
      ),
    );
    await assert.rejects(
      client.send(worldId, groupId, { commandId, expectedVersion: 1, text: 'hello' }),
      { code: 'UNAVAILABLE' },
    );
  }
});
test('network loss and unknown reads never resend, execute or replace tasks', async () => {
  const calls: string[] = [];
  const client = new GroupClient(async (path) => {
    calls.push(String(path));
    if (String(path).endsWith('/session'))
      return Response.json({ kind: 'guest', csrfToken: 'x'.repeat(43) });
    if (String(path).includes('/tasks/'))
      return Response.json({ ...task, status: 'unknown', errorCode: 'UNKNOWN' });
    throw Error('connection lost');
  });
  await assert.rejects(
    client.send(worldId, groupId, { commandId, expectedVersion: 1, text: 'hello' }),
    { code: 'UNAVAILABLE' },
  );
  assert.equal((await client.task(taskId)).status, 'unknown');
  assert.equal(calls.length, 3);
  assert(!calls.some((c) => c.endsWith('/retry')));
});
test('explicit retry and execute use scoped group endpoints', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const client = new GroupClient(async (path, init) => {
    calls.push({ path: String(path), init: init! });
    return Response.json(
      String(path).endsWith('/session') ? { kind: 'guest', csrfToken: 'x'.repeat(43) } : task,
    );
  });
  await client.execute(worldId, groupId, taskId);
  await client.retry(taskId, commandId);
  assert.equal(calls[1]!.path, `/api/v1/worlds/${worldId}/groups/${groupId}/messages`);
  assert.equal(calls[1]!.init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { taskId });
  assert.equal(calls[2]!.path, `/api/v1/tasks/${taskId}/retry`);
});

test('group execution rejects a different world or task receipt', async () => {
  for (const value of [
    { ...task, id: randomUUID() },
    { ...task, scope: { kind: 'world', worldId: randomUUID() } },
  ]) {
    const client = new GroupClient(async (path) =>
      Response.json(
        String(path).endsWith('/session') ? { kind: 'guest', csrfToken: 'x'.repeat(43) } : value,
      ),
    );
    await assert.rejects(client.execute(worldId, groupId, taskId), { code: 'UNAVAILABLE' });
  }
});
