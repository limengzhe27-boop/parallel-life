import { z } from 'zod';
import { Id } from './api.ts';
import {
  CommittedTurnMessageSchema,
  NpcStreamTurnSummarySchema,
  WorldMessageReceiptSchema,
} from './world-interaction.ts';

/** Absence of a receipt is not evidence that an upstream request failed. */
export const MessageReceiptLookupSchema = z.discriminatedUnion('status', [
  WorldMessageReceiptSchema,
  z.strictObject({
    status: z.literal('failed'),
    commandId: Id,
    worldId: Id,
    actorId: Id,
    code: z.enum(['INVALID_AI_OUTPUT', 'VERSION_CONFLICT', 'INVALID_STATE']),
  }),
  z.strictObject({
    status: z.literal('unconfirmed'),
    /** Read-only recovery eligibility; unknown results never authorize a new request. */
    recovery: z.enum(['pending', 'response_received', 'unknown']).optional(),
    commandId: Id,
    worldId: Id,
    actorId: Id,
    messages: z.array(CommittedTurnMessageSchema).max(16).optional(),
    streamSummary: NpcStreamTurnSummarySchema.optional(),
  }),
]);
export type MessageReceiptLookup = z.infer<typeof MessageReceiptLookupSchema>;

