import type {
  CommittedStreamSegmentEventContract,
  WorldMessageReceipt,
} from '../../contracts/world-interaction.ts';
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
          m.id ===
            (receipt.messages?.find((p) => p.role === 'user')?.id ?? `${receipt.eventId}_user`) &&
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
  const events = new Map(
    (receipt.messageEvents ?? [{ eventId: receipt.eventId, version: receipt.version }]).map((e) => [
      e.eventId,
      e.version,
    ]),
  );
  if (
    events.size !== (receipt.messageEvents?.length ?? 1) ||
    [...events.values()].some((v) => v > receipt.version)
  )
    throw Error('MESSAGE_RECEIPT_IDENTITY_MISMATCH');
  for (const message of incoming) {
    if (
      message.actorId !== receipt.actorId ||
      events.get(message.sourceEventId) !== message.sourceVersion ||
      !message.id.trim() ||
      (message.role === 'user' && message.id !== `${message.sourceEventId}_user`)
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
      ...(message.stickerId ? { stickerId: message.stickerId } : {}),
      at: message.at,
    });
  }
  const nextVersion = Math.max(currentVersion, receipt.version);
  if (freshMessages.length === 0) {
    return nextVersion === currentVersion ? current : { ...current, version: nextVersion };
  }
  let nextMessages: WorldPhone['messages'];
  if (receipt.version < currentVersion || (receipt.messageEvents?.length ?? 0) > 1) {
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

/**
 * Projects a single committed stream segment directly onto the WorldPhone state.
 * Both the user bubble (if present in segment) and the NPC reply bubble are
 * deduplicated by message.id, so subsequent segments or the final turn receipt
 * can be applied idempotently without duplicate bubbles.
 */
export function applyStreamSegmentToWorld(
  current: WorldPhone,
  segment: CommittedStreamSegmentEventContract,
): WorldPhone {
  if (current.id !== segment.worldId) throw Error('MESSAGE_RECEIPT_IDENTITY_MISMATCH');
  const currentVersion = current.version ?? 0;
  const existingIds = new Set(current.messages.map((m) => m.id));
  const freshMessages: WorldPhone['messages'] = [];

  if (segment.userMessage && !existingIds.has(segment.userMessage.id)) {
    existingIds.add(segment.userMessage.id);
    freshMessages.push({
      id: segment.userMessage.id,
      actorId: segment.userMessage.actorId,
      role: segment.userMessage.role,
      text: segment.userMessage.text,
      at: segment.userMessage.at,
    });
  }

  if (segment.message && !existingIds.has(segment.message.id)) {
    existingIds.add(segment.message.id);
    freshMessages.push({
      id: segment.message.id,
      actorId: segment.message.actorId,
      role: segment.message.role,
      text: segment.message.text,
      at: segment.message.at,
    });
  }

  const nextVersion = Math.max(currentVersion, segment.version);
  if (freshMessages.length === 0) {
    return nextVersion === currentVersion ? current : { ...current, version: nextVersion };
  }

  let nextMessages: WorldPhone['messages'];
  if (segment.version < currentVersion) {
    const merged = [...current.messages, ...freshMessages];
    merged.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    nextMessages = merged;
  } else {
    nextMessages = [...current.messages, ...freshMessages];
  }

  let nextTime = current.time;
  if (segment.version >= currentVersion) {
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
