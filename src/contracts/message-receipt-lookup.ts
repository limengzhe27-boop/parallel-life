import { z } from 'zod';
import { Id } from './api.ts';
import { WorldMessageReceiptSchema } from './world-interaction.ts';

/** Absence of a receipt is not evidence that an upstream request failed. */
export const MessageReceiptLookupSchema = z.discriminatedUnion('status', [
  WorldMessageReceiptSchema,
  z.strictObject({
    status: z.literal('unconfirmed'),
    commandId: Id,
    worldId: Id,
    actorId: Id,
  }),
]);
export type MessageReceiptLookup = z.infer<typeof MessageReceiptLookupSchema>;
