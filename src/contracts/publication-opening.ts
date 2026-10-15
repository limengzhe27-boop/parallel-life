import { z } from 'zod';
import { AdvanceReceiptSchema } from './world-clock.ts';
export const OpeningStatusSchema = z
  .strictObject({
    phase: z.enum(['none', 'unplanned', 'planning', 'ready', 'unknown', 'complete']),
    total: z.number().int().min(0).max(24),
    delivered: z.number().int().min(0).max(24),
    retryable: z.boolean(),
    /** Routes the real phone to its world's sole runtime; never displayed as an author field. */
    runtime: z.literal('agents').optional(),
    /** Read-only hint for the existing advance entry; never a capability or payment token. */
    continuation: z
      .union([
        z.strictObject({ status: z.literal('ready'), key: z.string().regex(/^[a-f0-9]{64}$/) }),
        z.strictObject({ status: z.enum(['quiet', 'deferred', 'pending']) }),
      ])
      .optional(),
  })
  .refine((value) => value.delivered <= value.total);
export type PublicOpeningStatus = z.infer<typeof OpeningStatusSchema>;
export const OpeningAdvanceSchema = AdvanceReceiptSchema.extend({ opening: OpeningStatusSchema });
