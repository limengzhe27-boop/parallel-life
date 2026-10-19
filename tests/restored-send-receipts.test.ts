import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reconcileRestoredSendReceipts } from '../src/features/phone/restored-send-receipts.ts';
import type { PhoneMessage } from '../src/features/phone/apps/types.ts';
import type { SendCommand } from '../src/features/phone/chat-send-state.ts';
import type { MessageReceiptLookup } from '../src/contracts/message-receipt-lookup.ts';
const worldId = randomUUID(),
  actorId = randomUUID();
function fixture(status: PhoneMessage['status'] = 'unknown') {
  const id = randomUUID();
  const message: PhoneMessage = {
    id,
    actorId,
    role: 'user',
    text: '原发送内容',
    at: '2026-10-18T09:00:00Z',
    status,
  };
  const command: SendCommand = {
    worldId,
    actorId,
    commandId: id,
    text: message.text,
    expectedVersion: 1,
  };
  return { message, command, identity: { worldId, actorId, commandId: id } };
}
test('restored known committed/failed receipts resolve through lookup only, uncertain stays preserved', async () => {
  const a = fixture(),
    b = fixture('pending'),
    c = fixture();
  const records = [a, b, c];
  const updates = await reconcileRestoredSendReceipts(
    worldId,
    records.map((r) => r.message),
    Object.fromEntries(records.map((r) => [r.command.commandId, r.command])),
    async (_world, input) => {
      if (input.commandId === a.command.commandId)
        return { ...a.identity, status: 'committed', eventId: randomUUID(), version: 2 };
      if (input.commandId === b.command.commandId)
        return { ...b.identity, status: 'failed', code: 'INVALID_AI_OUTPUT' };
      return { ...c.identity, status: 'unconfirmed' };
    },
  );
  assert.deepEqual(updates, { [a.message.id]: 'committed', [b.message.id]: 'failed' });
  assert.equal(c.message.status, 'unknown');
});
test('missing or mismatched commands and already failed messages never perform lookup', async () => {
  const a = fixture(),
    b = fixture('failed');
  let calls = 0;
  const updates = await reconcileRestoredSendReceipts(
    worldId,
    [a.message, b.message],
    { [a.message.id]: { ...a.command, text: '其他内容' }, [b.message.id]: b.command },
    async () => {
      calls++;
      throw Error('not allowed');
    },
  );
  assert.deepEqual(updates, {});
  assert.equal(calls, 0);
});
test('foreign receipt or lookup error never unblocks unknown send or requests retry', async () => {
  const a = fixture();
  for (const lookup of [
    async () =>
      ({
        ...a.identity,
        worldId: randomUUID(),
        status: 'failed',
        code: 'INVALID_STATE',
      }) as MessageReceiptLookup,
    async () => {
      throw Error('offline');
    },
  ]) {
    assert.deepEqual(
      await reconcileRestoredSendReceipts(
        worldId,
        [a.message],
        { [a.message.id]: a.command },
        lookup,
      ),
      {},
    );
  }
});
test('receipt recovery bounds simultaneous reads to three without dropping commands', async () => {
  const records = Array.from({ length: 9 }, () => fixture());
  let active = 0,
    max = 0,
    calls = 0;
  const updates = await reconcileRestoredSendReceipts(
    worldId,
    records.map((r) => r.message),
    Object.fromEntries(records.map((r) => [r.message.id, r.command])),
    async (_world, input) => {
      active++;
      max = Math.max(max, active);
      calls++;
      await Promise.resolve();
      active--;
      return {
        worldId,
        actorId,
        commandId: input.commandId,
        status: 'failed',
        code: 'INVALID_STATE',
      };
    },
  );
  assert.equal(calls, 9);
  assert.equal(max, 3);
  assert.equal(Object.keys(updates).length, 9);
});

test('only a source-bound saved response replays the exact original command once', async () => {
  const a = fixture();
  let recovered = 0;
  const updates = await reconcileRestoredSendReceipts(
    worldId,
    [a.message],
    { [a.message.id]: a.command },
    async () => ({ ...a.identity, status: 'unconfirmed', recovery: 'response_received' }),
    async (world, input) => {
      recovered++;
      assert.equal(world, worldId);
      const { worldId: _, ...expected } = a.command;
      assert.deepEqual(input, expected);
      return { ...a.identity, status: 'committed', eventId: randomUUID(), version: 2 };
    },
  );
  assert.equal(recovered, 1);
  assert.deepEqual(updates, { [a.message.id]: 'committed' });
});

test('pending, unknown, legacy or foreign lookup never authorizes replay', async () => {
  const a = fixture();
  for (const receipt of [
    { ...a.identity, status: 'unconfirmed' as const },
    { ...a.identity, status: 'unconfirmed' as const, recovery: 'pending' as const },
    { ...a.identity, status: 'unconfirmed' as const, recovery: 'unknown' as const },
    {
      ...a.identity,
      worldId: randomUUID(),
      status: 'unconfirmed' as const,
      recovery: 'response_received' as const,
    },
  ]) {
    let calls = 0;
    assert.deepEqual(
      await reconcileRestoredSendReceipts(
        worldId,
        [a.message],
        { [a.message.id]: a.command },
        async () => receipt,
        async () => {
          calls++;
          throw Error('must not replay');
        },
      ),
      {},
    );
    assert.equal(calls, 0);
  }
});

test('missing replay callback, replay interruption or foreign replay receipt preserve uncertainty', async () => {
  const a = fixture();
  const lookup = async (): Promise<MessageReceiptLookup> => ({
    ...a.identity,
    status: 'unconfirmed',
    recovery: 'response_received',
  });
  for (const recover of [
    undefined,
    async (): Promise<MessageReceiptLookup> => {
      throw Error('offline');
    },
    async (): Promise<MessageReceiptLookup> => ({
      ...a.identity,
      actorId: randomUUID(),
      status: 'committed',
      version: 2,
      eventId: randomUUID(),
    }),
    async (): Promise<MessageReceiptLookup> => ({
      ...a.identity,
      status: 'unconfirmed',
      recovery: 'unknown',
    }),
  ]) {
    assert.deepEqual(
      await reconcileRestoredSendReceipts(
        worldId,
        [a.message],
        { [a.message.id]: a.command },
        lookup,
        recover,
      ),
      {},
    );
    assert.equal(a.message.status, 'unknown');
  }
});
