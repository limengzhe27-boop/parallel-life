/** A live opening belongs to one player's immutable published manuscript. */
export type OpeningSource = {
  worldId: string;
  ownerId: string;
  sourceHash: string;
  nodeKey: string;
  title: string;
  script: string;
  worldSetting: string;
  actors: { id: string; key: string; name: string }[];
};
export type OpeningBrief = { actorId: string; brief: string };
export type OpeningDelivery = OpeningBrief & {
  commandId: string;
  expectedVersion: number | null;
  status: 'queued' | 'sending' | 'unknown' | 'delivered';
  sourceEventId: string | null;
};
export type OpeningSnapshot = {
  source: OpeningSource | null;
  phase: 'none' | 'unplanned' | 'planning' | 'ready' | 'unknown' | 'complete';
  planCommandId: string | null;
  deliveries: OpeningDelivery[];
};
/** One server advance runs at most one paid director or NPC call. */
export interface PublicationOpeningPort {
  read(ownerId: string, worldId: string): Promise<OpeningSnapshot>;
  beginPlan(ownerId: string, worldId: string, commandId: string): Promise<boolean>;
  savePlan(
    ownerId: string,
    worldId: string,
    commandId: string,
    briefs: OpeningBrief[],
  ): Promise<void>;
  failPlan(ownerId: string, worldId: string, commandId: string): Promise<void>;
  claimNext(ownerId: string, worldId: string): Promise<OpeningDelivery | null>;
  finishDelivery(
    ownerId: string,
    worldId: string,
    actorId: string,
    commandId: string,
  ): Promise<boolean>;
  failDelivery(ownerId: string, worldId: string, actorId: string, commandId: string): Promise<void>;
  /** Explicit owner recovery only; reconcile durable receipts before making a new command. */
  retry(ownerId: string, worldId: string): Promise<void>;
}
export type OpeningStatus = {
  phase: OpeningSnapshot['phase'];
  total: number;
  delivered: number;
  retryable: boolean;
};
export function openingStatus(value: OpeningSnapshot): OpeningStatus {
  return {
    phase: value.phase,
    total: value.source?.actors.length ?? 0,
    delivered: value.deliveries.filter((d) => d.status === 'delivered').length,
    retryable:
      value.phase === 'unknown' ||
      value.phase === 'planning' ||
      value.deliveries.some((d) => d.status === 'unknown' || d.status === 'sending'),
  };
}
