import { z } from 'zod';
import { AdvanceReceiptSchema } from './world-clock.ts';
export const OpeningStatusSchema = z
  .strictObject({
    phase: z.enum(['none', 'unplanned', 'planning', 'ready', 'unknown', 'complete']),
    total: z.number().int().min(0).max(24),
    delivered: z.number().int().min(0).max(24),
    retryable: z.boolean(),
  })
  .refine((value) => value.delivered <= value.total);
export type PublicOpeningStatus = z.infer<typeof OpeningStatusSchema>;
export const OpeningAdvanceSchema = AdvanceReceiptSchema.extend({ opening: OpeningStatusSchema });
