import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiFailure, LifeClient } from '../src/features/api/client.ts';
import {
  notePollFailure,
  notePollSuccess,
  pollingAllowed,
  resetPollGuard,
} from '../src/features/phone/poll-guard.ts';

const failure = (status?: number) =>
  new ApiFailure('UNAVAILABLE', 'unavailable', undefined, status);

test('an explicit 402 pauses background polls immediately', () => {
  resetPollGuard();
  const now = 1_000;
  notePollFailure(failure(402), now);
  assert.equal(pollingAllowed(now + 1), false);
  assert.equal(pollingAllowed(now + 15 * 60_000), true);
});

test('503 pauses only after a short streak, not on the first transient failure', () => {
  resetPollGuard();
  const now = 5_000;
  notePollFailure(failure(503), now);
  notePollFailure(failure(503), now + 1_000);
  assert.equal(pollingAllowed(now + 2_000), true);
  notePollFailure(failure(503), now + 3_000);
  assert.equal(pollingAllowed(now + 4_000), false);
  assert.equal(pollingAllowed(now + 3_000 + 60_000), true);
});

test('a successful poll clears the gate and the streak', () => {
  resetPollGuard();
  notePollFailure(failure(402), 0);
  assert.equal(pollingAllowed(1), false);
  notePollSuccess();
  assert.equal(pollingAllowed(1), true);

  notePollFailure(failure(503), 0);
  notePollFailure(failure(503), 1);
  notePollSuccess();
  notePollFailure(failure(503), 2);
  assert.equal(pollingAllowed(3), true);
});

test('other failures and network errors keep the existing retry policy', () => {
  resetPollGuard();
  notePollFailure(failure(500), 0);
  notePollFailure(failure(401), 0);
  notePollFailure(new Error('offline'), 0);
  notePollFailure(failure(undefined), 0);
  assert.equal(pollingAllowed(0), true);
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
    notePollFailure(error, 0);
    assert.equal(pollingAllowed(1), false);
    return true;
  });
});
