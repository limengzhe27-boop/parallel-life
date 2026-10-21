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
/** Terminal failed bookkeeping is not retryable; cap legacy noise from old sessions. */
export function pruneAdvanceRecovery(items: readonly PendingAdvance[]): PendingAdvance[] {
  return coalesceAdvanceRecovery(items)
    .filter((item) => item.state !== 'failed')
    .slice(-5);
}
export function restorePendingAdvances(raw: string | null): PendingAdvance[] {
  try {
    const parsed = z
      .array(PendingAdvanceSchema)
      .max(1000)
      .safeParse(JSON.parse(raw ?? '[]'));
    return parsed.success ? pruneAdvanceRecovery(parsed.data) : [];
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

/** Multiple scheduler checks may observe the same durable work. Keep one queryable
 * operation per identical unresolved work set; never collapse different work or an
 * operation that can still append work. Server receipts remain immutable. */
export function coalesceAdvanceRecovery(items: readonly PendingAdvance[]): PendingAdvance[] {
  const seen = new Set<string>();
  return [...items]
    .reverse()
    .filter((item) => {
      if (!item.receipt || !['unknown', 'recoverable'].includes(item.state)) return true;
      const unresolved = item.receipt.work.filter((work) =>
        ['reserved', 'request_sent', 'response_received', 'unknown_after_send'].includes(
          work.status,
        ),
      );
      if (!unresolved.length) return true;
      const key = JSON.stringify([
        item.receipt.worldId,
        unresolved.map((work) => `${work.kind}:${work.commandId}`).sort(),
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .reverse();
}
