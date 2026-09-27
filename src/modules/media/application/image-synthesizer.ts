export type GenerateImageParams = {
  ownerId: string;
  worldId: string;
  prompt: string;
  title: string;
  referenceAssetId?: string;
  storyAt?: string;
};

/** Contract only. A real image provider must be supplied before generation is enabled. */
export interface CharacterImageSynthesizer {
  generateAndCommit(params: GenerateImageParams): Promise<{ assetId: string }>;
}
