import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentAttempt } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentAttemptStore } from '../src/modules/world/application/agent-runtime-ports.ts';
import { protectedMessageReplayStore } from '../src/server/npc-agent-services.ts';
import { MessageReceiptLookupSchema } from '../src/contracts/message-receipt-lookup.ts';

function fixture() {
  const attempt: AgentAttempt = {
    id: 'attempt',
    worldId: 'world',
    actorId: 'actor',
    commandId: 'command',
    inputReceiptId: 'input',
    engineEpoch: 2,
    expectedWorldVersion: 4,
    expectedActorRevision: 2,
    inputHash: 'a'.repeat(64),
    token: 'original-token',
    leaseUntil: '2026-10-19T09:00:00.000Z',
    status: 'response_received',
  };
  const calls = { claim: 0, save: 0, marks: 0, reads: 0 };
  let current: AgentAttempt | null = structuredClone(attempt);
  const store: AgentAttemptStore = {
    async lookup() {
      return current;
    },
    async claim() {
      calls.claim++;
      throw Error('UNDERLYING_CLAIM_FORBIDDEN');
    },
    async mark(_owner, a, status) {
      calls.marks++;
      return { ...a, status };
    },
    async readResponse() {
      calls.reads++;
      return { found: true, response: { protected: true } };
    },
    async saveResponse() {
      calls.save++;
      throw Error('UNDERLYING_MODEL_SAVE_FORBIDDEN');
    },
  };
  return {
    attempt,
    calls,
    store,
    setCurrent: (value: AgentAttempt | null) => {
      current = value;
    },
  };
}

test('replay-only store performs no underlying claim or cancelled-attempt resume', async () => {
  const f = fixture(),
    replay = protectedMessageReplayStore(f.store, 'owner', f.attempt);
  assert.deepEqual(await replay.claim('owner', f.attempt), { attempt: f.attempt, replay: true });
  f.setCurrent({ ...f.attempt, status: 'cancelled_before_send' });
  assert.equal(
    (await replay.claim('owner', f.attempt)).replay,
    true,
    'runner sees terminal state, never resumes it',
  );
  assert.deepEqual(f.calls, { claim: 0, save: 0, marks: 0, reads: 0 });
  f.setCurrent(null);
  await assert.rejects(replay.claim('owner', f.attempt), { code: 'NOT_FOUND' });
  assert.equal(f.calls.claim, 0);
});

test('replay-only store binds owner, exact attempt, token and command; no new paid lifecycle transitions', async () => {
  const f = fixture(),
    replay = protectedMessageReplayStore(f.store, 'owner', f.attempt);
  for (const patch of [
    { id: 'different' },
    { commandId: 'different' },
    { worldId: 'different' },
    { actorId: 'different' },
    { inputReceiptId: 'different' },
    { inputHash: 'b'.repeat(64) },
    { token: 'different' },
    { engineEpoch: 3 },
    { expectedWorldVersion: 5 },
    { expectedActorRevision: 3 },
  ])
    await assert.rejects(replay.claim('owner', { ...f.attempt, ...patch }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
  await assert.rejects(replay.claim('other-owner', f.attempt), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(replay.lookup('owner', 'world', 'other-command'), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(
    replay.mark('owner', f.attempt, 'request_sent'),
    /CANNOT_MUTATE_SEND_LIFECYCLE/,
  );
  await assert.rejects(replay.saveResponse('owner', f.attempt, {}), /CANNOT_SAVE_MODEL_RESPONSE/);
  assert.deepEqual(f.calls, { claim: 0, save: 0, marks: 0, reads: 0 });
  for (const status of [
    'unknown_after_send',
    'invalid_output',
    'reserved',
    'cancelled_before_send',
  ] as const)
    assert.throws(() => protectedMessageReplayStore(f.store, 'owner', { ...f.attempt, status }), {
      code: 'INVALID_COMMAND',
    });
});

test('replay-only read and known invalid/stale marking retain exact original protected identity', async () => {
  const f = fixture(),
    replay = protectedMessageReplayStore(f.store, 'owner', f.attempt);
  assert.deepEqual(await replay.readResponse('owner', f.attempt), {
    found: true,
    response: { protected: true },
  });
  assert.equal((await replay.mark('owner', f.attempt, 'invalid_output')).status, 'invalid_output');
  assert.equal(
    (await replay.mark('owner', f.attempt, 'stale_discarded')).status,
    'stale_discarded',
  );
  assert.deepEqual(f.calls, { claim: 0, save: 0, marks: 2, reads: 1 });
});

test('receipt schema keeps legacy unconfirmed and accepts only explicit safe recovery states', () => {
  const identity = {
    status: 'unconfirmed',
    commandId: '11111111-1111-4111-8111-111111111111',
    worldId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333',
  };
  assert.deepEqual(MessageReceiptLookupSchema.parse(identity), identity);
  for (const recovery of ['pending', 'response_received', 'unknown'])
    assert.equal(
      (MessageReceiptLookupSchema.parse({ ...identity, recovery }) as any).recovery,
      recovery,
    );
  for (const recovery of ['retry', 'restart', 'paid', 'invalid_output'])
    assert.equal(MessageReceiptLookupSchema.safeParse({ ...identity, recovery }).success, false);
  assert.equal(
    MessageReceiptLookupSchema.safeParse({ ...identity, response: 'private raw response' }).success,
    false,
  );
});
