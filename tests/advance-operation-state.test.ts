import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceOperationState,
  type AdvanceWorkState,
} from '../src/modules/world/domain/advance-operation.ts';
import {
  advanceRecoveryAction,
  restorePendingAdvances,
} from '../src/features/phone/advance-recovery-state.ts';
const work = (status: AdvanceWorkState['status']): AdvanceWorkState => ({
  kind: 'npc',
  commandId: 'request',
  status,
});
test('original batch state preserves unknown and protected work, including partial success', () => {
  const base = { finished: true, succeeded: false, leaseActive: false };
  assert.equal(
    advanceOperationState({ ...base, work: [work('committed'), work('unknown_after_send')] }),
    'unknown',
  );
  assert.equal(
    advanceOperationState({
      ...base,
      work: [work('response_received'), work('unknown_after_send')],
    }),
    'recoverable',
  );
  assert.equal(
    advanceOperationState({ ...base, work: [work('committed'), work('invalid_output')] }),
    'failed',
  );
  assert.equal(
    advanceOperationState({
      ...base,
      finished: false,
      leaseActive: true,
      work: [work('committed')],
    }),
    'running',
  );
  assert.equal(
    advanceOperationState({ ...base, finished: false, work: [work('committed')] }),
    'complete',
  );
  assert.equal(advanceOperationState({ ...base, finished: false, work: [] }), 'failed');
});
test('long-lived unknown remains queryable without granting new execution', () => {
  const item = {
    id: '8bf93ee1-27ec-44b9-9e57-7a4b3512bc9a',
    key: 'original',
    attempts: 12,
    nextCheckAt: 10,
    state: 'unknown' as const,
  };
  assert.equal(advanceRecoveryAction(item, 11), 'lookup');
  assert.equal(advanceRecoveryAction({ ...item, state: 'recoverable' }, 11), 'recover');
  assert.equal(advanceRecoveryAction({ ...item, state: 'failed' }, 11), null);
  assert.equal(advanceRecoveryAction(item, 9), null);
  assert.deepEqual(restorePendingAdvances(JSON.stringify([item])), [item]);
  assert.deepEqual(restorePendingAdvances('invalid'), []);
});

test('presentation deferral remains recoverable waiting, not a transport failure or retry permission', async () => {
  const { advanceRecoveryWaitReason } =
    await import('../src/modules/world/domain/advance-operation.ts');
  for (const code of [
    'EPISODE_DELIVERY_DEFERRED',
    'NPC_DELIVERY_DEFERRED',
    'DIRECTOR_DELIVERY_DEFERRED',
  ])
    assert.equal(advanceRecoveryWaitReason({ code }), 'clock_or_attention');
  for (const code of ['UNKNOWN', 'TIMEOUT', 'VERSION_CONFLICT', 'INVALID_AGENT_PROPOSAL'])
    assert.equal(advanceRecoveryWaitReason({ code }), null);
});

test('waiting metadata is negotiated without breaking cached strict receipt clients', async () => {
  const { advanceOperationClientReceipt } = await import('../src/contracts/advance-operation.ts');
  const receipt = {
    worldId: 'world',
    operationId: 'id',
    status: 'recoverable' as const,
    work: [],
    waitingOn: 'clock_or_attention' as const,
  };
  assert.equal(advanceOperationClientReceipt(receipt, '2').waitingOn, 'clock_or_attention');
  assert.equal('waitingOn' in advanceOperationClientReceipt(receipt, null), false);
  assert.equal(receipt.waitingOn, 'clock_or_attention');
});
