import type { Message } from './types.ts';

/** Fictional opening notifications predate the moment the phone is first opened. */
export function openingMessageAt(worldTime: string, index: number, total: number): string {
  const offsets = [100, 35, 12, 5];
  const offsetMinutes = offsets[Math.max(0, offsets.length - total + index)] ?? 5;
  return new Date(Date.parse(worldTime) - offsetMinutes * 60_000).toISOString();
}

/**
 * Old builds stamped every fictional opening notification at the same instant.
 * Reconstruct only that unambiguous genesis batch; never change a user's message,
 * a later NPC reply, or the immutable source snapshot.
 */
export function openingMessagesForDisplay(
  messages: Message[],
  worldId: string,
  openingTime: string,
): Message[] {
  if (
    messages.length < 2 ||
    messages.length > 4 ||
    !messages.every(
      (message) =>
        message.sourceEventId === `genesis:${worldId}` &&
        message.role === 'assistant' &&
        message.at === openingTime,
    )
  )
    return messages;
  return messages.map((message, index) => ({
    ...message,
    at: openingMessageAt(openingTime, index, messages.length),
  }));
}
