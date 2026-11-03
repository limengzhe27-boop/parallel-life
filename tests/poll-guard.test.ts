import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFailure, LifeClient } from '../src/features/api/client.ts';
import {
  notePollFailure,
  notePollSuccess,
  pollingAllowed,
  resetPollGuard,
  worldPollDelay,
} from '../src/features/phone/poll-guard.ts';

const failure = (status?: number) =>
  new ApiFailure('UNAVAILABLE', 'unavailable', undefined, status);

test('an explicit 402 pauses background polls immediately', () => {
  resetPollGuard();
  const now = 1_000;
  notePollFailure('world', failure(402), now);
  assert.equal(pollingAllowed('world', now + 1), false);
  assert.equal(pollingAllowed('world', now + 15 * 60_000), true);
});

test('503 pauses only after a short streak, not on the first transient failure', () => {
  resetPollGuard();
  const now = 5_000;
  notePollFailure('world', failure(503), now);
  notePollFailure('world', failure(503), now + 1_000);
  assert.equal(pollingAllowed('world', now + 2_000), true);
  notePollFailure('world', failure(503), now + 3_000);
  assert.equal(pollingAllowed('world', now + 4_000), false);
  assert.equal(pollingAllowed('world', now + 3_000 + 60_000), true);
});

test('a successful poll clears the gate and the streak', () => {
  resetPollGuard();
  notePollFailure('world', failure(402), 0);
  assert.equal(pollingAllowed('world', 1), false);
  notePollSuccess('world');
  assert.equal(pollingAllowed('world', 1), true);

  notePollFailure('world', failure(503), 0);
  notePollFailure('world', failure(503), 1);
  notePollSuccess('world');
  notePollFailure('world', failure(503), 2);
  assert.equal(pollingAllowed('world', 3), true);
});

test('other failures and network errors keep the existing retry policy', () => {
  resetPollGuard();
  notePollFailure('world', failure(500), 0);
  notePollFailure('world', failure(401), 0);
  notePollFailure('world', new Error('offline'), 0);
  notePollFailure('world', failure(undefined), 0);
  assert.equal(pollingAllowed('world', 0), true);
});

test('the real client keeps a plain-text 402 status', async () => {
  const transport = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/session'))
      return new Response(JSON.stringify({ kind: 'guest', csrfToken: 'x'.repeat(32) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    return new Response('Payment required', { status: 402 });
  };
  const client = new LifeClient(transport as typeof fetch);
  await assert.rejects(client.world('00000000-0000-4000-8000-000000000000'), (error) => {
    assert.ok(error instanceof ApiFailure);
    assert.equal(error.status, 402);
    resetPollGuard();
    notePollFailure('world', error, 0);
    assert.equal(pollingAllowed('world', 1), false);
    return true;
  });
});

test('healthy clock/world polls never erase an advance 503 streak or backoff', () => {
  resetPollGuard();
  for (let i = 0; i < 3; i++) {
    notePollFailure('advance', failure(503), i);
    notePollSuccess('clock');
    notePollSuccess('world');
  }
  assert.equal(pollingAllowed('advance', 3), false);
  assert.equal(pollingAllowed('clock', 3), true);
  assert.equal(pollingAllowed('world', 3), true);
  notePollSuccess('advance');
  assert.equal(pollingAllowed('advance', 3), true);
});

test('402 pauses all automatic services until recovery of the affected service or expiry', () => {
  resetPollGuard();
  notePollFailure('advance', failure(402), 10);
  notePollSuccess('world');
  notePollSuccess('clock');
  for (const scope of ['world', 'clock', 'advance'] as const) {
    assert.equal(pollingAllowed(scope, 11), false);
    assert.equal(pollingAllowed(scope, 10 + 15 * 60_000), true);
  }
  notePollSuccess('advance');
  assert.equal(pollingAllowed('world', 11), true);
});

test('pending media accelerates reads only for a bounded real observation window', () => {
  const observedAt = 1_000_000;
  assert.equal(worldPollDelay(true, observedAt, observedAt), 3_000);
  assert.equal(worldPollDelay(true, observedAt, observedAt + 299_999), 3_000);
  assert.equal(worldPollDelay(true, observedAt, observedAt + 300_000), 10_000);
  assert.equal(worldPollDelay(true, observedAt, observedAt + 86_400_000), 10_000);
  assert.equal(worldPollDelay(false, observedAt, observedAt), 10_000);
});
