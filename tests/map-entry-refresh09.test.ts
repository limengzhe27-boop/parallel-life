import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEntryRead } from '../src/features/phone/map/use-map-entry-refresh.ts';

test('entering a map/scene view refreshes once and callback identity changes do not become new entries', async () => {
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = mapEntryRead(undefined, 'world-a', async () => {
    calls++;
    await gate;
  });
  const replay = mapEntryRead(first, 'world-a', async () => {
    throw Error('UNEXPECTED_CALLBACK_REBUY');
  });
  assert.equal(replay, first);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  await replay.promise;
  assert.equal(
    mapEntryRead(first, 'world-a', async () => {
      calls++;
    }),
    first,
  );
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('a different world or actual fresh entry has its own read; there is no polling or command fallback', async () => {
  const readWorlds: string[] = [];
  const first = mapEntryRead(undefined, 'world-a', async () => {
    readWorlds.push('a');
  });
  await first.promise;
  const next = mapEntryRead(first, 'world-b', async () => {
    readWorlds.push('b');
  });
  await next.promise;
  const newMount = mapEntryRead(undefined, 'world-b', async () => {
    readWorlds.push('b-entry');
  });
  await newMount.promise;
  assert.deepEqual(readWorlds, ['a', 'b', 'b-entry']);
});

test('cached busy data is retained until the original controller read settles and failures do not auto retry', async () => {
  const cached = { busy: true };
  const read = mapEntryRead(undefined, 'world-a', async () => {
    cached.busy = false;
  });
  assert.equal(cached.busy, true);
  await read.promise;
  assert.equal(cached.busy, false);
  let attempts = 0;
  const failed = mapEntryRead(undefined, 'world-b', async () => {
    attempts++;
    throw Error('READ_FAILED');
  });
  await assert.rejects(failed.promise, /READ_FAILED/);
  assert.equal(
    mapEntryRead(failed, 'world-b', async () => {
      attempts++;
    }),
    failed,
  );
  assert.equal(attempts, 1);
});
