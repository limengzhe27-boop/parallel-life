import { z } from 'zod';
import { AdvanceOperationReceiptSchema } from '../../contracts/advance-operation.ts';
export const PendingAdvanceSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().max(500),
  attempts: z.number().int().min(0).max(12),
  nextCheckAt: z.number(),
  state: z.enum(['checking', 'running', 'recoverable', 'unknown', 'failed']),
  receipt: AdvanceOperationReceiptSchema.optional(),
});
export type PendingAdvance = z.infer<typeof PendingAdvanceSchema>;
export function restorePendingAdvances(raw: string | null): PendingAdvance[] {
  try {
    const parsed = z
      .array(PendingAdvanceSchema)
      .max(30)
      .safeParse(JSON.parse(raw ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
/** Each query/recovery is bounded. Unknown never becomes authorization to start a new operation. */
export function advanceRecoveryAction(
  item: PendingAdvance,
  now: number,
): 'lookup' | 'recover' | null {
  if (now < item.nextCheckAt || item.state === 'failed') return null;
  return item.state === 'recoverable' ? 'recover' : 'lookup';
}
