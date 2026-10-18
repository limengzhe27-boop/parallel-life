import type { PhoneMessage } from './apps/types.ts';
import type { SendCommand } from './chat-send-state.ts';
import type { MessageReceiptLookup } from '../../contracts/message-receipt-lookup.ts';

/** Read-only reconciliation. Absence, lookup failure and uncertain results never authorize a resend. */
export async function reconcileRestoredSendReceipts(
  worldId: string,
  messages: readonly PhoneMessage[],
  commands: Readonly<Record<string, SendCommand>>,
  lookup: (worldId: string, command: Omit<SendCommand, 'worldId'>) => Promise<MessageReceiptLookup>,
): Promise<Record<string, 'committed' | 'failed'>> {
  const updates: Record<string, 'committed' | 'failed'> = {};
  const pending = messages.filter(
    (m) => m.role === 'user' && ['unknown', 'pending'].includes(m.status ?? ''),
  );
  let cursor = 0;
  async function read() {
    while (cursor < pending.length) {
      const m = pending[cursor++]!;
      const command = commands[m.id];
      if (
        !command ||
        command.worldId !== worldId ||
        command.commandId !== m.id ||
        command.actorId !== m.actorId ||
        command.text !== m.text
      )
        continue;
      try {
        const { worldId: _, ...input } = command;
        const result = await lookup(worldId, input);
        if (result.worldId !== worldId || result.commandId !== m.id || result.actorId !== m.actorId)
          continue;
        if (result.status === 'committed' || result.status === 'failed')
          updates[m.id] = result.status;
      } catch {
        // Keep the original message and manual receipt lookup available.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, read));
  return updates;
}
