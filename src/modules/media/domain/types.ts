export type GenerationStatus =
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export type MediaPurpose =
  | 'portrait'        // Specific character portrait / life photo
  | 'scene'           // Scene or environmental illustration (no specific character anchor)
  | 'memorial'        // Memorial story event photo
  | 'evidence'        // In-world evidence capture
  | 'author_asset';    // Author manuscript asset

export type MediaDeliveryIntent = {
  channel: 'chat' | 'album' | 'evidence_board';
  targetRecipientActorId?: string;
  storyAt?: string;
  caption?: string;
};

export type MediaGeneration = {
  id: string;
  ownerId: string;
  worldId: string;
  sourceEventId: string;
  status: GenerationStatus;
  deduplicationKey: string;
  providerTaskId?: string;
  assetId?: string;
  purpose?: MediaPurpose;
  targetActorId?: string;
  referenceAssetId?: string;
  deliveryIntent?: MediaDeliveryIntent;
  // "unknown" means provider acceptance is uncertain. Never automatically resubmit.
};

export type PrivateAsset = {
  id: string;
  ownerId: string;
  worldId?: string;
  storageKey: string;
  mimeType: string;
  byteLength: number;
  origin: 'upload' | 'generated';
  referenceAssetIds: string[];
};

export type FaceConsistencySpec = {
  referenceAssetId: string;
  fidelityThreshold: number;
  preserveFacialFeatures: boolean;
  ageDeviationMaxYears?: number;
};

export type MediaCostBudget = {
  maxImagesPerWorld: number;
  maxPendingRequests: number;
  estimatedCostUsdPerImage: number;
  maxVideosPerWorld?: number;
  estimatedCostUsdPerVideo?: number;
};

/**
 * Character visual anchor resolved from authorized world person bindings.
 * Used by PromptBuilder and provider adapters to enforce honest identity attribution.
 */
export type CharacterVisualAnchor = {
  actorId: string;
  personId?: string;
  name: string;
  gender?: string;
  age?: number;
  hairStyle?: string;
  hairColor?: string;
  distinctiveFeatures?: string[];
  clothingStyle?: string;
  referenceAssetId?: string;
  referenceAssetRevision?: number;
  isPlayer: boolean;
  authorizedForWorld: boolean;
};

/**
 * Input for image generation tool: media.generate_image
 */
export type ImageGenerationIntent = {
  purpose: MediaPurpose;
  sceneDescription: string;
  targetActorId?: string;
  style?: 'film_photo' | 'documentary' | 'cinematic' | 'illustration';
  aspectRatio?: '1:1' | '9:16' | '16:9' | '3:4';
  composition?: 'close_up' | 'medium_shot' | 'wide_shot';
  lighting?: 'natural_sunlight' | 'golden_hour' | 'overcast_diffused' | 'warm_interior' | 'neon_night';
  sourceEventId?: string;
  deliveryIntent?: MediaDeliveryIntent;
};

/**
 * Input for video generation tool: media.generate_video
 */
export type VideoGenerationIntent = {
  purpose: 'scene_moment' | 'character_action';
  actionDescription: string;
  targetActorId?: string;
  cameraMotion?: 'dolly_in' | 'dolly_out' | 'pan_horizontal' | 'static' | 'tracking';
  audioLayers?: {
    dialogue?: string;
    ambient?: string;
    sfx?: string;
    music?: string;
  };
  durationSeconds?: 5 | 6;
  sourceEventId?: string;
  deliveryIntent?: MediaDeliveryIntent;
};

/**
 * Input for media sharing tool: media.share
 */
export type MediaShareIntent = {
  assetId: string;
  targetRecipientActorId: string;
  contextEventId?: string;
  caption?: string;
};

export type ProviderTaskReceipt = {
  providerTaskId: string;
  status: GenerationStatus;
  provider: string;
  model: string;
  outputUrls?: string[];
  estimatedWaitSeconds?: number;
  urls?: {
    get?: string;
    cancel?: string;
  };
};

export type ProviderTaskStatus = {
  providerTaskId: string;
  status: GenerationStatus;
  outputUrls?: string[];
  outputBase64?: string;
  error?: string;
  completedAt?: string;
  usage?: {
    costUsd?: number;
    outputTokens?: number;
  };
};
