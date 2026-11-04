import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  WorldMessageReceiptSchema,
  WorldMessageStreamEventSchema,
  worldMessageClientReceipt,
  WORLD_MESSAGE_PROJECTION_VERSION,
} from '../src/contracts/world-interaction.ts';
import { MessageReceiptLookupSchema } from '../src/contracts/message-receipt-lookup.ts';
import { annotatePartialReplies } from '../src/features/phone/partial-replies.ts';
import { projectCommittedTurnReceipt } from '../src/features/phone/send-projection.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';
import type { PhoneMessage } from '../src/features/phone/apps/types.ts';
const worldId = randomUUID(),
  actorId = randomUUID(),
  eventId = randomUUID(),
  commandId = randomUUID(),
  sceneId = randomUUID();
const receipt = WorldMessageReceiptSchema.parse({
  status: 'committed',
  worldId,
  actorId,
  eventId,
  commandId,
  version: 2,
  sceneReply: { sceneId },
  messages: [
    {
      id: eventId + '_user',
      actorId,
      role: 'user',
      text: '你好',
      at: '2026-11-04T08:00:00Z',
      sourceEventId: eventId,
      sourceVersion: 2,
    },
  ],
});
test('scene reply hint survives complete and receipt lookup, legacy envelope stays strict', () => {
  const complete = WorldMessageStreamEventSchema.parse({ type: 'complete', receipt });
  assert.equal(complete.type, 'complete');
  if (complete.type !== 'complete') throw Error('expected complete');
  assert.deepEqual(complete.receipt.sceneReply, { sceneId });
  assert.deepEqual(MessageReceiptLookupSchema.parse(receipt), receipt);
  assert.deepEqual(worldMessageClientReceipt(receipt, WORLD_MESSAGE_PROJECTION_VERSION), receipt);
  assert.equal(worldMessageClientReceipt(receipt, null).sceneReply, undefined);
});
test('hint annotates only corresponding player bubble and never fabricates NPC chat', () => {
  const messages: PhoneMessage[] = [
    {
      id: eventId + '_user',
      actorId,
      role: 'user',
      text: '你好',
      at: '2026-11-04T08:00:00Z',
      status: 'sent',
    },
    {
      id: 'other',
      actorId,
      role: 'assistant',
      text: '之前的微信',
      at: '2026-11-04T07:00:00Z',
      status: 'sent',
    },
  ];
  const once = annotatePartialReplies(messages, [receipt]);
  assert.equal(once[0]!.sceneReplyId, sceneId);
  assert.equal(once[1]!.sceneReplyId, undefined);
  assert.deepEqual(annotatePartialReplies(messages, [receipt, receipt]), once);
  assert.equal(
    annotatePartialReplies([{ ...messages[0]!, actorId: randomUUID() }], [receipt])[0]!
      .sceneReplyId,
    undefined,
  );
  const world = {
    id: worldId,
    version: 1,
    time: '2026-11-04T07:00:00Z',
    messages: [],
  } as unknown as WorldPhone;
  const projected = projectCommittedTurnReceipt(world, receipt);
  assert.equal(projected.messages.length, 1);
  assert.equal(projected.messages[0]!.role, 'user');
  assert.deepEqual(projectCommittedTurnReceipt(projected, receipt), projected);
});
