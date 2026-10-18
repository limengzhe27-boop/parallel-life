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
