import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  committedLocalSend,
  unprojectedLocalSends,
} from '../src/features/phone/send-projection.ts';
import type { PhoneMessage } from '../src/features/phone/apps/types.ts';
import type { WorldMessageReceipt } from '../src/contracts/world-interaction.ts';
const worldId = randomUUID(),
  actorId = randomUUID(),
  commandId = randomUUID(),
  eventId = randomUUID();
const message: PhoneMessage = {
  id: commandId,
  actorId,
  role: 'user',
  text: '这个时间可以商量吗？',
  at: '2026-10-19T09:00:00Z',
  status: 'pending',
};
const receipt: WorldMessageReceipt = {
  worldId,
  actorId,
  commandId,
  eventId,
  version: 3,
  status: 'committed',
};
const projected = {
  id: eventId + '_user',
  actorId,
  role: 'user' as const,
  text: message.text,
  at: message.at,
};
test('durable receipt confirms only the original player message without requiring a projection or NPC reply', () => {
  const result = committedLocalSend(worldId, message, receipt);
  assert.equal(result.status, 'sent');
  assert.equal(result.role, 'user');
  assert.equal(result.text, message.text);
  assert.deepEqual(unprojectedLocalSends([result], [], { [commandId]: receipt }), [result]);
});
test('confirmed local bubble disappears only when its exact event user projection exists', () => {
  const sent = committedLocalSend(worldId, message, receipt);
  assert.deepEqual(unprojectedLocalSends([sent], [projected], { [commandId]: receipt }), []);
  for (const other of [
    { ...projected, id: randomUUID() },
    { ...projected, role: 'assistant' as const },
    { ...projected, actorId: randomUUID() },
    { ...projected, text: '其他文字' },
  ])
    assert.deepEqual(unprojectedLocalSends([sent], [other], { [commandId]: receipt }), [sent]);
});
test('unknown and failed commands cannot be silently consumed by matching text or an unrelated receipt', () => {
  for (const status of ['unknown', 'failed', 'pending'] as const) {
    const local = { ...message, status };
    assert.deepEqual(unprojectedLocalSends([local], [projected], { [commandId]: receipt }), [
      local,
    ]);
  }
  assert.throws(
    () => committedLocalSend(worldId, message, { ...receipt, worldId: randomUUID() }),
    /IDENTITY/,
  );
  assert.throws(
    () => committedLocalSend(worldId, message, { ...receipt, actorId: randomUUID() }),
    /IDENTITY/,
  );
  assert.throws(
    () => committedLocalSend(worldId, message, { ...receipt, commandId: randomUUID() }),
    /IDENTITY/,
  );
  assert.throws(
    () => committedLocalSend(worldId, { ...message, role: 'assistant' }, receipt),
    /IDENTITY/,
  );
});
test('repeated content from another turn and late partial projections retain only the unprojected submission', () => {
  const second = { ...message, id: randomUUID(), status: 'sent' as const };
  const first = committedLocalSend(worldId, message, receipt);
  const secondReceipt = { ...receipt, commandId: second.id, eventId: randomUUID(), version: 4 };
  assert.deepEqual(
    unprojectedLocalSends([first, second], [projected], {
      [commandId]: receipt,
      [second.id]: secondReceipt,
    }),
    [second],
  );
});
