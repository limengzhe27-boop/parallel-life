import type { WorldMessageReceipt } from '../../contracts/world-interaction.ts';
import type { WorldPhone } from '../../contracts/world-build.ts';
import type { PhoneMessage } from './apps/types.ts';

/** A commit receipt confirms only this player's submission, never a fabricated NPC reply. */
export function committedLocalSend(
  worldId: string,
  message: PhoneMessage,
  receipt: WorldMessageReceipt,
): PhoneMessage {
  if (
    receipt.worldId !== worldId ||
    receipt.commandId !== message.id ||
    receipt.actorId !== message.actorId ||
    message.role !== 'user'
  )
    throw Error('MESSAGE_RECEIPT_IDENTITY_MISMATCH');
  return { ...message, status: 'sent' };
}

/** Retain the acknowledged user bubble until its exact committed event projection arrives.
 * The original reducer uses eventId + '_user'; equal text in an older turn is not confirmation.
 */
export function unprojectedLocalSends(
  local: readonly PhoneMessage[],
  projected: WorldPhone['messages'],
  receipts: Readonly<Record<string, WorldMessageReceipt>>,
): PhoneMessage[] {
  return local.filter((message) => {
    const receipt = receipts[message.id];
    return (
      message.status !== 'sent' ||
      !receipt ||
      !projected.some(
        (m) =>
          m.id === `${receipt.eventId}_user` &&
          m.role === 'user' &&
          m.actorId === message.actorId &&
          m.text === message.text,
      )
    );
  });
}

/**
 * Projects authenticated committed turn messages from a durable WorldMessageReceipt
 * directly onto the current WorldPhone state so the committed NPC reply is immediately
 * visible without waiting for a full phone reload.
 *
 * Invariants:
 * 1. Every message in `receipt.messages` must carry matching `actorId`, `sourceEventId`,
 *    `sourceVersion`, and an official event-scoped ID (`${eventId}_user` or `${eventId}_...`).
 * 2. Official `message.id` deduplication guarantees no duplicate bubbles when the full
 *    `client.world(worldId)` projection arrives or if a receipt is applied twice.
 * 3. A late receipt (`receipt.version < current.version`) never downgrades `version` or
 *    `time`, and inserts any missing earlier turn messages before messages from later turns.
 */
export function projectCommittedTurnReceipt(
  current: WorldPhone,
  receipt: WorldMessageReceipt,
): WorldPhone {
  if (current.id !== receipt.worldId) throw Error('MESSAGE_RECEIPT_IDENTITY_MISMATCH');
  const currentVersion = current.version ?? 0;
  const incoming = receipt.messages ?? [];
  for (const message of incoming) {
    if (
      message.actorId !== receipt.actorId ||
      message.sourceEventId !== receipt.eventId ||
      message.sourceVersion !== receipt.version ||
      !message.id.trim() ||
      (message.role === 'user' && message.id !== `${receipt.eventId}_user`)
    )
      throw Error('MESSAGE_RECEIPT_IDENTITY_MISMATCH');
  }
  const existingIds = new Set(current.messages.map((message) => message.id));
  const freshMessages: WorldPhone['messages'] = [];
  for (const message of incoming) {
    if (existingIds.has(message.id)) continue;
    existingIds.add(message.id);
    freshMessages.push({
      id: message.id,
      actorId: message.actorId,
      role: message.role,
      text: message.text,
      at: message.at,
    });
  }
  const nextVersion = Math.max(currentVersion, receipt.version);
  if (freshMessages.length === 0) {
    return nextVersion === currentVersion ? current : { ...current, version: nextVersion };
  }
  let nextMessages: WorldPhone['messages'];
  if (receipt.version < currentVersion) {
    const merged = [...current.messages, ...freshMessages];
    merged.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    nextMessages = merged;
  } else {
    nextMessages = [...current.messages, ...freshMessages];
  }
  let nextTime = current.time;
  if (receipt.version >= currentVersion) {
    for (const message of freshMessages) {
      if (Date.parse(message.at) > Date.parse(nextTime)) nextTime = message.at;
    }
  }
  return {
    ...current,
    version: nextVersion,
    time: nextTime,
    messages: nextMessages,
  };
}
