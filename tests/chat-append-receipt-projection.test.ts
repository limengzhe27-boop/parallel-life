import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  committedMessageEvents,
  worldMessageClientReceipt,
  WORLD_MESSAGE_PROJECTION_VERSION,
  WorldMessageReceiptSchema,
  type WorldMessageReceipt,
} from '../src/contracts/world-interaction.ts';
import {
  projectCommittedTurnReceipt,
  unprojectedLocalSends,
  committedLocalSend,
} from '../src/features/phone/send-projection.ts';
import {
  annotatePartialReplies,
  restorePartialReplyCommands,
} from '../src/features/phone/partial-replies.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';
import type { PhoneMessage } from '../src/features/phone/apps/types.ts';
import { reconcileRestoredSendReceipts } from '../src/features/phone/restored-send-receipts.ts';

const worldId = randomUUID(),
  actorId = randomUUID(),
  commandId = randomUUID();
const first = randomUUID(),
  second = randomUUID(),
  final = randomUUID();
const at = '2026-10-20T08:00:00Z';
const messages = [
  {
    id: `${first}_user`,
    actorId,
    role: 'user' as const,
    text: '说说看',
    at,
    sourceEventId: first,
    sourceVersion: 1,
  },
  {
    id: `${first}_0`,
    actorId,
    role: 'assistant' as const,
    text: '我先说一件事。',
    at,
    sourceEventId: first,
    sourceVersion: 1,
  },
  {
    id: `${second}_1`,
    actorId,
    role: 'assistant' as const,
    text: '还有另一件事。',
    at,
    sourceEventId: second,
    sourceVersion: 3,
  },
];
const receipt: WorldMessageReceipt = {
  status: 'committed',
  worldId,
  actorId,
  commandId,
  eventId: final,
  version: 4,
  messages,
  messageEvents: committedMessageEvents(messages),
  streamSummary: { completionStatus: 'completed', committedSegmentCount: 2, totalSegmentCount: 2 },
};
const world = { id: worldId, time: at, version: 2, messages: [] } as unknown as WorldPhone;
test('one receipt projects independently saved units without relabelling their event ownership', () => {
  const parsed = WorldMessageReceiptSchema.parse(receipt);
  assert.equal(parsed.messages?.[0]?.sourceEventId, first);
  assert.equal(parsed.messages?.[2]?.sourceVersion, 3);
  const projected = projectCommittedTurnReceipt(world, parsed);
  assert.equal(projected.version, 4);
  assert.deepEqual(
    projected.messages.map((m) => m.id),
    messages.map((m) => m.id),
  );
  assert.deepEqual(projectCommittedTurnReceipt(projected, parsed), projected);
  const local: PhoneMessage = {
    id: commandId,
    actorId,
    role: 'user',
    text: '说说看',
    at,
    status: 'pending',
  };
  assert.deepEqual(
    unprojectedLocalSends([committedLocalSend(worldId, local, receipt)], projected.messages, {
      [commandId]: receipt,
    }),
    [],
  );
});
test('unproven, conflicting and future unit identities are rejected', () => {
  assert.throws(
    () => projectCommittedTurnReceipt(world, { ...receipt, messageEvents: [] }),
    /IDENTITY/,
  );
  assert.throws(
    () =>
      projectCommittedTurnReceipt(world, {
        ...receipt,
        messageEvents: [...receipt.messageEvents!, receipt.messageEvents![0]!],
      }),
    /IDENTITY/,
  );
  assert.throws(
    () =>
      projectCommittedTurnReceipt(world, {
        ...receipt,
        messageEvents: [{ eventId: first, version: 99 }],
      }),
    /IDENTITY/,
  );
  assert.throws(
    () =>
      projectCommittedTurnReceipt(world, {
        ...receipt,
        messages: [{ ...messages[0]!, actorId: randomUUID() }],
      }),
    /IDENTITY/,
  );
});
test('final receipt merges earlier prefix before an intervening message', () => {
  const between = {
    id: randomUUID(),
    actorId: randomUUID(),
    role: 'assistant' as const,
    text: '中间的来信',
    at: '2026-10-20T08:00:01Z',
  };
  const current = { ...world, messages: [between] };
  const result = projectCommittedTurnReceipt(current, {
    ...receipt,
    messages: messages.map((m) =>
      m.sourceVersion === 3 ? { ...m, at: '2026-10-20T08:00:02Z' } : m,
    ),
  });
  assert.deepEqual(
    result.messages.map((m) => m.id),
    [messages[0]!.id, messages[1]!.id, between.id, messages[2]!.id],
  );
});
test('partial reply annotates only its saved NPC bubble, not the delivered player input', () => {
  const phone = messages.map((m) => ({ ...m, status: 'sent' as const }));
  const partial = {
    ...receipt,
    streamSummary: { ...receipt.streamSummary!, completionStatus: 'partial_interrupted' as const },
  };
  const result = annotatePartialReplies(phone, [partial]);
  assert.equal(result[0]?.status, 'sent');
  assert.equal(result[0]?.replyInterrupted, undefined);
  assert.equal(result[1]?.replyInterrupted, undefined);
  assert.equal(result[2]?.replyInterrupted, true);
  assert.deepEqual(annotatePartialReplies(phone, [receipt]), phone);
  assert.deepEqual(
    annotatePartialReplies(phone, [
      { ...partial, streamSummary: { ...partial.streamSummary, completionStatus: 'superseded' } },
    ]),
    phone,
  );
});
test('refresh storage restores only bounded same-world lookup commands, never a claimed outcome', () => {
  const command = { worldId, actorId, commandId, text: '说说看', expectedVersion: 0 };
  assert.deepEqual(restorePartialReplyCommands(JSON.stringify([command]), worldId), [command]);
  assert.deepEqual(
    restorePartialReplyCommands(JSON.stringify([{ ...command, receipt }]), worldId),
    [],
  );
  assert.deepEqual(restorePartialReplyCommands(JSON.stringify([command]), randomUUID()), []);
  assert.deepEqual(restorePartialReplyCommands('{bad', worldId), []);
});
test('multi-event receipt needs negotiated projection; old clients retain their envelope', () => {
  assert.deepEqual(worldMessageClientReceipt(receipt, WORLD_MESSAGE_PROJECTION_VERSION), receipt);
  assert.deepEqual(Object.keys(worldMessageClientReceipt(receipt, '1')).sort(), [
    'actorId',
    'commandId',
    'eventId',
    'status',
    'version',
    'worldId',
  ]);
});
test('lost final response restores partial outcome through exact lookup without resend', async () => {
  const command = { worldId, actorId, commandId, text: '说说看', expectedVersion: 0 };
  const partial = {
    ...receipt,
    streamSummary: { ...receipt.streamSummary!, completionStatus: 'partial_interrupted' as const },
  };
  let recovered = 0;
  let observed: WorldMessageReceipt | undefined;
  const result = await reconcileRestoredSendReceipts(
    worldId,
    [{ id: commandId, actorId, role: 'user', text: command.text, at, status: 'unknown' }],
    { [commandId]: command },
    async () => partial,
    async () => {
      recovered++;
      return partial;
    },
    (r) => {
      observed = r;
    },
  );
  assert.deepEqual(result, { [commandId]: 'committed' });
  assert.equal(observed?.streamSummary?.completionStatus, 'partial_interrupted');
  assert.equal(recovered, 0);
});
