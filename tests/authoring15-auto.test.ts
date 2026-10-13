import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAdvanceAttemptKey,
  autoAdvanceDue,
  PhoneStoryBootstrap,
  storyBootstrapEligible,
} from '../src/features/phone/auto-advance.ts';
import { LifeClient } from '../src/features/api/client.ts';
const worldId = '00000000-0000-4000-8000-000000000001';
const anchor = Date.parse('2026-10-13T10:00:00.000Z');
const clock = { paused: false, speed: 1, lastTickAt: new Date(anchor).toISOString() };
const ready = { totalNodes: 2, presented: [], pending: null };
test('an unchanged story anchor gets one attempt key per real 30-minute window', () => {
  const first = autoAdvanceAttemptKey(worldId, clock, anchor + 31 * 60000);
  assert.equal(first, autoAdvanceAttemptKey(worldId, clock, anchor + 59 * 60000));
  assert.notEqual(first, autoAdvanceAttemptKey(worldId, clock, anchor + 60 * 60000));
  assert.notEqual(first, autoAdvanceAttemptKey('another-world', clock, anchor + 31 * 60000));
  assert.notEqual(
    first,
    autoAdvanceAttemptKey(
      worldId,
      { ...clock, lastTickAt: new Date(anchor + 60000).toISOString() },
      anchor + 31 * 60000,
    ),
  );
  const attempted = new Set([first]);
  assert.equal(attempted.has(autoAdvanceAttemptKey(worldId, clock, anchor + 32 * 60000)), true);
  assert.equal(attempted.has(autoAdvanceAttemptKey(worldId, clock, anchor + 61 * 60000)), false);
  // Reading the next window never clears the previous failure/unknown marker.
  assert.equal(attempted.has(first), true);
});
test('paused or invalid clocks cannot produce a bootstrap attempt, while generic cadence remains intact', () => {
  for (const invalid of [
    { ...clock, paused: true },
    { ...clock, speed: 0 },
    { ...clock, speed: Number.NaN },
    { ...clock, lastTickAt: 'invalid' },
  ]) {
    assert.equal(autoAdvanceAttemptKey(worldId, invalid, anchor), null);
  }
  assert.equal(autoAdvanceAttemptKey(worldId, clock, anchor - 1), null);
  assert.equal(autoAdvanceAttemptKey(worldId, clock, Number.NaN), null);
  assert.equal(autoAdvanceDue(clock, anchor + 29 * 60000), false);
  assert.equal(autoAdvanceDue(clock, anchor + 30 * 60000), true);
});
test('only an unstarted story with no pending claim is eligible for early entry', () => {
  assert.equal(storyBootstrapEligible(ready), true);
  assert.equal(storyBootstrapEligible({ ...ready, totalNodes: 0 }), false);
  assert.equal(storyBootstrapEligible({ ...ready, presented: [{}] }), false);
  assert.equal(storyBootstrapEligible({ ...ready, pending: { status: 'claimed' } }), false);
  assert.equal(storyBootstrapEligible({ ...ready, pending: { status: 'unknown' } }), false);
});
test('empty, started and pending stories are cached without minute-by-minute reads or stale reopening', async () => {
  for (const snapshot of [
    { ...ready, totalNodes: 0 },
    { ...ready, presented: [{}] },
    { ...ready, pending: { status: 'unknown' } },
  ]) {
    const gate = new PhoneStoryBootstrap();
    let reads = 0;
    const read = async () => {
      reads++;
      return snapshot;
    };
    assert.equal(await gate.check(worldId, 0, read), false);
    assert.equal(await gate.check(worldId, 0, read), false);
    assert.equal(await gate.check(worldId, 1, read), false);
    assert.equal(reads, 1);
  }
});
test('a ready cache rechecks after saved world changes, and a consumed opening is never automatically retried', async () => {
  const gate = new PhoneStoryBootstrap();
  let reads = 0;
  assert.equal(
    await gate.check(worldId, 0, async () => {
      reads++;
      return ready;
    }),
    true,
  );
  assert.equal(
    await gate.check(worldId, 0, async () => {
      throw Error('should not read');
    }),
    true,
  );
  assert.equal(
    await gate.check(worldId, 1, async () => {
      reads++;
      return { ...ready, presented: [{}] };
    }),
    false,
  );
  assert.equal(reads, 2);
  const other = 'other-world';
  assert.equal(await gate.check(other, 0, async () => ready), true);
  gate.consume(other);
  assert.equal(
    await gate.check(other, 1, async () => {
      throw Error('lost response must not repeat');
    }),
    false,
  );
});
test('an unreadable progress response cannot manufacture an opening or be retried every minute', async () => {
  const gate = new PhoneStoryBootstrap();
  let reads = 0;
  const read = async () => {
    reads++;
    throw Error('network unavailable');
  };
  assert.equal(await gate.check(worldId, 0, read), false);
  assert.equal(await gate.check(worldId, 0, read), false);
  assert.equal(reads, 1);
  assert.equal(
    await gate.check(worldId, 1, async () => {
      reads++;
      return ready;
    }),
    true,
  );
  assert.equal(reads, 2);
});
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
