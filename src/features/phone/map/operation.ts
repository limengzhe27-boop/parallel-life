import { TravelRequestSchema, TravelReceiptSchema } from '../../../contracts/world-space.ts';
import type { TravelOperation } from './context.ts';
/** Reloading a pending write is unknown, never failed or automatically retried. */
export function restoreTravel(raw: string | null, worldId: string): TravelOperation | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || value.worldId !== worldId) return null;
    const request = TravelRequestSchema.parse(value.request);
    if (
      !['pending', 'unknown', 'failed', 'committed'].includes(value.status) ||
      typeof value.fromLabel !== 'string' ||
      typeof value.destinationLabel !== 'string'
    )
      return null;
    const status = value.status === 'pending' ? 'unknown' : value.status;
    const receipt = value.receipt ? TravelReceiptSchema.parse(value.receipt) : undefined;
    if (
      status === 'committed' &&
      (!receipt ||
        receipt.commandId !== request.commandId ||
        receipt.worldId !== worldId ||
        receipt.routeId !== request.routeId ||
        receipt.version !== request.expectedVersion + 1)
    )
      return null;
    return {
      request,
      fromLabel: value.fromLabel,
      destinationLabel: value.destinationLabel,
      status,
      ...(value.recoveryUnconfirmed === true ? { recoveryUnconfirmed: true } : {}),
      ...(receipt ? { receipt } : {}),
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  } catch {
    return null;
  }
}
export function storeTravel(worldId: string, op: TravelOperation | null): string {
  return JSON.stringify(op ? { worldId, ...op } : null);
}
