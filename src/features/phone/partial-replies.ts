import type { WorldMessageReceipt } from '../../contracts/world-interaction.ts';
import type { PhoneMessage } from './apps/types.ts';
import { SendCommandSchema, type SendCommand } from './chat-send-state.ts';

/** Browser storage contains lookup identities, never evidence that a reply completed. */
export function restorePartialReplyCommands(raw: string | null, worldId: string): SendCommand[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.slice(-20).flatMap((entry) => {
      const result = SendCommandSchema.safeParse(entry);
      return result.success && result.data.worldId === worldId ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

/** Annotate the actual saved NPC bubble; the player's delivered message stays sent. */
export function annotatePartialReplies(
  messages: readonly PhoneMessage[],
  receipts: readonly WorldMessageReceipt[],
): PhoneMessage[] {
  const interrupted = new Map<string, string>();
  for (const receipt of receipts) {
    if (receipt.streamSummary?.completionStatus !== 'partial_interrupted') continue;
    const last = receipt.messages
      ?.slice()
      .reverse()
      .find((m) => m.role === 'assistant' && m.actorId === receipt.actorId);
    if (last) interrupted.set(last.id, receipt.actorId);
  }
  return messages.map((message) =>
    message.role === 'assistant' && interrupted.get(message.id) === message.actorId
      ? { ...message, replyInterrupted: true }
      : message,
  );
}
