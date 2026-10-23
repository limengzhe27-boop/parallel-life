import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleEpisodeDispatches,
  episodeRequestWorkState,
  episodeDispatchAttempt,
  type EpisodeDispatchAttempt,
} from '../src/modules/world/infrastructure/agent-episode-dispatch-eligibility.ts';
import type { AgentEpisodeRequest } from '../src/modules/world/domain/agent-narrative.ts';
import { DomainError } from '../src/modules/world/domain/errors.ts';
import { OpeningStatusSchema } from '../src/contracts/publication-opening.ts';

const worldId = 'world-a';
const version = 7;
const actorA = 'actor-a';
const actorB = 'actor-b';
const zeroCommand = 'fdf14f58-70ea-88c0-a73f-7df97323ce8c';
const oneCancelCommand = '03281bd8-3696-842a-a575-41db6a98d50f';
const twoCancelCommand = '13e56bbe-df5e-89a0-ac86-257d9cf8af51';

function request(id = 'request-a', actorId = actorA): AgentEpisodeRequest {
  return {
    schemaVersion: 1,
    worldId,
    actorId,
    id,
    episodeId: 'episode-a',
    originDecisionId: 'director-decision-a',
    engineEpoch: 2,
    createdAtVersion: 0,
    activity: 'conversation',
    status: 'pending',
    inputReceiptId: null,
    receiptId: null,
  };
}
function row(overrides: Partial<Parameters<typeof episodeDispatchAttempt>[0]> = {}) {
  return {
    actor_id: actorA,
    command_id: zeroCommand,
    status: 'cancelled_before_send',
    sent_at: null,
    response_hash: null,
    document: {
      origin: 'coordination',
      text: JSON.stringify({ type: 'npc_episode_consideration', requestId: 'request-a' }),
    },
    ...overrides,
  };
}
function attempt(patch: Partial<EpisodeDispatchAttempt> = {}): EpisodeDispatchAttempt {
  return { ...episodeDispatchAttempt(row()), ...patch };
}
function eligible(
  requests: readonly AgentEpisodeRequest[] = [request()],
  attempts: readonly EpisodeDispatchAttempt[] = [],
) {
  return eligibleEpisodeDispatches(worldId, version, requests, attempts);
}
// Literal fixtures captured from the pre-extraction v2 algorithm; do not derive expected IDs
// using the new helper (or a second implementation of its hash) inside these tests.
test('first dispatch retains the exact pre-extraction v2 business command', () => {
  const input = request();
  assert.deepEqual(eligible([input]), [{ request: input, commandId: zeroCommand }]);
});

test('eligible request order is preserved without sorting actors or episode IDs', () => {
  const requests = [request('request-b', actorB), request('request-a', actorA)];
  const result = eligible(requests);
  assert.deepEqual(
    result.map((x) => x.request.id),
    ['request-b', 'request-a'],
  );
  assert.equal(result[1]!.commandId, zeroCommand);
  assert.equal(result[0]!.commandId, '5480012e-07ee-8ddf-a7a3-4a73979b85c0');
  assert.deepEqual(eligible([]), []);
});

test('v2 command varies only with the world, request, version and proven zero-send count', () => {
  assert.equal(
    eligibleEpisodeDispatches('world-b', version, [request()], [])[0]!.commandId,
    'e7124dc4-9925-84b8-a824-29ff4e7a8089',
  );
  assert.equal(
    eligibleEpisodeDispatches(worldId, 8, [request()], [])[0]!.commandId,
    '2a9c5eda-44f4-80d7-a6b7-a1e488c8125d',
  );
  const changed = {
    ...request(),
    activity: 'follow_up' as const,
    episodeId: 'different-episode',
    originDecisionId: 'different-director',
  };
  assert.equal(eligible([changed])[0]!.commandId, zeroCommand);
});

test('dispatch uses actor work identity without a presentation-focus parameter', () => {
  assert.deepEqual(
    eligible([request(), request('request-b', actorB)]).map((x) => x.request.actorId),
    [actorA, actorB],
  );
});

for (const status of ['reserved', 'request_sent', 'response_received', 'unknown_after_send'])
  test(`own ${status} attempt blocks a new request without blocking the other actor`, () => {
    const prior = attempt({ requestId: 'other-request', status, paid: false });
    const result = eligible([request(), request('request-b', actorB)], [prior]);
    assert.deepEqual(
      result.map((x) => x.request.actorId),
      [actorB],
    );
  });

for (const status of ['reserved', 'request_sent', 'response_received', 'unknown_after_send'])
  test(`another actor's ${status} attempt is not a global blocker`, () => {
    const prior = attempt({ actorId: actorB, requestId: 'other-request', status, paid: true });
    assert.equal(eligible([request()], [prior])[0]!.commandId, zeroCommand);
  });

for (const status of [
  'unknown_after_send',
  'invalid_output',
  'stale_discarded',
  'cancelled_before_send',
  'response_received',
  'request_sent',
])
  test(`paid ${status} for this exact request cannot be renamed into a new evaluation`, () => {
    assert.deepEqual(
      eligible([request()], [attempt({ status, paid: true, commandId: 'historical-command' })]),
      [],
    );
  });

test('a response hash without sent_at is still paid and cannot count as zero-send cancellation', () => {
  const rawOnly = episodeDispatchAttempt(row({ response_hash: 'stored-response-hash' }));
  assert.equal(rawOnly.paid, true);
  assert.deepEqual(eligible([request()], [rawOnly]), []);
  const invalidRaw = episodeDispatchAttempt(
    row({ status: 'invalid_output', response_hash: 'stored-response-hash' }),
  );
  assert.deepEqual(eligible([request()], [invalidRaw]), []);
});

test('only exact request zero-send cancelled terminals contribute to the stable successor', () => {
  const prior = attempt();
  assert.equal(eligible([request()], [prior])[0]!.commandId, oneCancelCommand);
  const twice = [prior, attempt({ commandId: oneCancelCommand })];
  assert.equal(eligible([request()], twice)[0]!.commandId, twoCancelCommand);
  assert.equal(eligible([request()], [...twice].reverse())[0]!.commandId, twoCancelCommand);
  assert.equal(
    eligible(
      [request()],
      [...twice, attempt({ requestId: 'different-request', commandId: 'unrelated' })],
    )[0]!.commandId,
    twoCancelCommand,
  );
});

test('unpaid stale or invalid terminals do not increment the cancellation counter', () => {
  for (const status of ['stale_discarded', 'invalid_output']) {
    const prior = attempt({ status, commandId: 'different-historical-command' });
    assert.equal(eligible([request()], [prior])[0]!.commandId, zeroCommand);
  }
});

test('a prior exact command suppresses dispatch even if unpaid and terminal', () => {
  for (const status of ['stale_discarded', 'invalid_output'])
    assert.deepEqual(eligible([request()], [attempt({ status })]), []);
  assert.deepEqual(
    eligible(
      [request()],
      [attempt(), attempt({ status: 'stale_discarded', commandId: oneCancelCommand })],
    ),
    [],
  );
});

test('committed attempt plus still-pending request is a missing-receipt invariant error', () => {
  assert.throws(
    () => eligible([request()], [attempt({ status: 'committed', paid: true })]),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'INVALID_PROPOSAL' &&
      error.message === 'EPISODE_CONSUMPTION_RECEIPT_MISSING',
  );
  assert.throws(() => eligible([request()], [attempt({ status: 'committed', paid: false })]), {
    message: 'EPISODE_CONSUMPTION_RECEIPT_MISSING',
  });
});

test('a committed unrelated request does not fabricate a missing receipt for this request', () => {
  assert.equal(
    eligible(
      [request()],
      [attempt({ status: 'committed', paid: true, requestId: 'unrelated-request' })],
    )[0]!.commandId,
    zeroCommand,
  );
});

test('only an immutable coordination consideration body classifies its request identity', () => {
  const result = episodeDispatchAttempt(row());
  assert.deepEqual(result, {
    actorId: actorA,
    commandId: zeroCommand,
    status: 'cancelled_before_send',
    paid: false,
    requestId: 'request-a',
  });
  for (const origin of ['wake', 'player', 'director', 'coordination '])
    assert.equal(
      episodeDispatchAttempt(row({ document: { origin, text: row().document.text } })).requestId,
      null,
    );
});

for (const text of [
  'not JSON',
  'null',
  '[]',
  '42',
  '{}',
  '{"type":"other","requestId":"request-a"}',
  '{"type":"npc_episode_consideration","requestId":7}',
  '{"type":"npc_episode_consideration"}',
])
  test(`coordination body ${JSON.stringify(text)} grants no episode classification`, () => {
    assert.equal(
      episodeDispatchAttempt(row({ document: { origin: 'coordination', text } })).requestId,
      null,
    );
  });

test('actor and command identities come from the actual attempt row, never body extra properties', () => {
  const input = row({
    document: {
      origin: 'coordination',
      text: JSON.stringify({
        type: 'npc_episode_consideration',
        requestId: 'request-a',
        actorId: actorB,
        commandId: 'forged-command',
        privateTranscript: 'secret',
      }),
    },
  });
  assert.deepEqual(episodeDispatchAttempt(input), {
    actorId: actorA,
    commandId: zeroCommand,
    status: 'cancelled_before_send',
    paid: false,
    requestId: 'request-a',
  });
});

for (const payment of [
  { sent_at: '2040-01-01T00:00:00Z' },
  { response_hash: 'response-only' },
  { sent_at: '2040-01-01T00:00:00Z', response_hash: 'response' },
])
  test(`actual nonnull payment markers ${JSON.stringify(payment)} remain irreversible at classification`, () => {
    assert.equal(episodeDispatchAttempt(row(payment)).paid, true);
  });

test('frozen input arrays and rows are not mutated by classification or filtering', () => {
  const inputRow = row();
  Object.freeze(inputRow.document);
  Object.freeze(inputRow);
  assert.deepEqual(episodeDispatchAttempt(inputRow), attempt());
  const requests = [request(), request('request-b', actorB)];
  const attempts = [attempt({ actorId: actorB, requestId: 'another', status: 'reserved' })];
  const before = structuredClone({ requests, attempts });
  for (const item of requests) Object.freeze(item);
  for (const item of attempts) Object.freeze(item);
  Object.freeze(requests);
  Object.freeze(attempts);
  assert.equal(eligible(requests, attempts).length, 1);
  assert.deepEqual({ requests, attempts }, before);
});

const opening = {
  runtime: 'agents' as const,
  phase: 'unplanned' as const,
  total: 0,
  delivered: 0,
  retryable: false,
};
const key = 'a'.repeat(64);
for (const continuation of [
  { status: 'ready', key },
  { status: 'quiet' },
  { status: 'pending' },
  { status: 'deferred' },
])
  test(`strict public continuation ${continuation.status} carries no prose or hidden authority`, () => {
    const parsed = OpeningStatusSchema.parse({ ...opening, continuation });
    assert.deepEqual(parsed, { ...opening, continuation });
    assert.deepEqual(
      Object.keys(parsed.continuation!).sort(),
      continuation.status === 'ready' ? ['key', 'status'] : ['status'],
    );
  });

for (const continuation of [
  { status: 'ready' },
  { status: 'ready', key: 'A'.repeat(64) },
  { status: 'ready', key: 'a'.repeat(63) },
  { status: 'ready', key: 'a'.repeat(65) },
  { status: 'ready', key: 'raw-node-id' },
  { status: 'ready', key: 7 },
  { status: 'quiet', key },
  { status: 'pending', key },
  { status: 'deferred', key },
  { status: 'recoverable', key },
  { status: 'complete' },
  null,
])
  test(`malformed continuation ${JSON.stringify(continuation)} is rejected`, () => {
    assert.equal(OpeningStatusSchema.safeParse({ ...opening, continuation }).success, false);
  });

for (const secret of [
  'source',
  'nodeHash',
  'genesisHash',
  'actorIds',
  'privateTranscript',
  'audit',
  'raw',
  'commandId',
  'capability',
])
  test(`public continuation refuses secret or authority extension ${secret}`, () => {
    assert.equal(
      OpeningStatusSchema.safeParse({
        ...opening,
        continuation: { status: 'ready', key, [secret]: 'private' },
      }).success,
      false,
    );
    assert.equal(
      OpeningStatusSchema.safeParse({
        ...opening,
        continuation: { status: 'quiet', [secret]: 'private' },
      }).success,
      false,
    );
    assert.equal(OpeningStatusSchema.safeParse({ ...opening, [secret]: 'private' }).success, false);
  });

test('old opening envelopes keep their exact shape without a default continuation or native runtime', () => {
  const legacy = { phase: 'complete' as const, total: 1, delivered: 1, retryable: false };
  assert.deepEqual(OpeningStatusSchema.parse(legacy), legacy);
  assert.deepEqual(OpeningStatusSchema.parse(opening), opening);
  assert.equal('continuation' in OpeningStatusSchema.parse(legacy), false);
});

test('an explicit dispatch may freshly evaluate a known invalid response, never an unknown or paid success', () => {
  const invalid = [attempt({ status: 'invalid_output', paid: true })];
  const fresh = eligibleEpisodeDispatches(worldId, version, [request()], invalid, {
    allowKnownInvalid: true,
    freshCommand: 'owner-review-1',
  });
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0]!.commandId, zeroCommand);
  assert.deepEqual(eligible([request()], invalid), []);
  assert.deepEqual(
    eligibleEpisodeDispatches(
      worldId,
      version,
      [request()],
      [attempt({ status: 'unknown_after_send', paid: true })],
      { allowKnownInvalid: true, freshCommand: 'owner-review-1' },
    ),
    [],
  );
  assert.throws(
    () =>
      eligibleEpisodeDispatches(
        worldId,
        version,
        [request()],
        [attempt({ status: 'committed', paid: true })],
        { allowKnownInvalid: true, freshCommand: 'owner-review-1' },
      ),
    /EPISODE_CONSUMPTION_RECEIPT_MISSING/,
  );
});

test('paid terminal does not occupy work, but cannot be dispatched again; unknown still waits', () => {
  for (const status of ['invalid_output', 'stale_discarded']) {
    const attempts = [attempt({ status, paid: true })];
    assert.equal(episodeRequestWorkState('request-a', attempts), 'paid_terminal');
    assert.deepEqual(eligible([request()], attempts), []);
    assert.equal(eligible([request('request-b', actorA)], attempts).length, 1);
  }
  assert.equal(
    episodeRequestWorkState('request-a', [attempt({ status: 'unknown_after_send', paid: true })]),
    'in_flight',
  );
  assert.equal(episodeRequestWorkState('request-a', [attempt()]), 'available');
});
