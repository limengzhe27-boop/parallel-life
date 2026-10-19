import { z } from 'zod';
import { Id } from './api.ts';
import { AdvanceReceiptSchema } from './world-clock.ts';
export const AdvanceOperationRequestSchema = z.strictObject({
  operationId: z.uuid(),
  action: z.enum(['start', 'lookup', 'recover']),
});
export const AdvanceOperationReceiptSchema = z.strictObject({
  worldId: Id,
  operationId: z.uuid(),
  status: z.enum(['absent', 'running', 'complete', 'recoverable', 'unknown', 'failed']),
  work: z
    .array(
      z.strictObject({
        kind: z.enum(['npc', 'director']),
        commandId: Id,
        status: z.enum([
          'not_started',
          'reserved',
          'request_sent',
          'response_received',
          'committed',
          'unknown_after_send',
          'invalid_output',
          'stale_discarded',
          'cancelled_before_send',
        ]),
      }),
    )
    .max(100),
  result: AdvanceReceiptSchema.omit({ status: true, worldId: true }).optional(),
  failureCode: z.string().max(40).optional(),
  waitingOn: z.literal('clock_or_attention').optional(),
});
export type AdvanceOperationReceipt = z.infer<typeof AdvanceOperationReceiptSchema>;
