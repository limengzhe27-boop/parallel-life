export type GenerationStatus = 'queued' | 'running' | 'submitted' | 'succeeded' | 'failed' | 'unknown';
export type MediaGeneration = {
  id: string; ownerId: string; worldId: string; sourceEventId: string;
  status: GenerationStatus; deduplicationKey: string;
  providerTaskId?: string; assetId?: string;
  // "unknown" means provider acceptance is uncertain. Never automatically resubmit.
};
export type PrivateAsset = {
  id: string; ownerId: string; worldId?: string; storageKey: string;
  mimeType: string; byteLength: number; origin: 'upload' | 'generated';
  referenceAssetIds: string[];
};
