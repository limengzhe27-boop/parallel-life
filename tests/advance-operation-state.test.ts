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

test('repeated checks of the same unknown work retain one query identity without losing independent work', async () => {
  const { coalesceAdvanceRecovery } =
    await import('../src/features/phone/advance-recovery-state.ts');
  const items = Array.from({ length: 30 }, (_, n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    key: `idle:${n}`,
    attempts: 1,
    nextCheckAt: n,
    state: 'unknown' as const,
    receipt: {
      worldId: '00000000-0000-4000-8000-000000000099',
      operationId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      status: 'unknown' as const,
      work: [
        {
          kind: 'director' as const,
          commandId: '00000000-0000-4000-8000-000000000098',
          status: 'unknown_after_send' as const,
        },
        {
          kind: 'npc' as const,
          commandId: `00000000-0000-4000-8000-${String(n + 100).padStart(12, '0')}`,
          status: 'committed' as const,
        },
      ],
    },
  }));
  const compact = coalesceAdvanceRecovery(items);
  assert.equal(compact.length, 1);
  assert.equal(compact[0]?.id, items[29]?.id);
  assert.equal(advanceRecoveryAction(compact[0]!, 100), 'lookup');
  assert.equal(restorePendingAdvances(JSON.stringify(items)).length, 1);
  const separate = {
    ...items[0]!,
    receipt: {
      ...items[0]!.receipt,
      work: [
        {
          kind: 'npc' as const,
          commandId: '00000000-0000-4000-8000-000000000097',
          status: 'unknown_after_send' as const,
        },
      ],
    },
  };
  assert.equal(coalesceAdvanceRecovery([...items, separate]).length, 2);
  const running = {
    ...items[0]!,
    state: 'running' as const,
    receipt: { ...items[0]!.receipt, status: 'running' as const },
  };
  assert.equal(coalesceAdvanceRecovery([...items, running]).length, 2);
  assert.equal(items.length, 30);
});
