import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SpaceClient, SpaceFailure } from '../src/features/phone/map/client.ts';
const worldId = randomUUID(),
  commandId = randomUUID(),
  request = { commandId, expectedVersion: 2, routeId: 'a_to_b' },
  receipt = {
    status: 'committed',
    commandId,
    worldId,
    version: 3,
    sourceEventId: randomUUID(),
    routeId: 'a_to_b',
    fromPlaceId: 'a',
    toPlaceId: 'b',
    fromLabel: 'A',
    destinationLabel: 'B',
    durationMinutes: 12,
    departedAt: '2026-10-09T00:00:00.000Z',
    arrivedAt: '2026-10-09T00:12:00.000Z',
    leftSceneId: null,
  };
const session = { kind: 'guest', csrfToken: 'c'.repeat(32) };
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
test('map recover is read-only original command transport; mismatch never reported arrived', async () => {
  const calls: { url: string; body: unknown }[] = [];
  let wrong = false;
  const client = new SpaceClient((async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : null });
    if (String(url).endsWith('/session')) return response(session);
    return response({ ...receipt, ...(wrong ? { worldId: randomUUID() } : {}) });
  }) as typeof fetch);
  assert.deepEqual(await client.recover(worldId, request), receipt);
  assert.equal(calls.filter((c) => c.url.endsWith('/travel')).length, 0);
  assert.deepEqual(calls.at(-1)!.body, request);
  wrong = true;
  await assert.rejects(
    client.recover(worldId, request),
    (e: unknown) => e instanceof SpaceFailure && e.unknown,
  );
});
test('network and 503 travel stay unknown; known 422 rejection stays failed; no automatic resubmit', async () => {
  for (const kind of ['network', '503', '422']) {
    let writes = 0;
    const client = new SpaceClient((async (url) => {
      if (String(url).endsWith('/session')) return response(session);
      writes++;
      if (kind === 'network') throw new TypeError('lost');
      return response(
        {
          error: {
            code: kind === '503' ? 'UNAVAILABLE' : 'INVALID_COMMAND',
            message: 'Fixture rejected',
            retryable: false,
            requestId: randomUUID(),
          },
        },
        Number(kind),
      );
    }) as typeof fetch);
    await assert.rejects(
      client.travel(worldId, request),
      (e: unknown) => e instanceof SpaceFailure && e.unknown === (kind !== '422'),
    );
    assert.equal(writes, 1);
  }
});
