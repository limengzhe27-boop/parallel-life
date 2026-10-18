import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import type {
  ImageGenerationIntent,
  VideoGenerationIntent,
  MediaCostBudget,
  CharacterVisualAnchor,
} from '../domain/types.ts';
import { checkMediaQuota, DEFAULT_MEDIA_BUDGET } from '../domain/consistency-guard.ts';
import { resolveCharacterReference } from '../domain/character-reference-resolver.ts';
import { MediaPromptBuilder } from '../domain/prompt-builder.ts';
import { isValidMediaMagicBytes } from '../domain/magic-bytes.ts';
import type {
  MediaProviderAdapter,
  CharacterVisualAnchorRepository,
} from '../application/provider-ports.ts';
import type { AssetStore } from '../application/asset-store.ts';

export type MediaPipelineResult = {
  assetId: string;
  storageKey: string;
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
  referenceAssetIds: string[];
  prompt: string;
  providerTaskId: string;
  deliveryDecision: {
    channel?: 'chat' | 'album' | 'evidence_board';
    approved: boolean;
    reason?: string;
    deliverToChat?: boolean;
    deliverToAlbum?: boolean;
  };
};

export type MediaPipelineOptions = {
  providerAdapter: MediaProviderAdapter;
  assetStore: AssetStore;
  visualAnchorRepo: CharacterVisualAnchorRepository;
  promptBuilder?: MediaPromptBuilder;
  budget?: MediaCostBudget;
  fetchFn?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  maxPollAttempts?: number;
  pollIntervalMs?: number;
  referenceAssetReader?: (assetId: string, ownerId?: string) => Promise<{ bytes: Buffer; mimeType: string } | null>;
};

export class MediaPipelineService {
  private readonly providerAdapter: MediaProviderAdapter;
  private readonly assetStore: AssetStore;
  private readonly visualAnchorRepo: CharacterVisualAnchorRepository;
  private readonly promptBuilder: MediaPromptBuilder;
  private readonly budget: MediaCostBudget;
  private readonly fetchFn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly referenceAssetReader?: (assetId: string, ownerId?: string) => Promise<{ bytes: Buffer; mimeType: string } | null>;

  constructor(options: MediaPipelineOptions) {
    this.providerAdapter = options.providerAdapter;
    this.assetStore = options.assetStore;
    this.visualAnchorRepo = options.visualAnchorRepo;
    this.promptBuilder = options.promptBuilder ?? new MediaPromptBuilder();
    this.budget = options.budget ?? DEFAULT_MEDIA_BUDGET;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.maxPollAttempts = options.maxPollAttempts ?? 30;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.referenceAssetReader = options.referenceAssetReader;
  }

  public async executeImagePipeline(params: {
    ownerId: string;
    worldId: string;
    intent: ImageGenerationIntent;
    currentAssetCount: number;
    callerActorId: string;
    isCallerPlayer: boolean;
    worldIsCancelled?: boolean;
  }): Promise<MediaPipelineResult> {
    const { ownerId, worldId, intent, currentAssetCount, callerActorId, isCallerPlayer, worldIsCancelled } = params;

    // 1. Quota check
    const quota = checkMediaQuota(currentAssetCount, this.budget);
    if (!quota.allowed) {
      throw Object.assign(new Error(quota.reason ?? 'EXCEEDED_WORLD_MEDIA_QUOTA'), {
        code: 'QUOTA_EXCEEDED',
      });
    }

    // 2. Character anchor and reference resolution
    let targetAnchor: CharacterVisualAnchor | null = null;
    if (intent.targetActorId) {
      if (intent.targetActorId === 'player') {
        targetAnchor = await this.visualAnchorRepo.findPlayerVisualAnchor(worldId, ownerId);
      } else {
        targetAnchor = await this.visualAnchorRepo.findActorVisualAnchor(worldId, intent.targetActorId, ownerId);
      }
    }

    const playerAnchor = await this.visualAnchorRepo.findPlayerVisualAnchor(worldId, ownerId);

    const refResolution = resolveCharacterReference({
      intent,
      callerActorId,
      isCallerPlayer,
      targetAnchor: targetAnchor ?? undefined,
      playerPortraitAssetId: playerAnchor?.referenceAssetId,
    });

    if (!refResolution.allowed) {
      throw Object.assign(new Error(refResolution.reason), {
        code: refResolution.code,
      });
    }

    // 3. Load reference image bytes if reference_guided
    let refBytes: Buffer | undefined;
    let refMime: string | undefined;
    if (refResolution.mode === 'reference_guided' && refResolution.referenceAssetId && this.referenceAssetReader) {
      const readResult = await this.referenceAssetReader(refResolution.referenceAssetId, ownerId);
      if (readResult) {
        refBytes = readResult.bytes;
        refMime = readResult.mimeType;
      }
    }

    // 4. Construct prompt via PromptBuilder
    const builtPrompt = this.promptBuilder.buildImagePrompt({
      intent,
      characterSnippet: refResolution.characterPromptSnippet,
      hasReferenceImage: refResolution.mode === 'reference_guided',
      referenceAssetId: refResolution.referenceAssetId,
      targetModel: 'flux-schnell',
    });

    // 5. Submit to provider
    const deduplicationKey = createHash('sha256')
      .update([worldId, intent.targetActorId ?? '', intent.sourceEventId ?? '', builtPrompt.prompt].join(':'))
      .digest('hex');

    const receipt = await this.providerAdapter.submitImage({
      deduplicationKey,
      builtPrompt,
      referenceImageBytes: refBytes,
      referenceImageMimeType: refMime,
    });

    // 6. Wait / Poll for completion
    let outputUrl: string | undefined =
      receipt.outputUrls && receipt.outputUrls.length > 0 ? receipt.outputUrls[0] : undefined;
    let status = receipt.status;
    let attempts = 0;

    while (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled' && attempts < this.maxPollAttempts) {
      attempts++;
      if (this.pollIntervalMs > 0) {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
      const pollRes = await this.providerAdapter.queryStatus(receipt.providerTaskId);
      status = pollRes.status;
      if (status === 'succeeded' && pollRes.outputUrls && pollRes.outputUrls.length > 0) {
        outputUrl = pollRes.outputUrls[0];
        break;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw Object.assign(new Error(`Provider generation failed: ${pollRes.error ?? status}`), {
          code: 'PROVIDER_GENERATION_FAILED',
        });
      }
    }

    if (!outputUrl) {
      throw Object.assign(new Error('Generation incomplete or output URL missing'), {
        code: 'GENERATION_INCOMPLETE',
        providerTaskId: receipt.providerTaskId,
      });
    }

    // 7. Download and validate media bytes
    const mediaResponse = await this.fetchFn(outputUrl);
    if (!mediaResponse.ok) {
      throw Object.assign(new Error(`Failed to download output media: ${mediaResponse.status}`), {
        code: 'DOWNLOAD_FAILED',
      });
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const mediaBuffer = Buffer.from(arrayBuffer);

    const magicCheck = isValidMediaMagicBytes(mediaBuffer);
    if (!magicCheck.valid) {
      throw Object.assign(new Error('Downloaded asset has invalid magic bytes'), {
        code: 'INVALID_MEDIA_FORMAT',
      });
    }

    const metadata = await sharp(mediaBuffer, { limitInputPixels: 25_000_000 }).metadata();
    const width = metadata.width ?? 1024;
    const height = metadata.height ?? 1024;
    const mimeType = magicCheck.mimeType ?? 'image/webp';

    // 8. Persist to private AssetStore
    const assetId = randomUUID();
    const storageKey = `worlds/${worldId}/generated/${assetId}.webp`;
    await this.assetStore.put(storageKey, mediaBuffer);

    // 9. Pre-delivery check
    let approved = true;
    let reason: string | undefined;
    if (worldIsCancelled) {
      approved = false;
      reason = 'WORLD_CANCELLED_LATE_DELIVERY_PREVENTED';
    }

    const referenceAssetIds: string[] = [];
    if (refResolution.referenceAssetId) {
      referenceAssetIds.push(refResolution.referenceAssetId);
    }

    return {
      assetId,
      storageKey,
      mimeType,
      byteLength: mediaBuffer.length,
      width,
      height,
      referenceAssetIds,
      prompt: builtPrompt.prompt,
      providerTaskId: receipt.providerTaskId,
      deliveryDecision: {
        channel: intent.deliveryIntent?.channel,
        approved,
        reason,
        deliverToChat: approved && (!intent.deliveryIntent?.channel || intent.deliveryIntent?.channel === 'chat'),
        deliverToAlbum: approved && (!intent.deliveryIntent?.channel || intent.deliveryIntent?.channel === 'album' || intent.deliveryIntent?.channel === 'chat'),
      },
    };
  }

  public async executeVideoPipeline(params: {
    ownerId: string;
    worldId: string;
    intent: VideoGenerationIntent;
    currentAssetCount: number;
    callerActorId: string;
    isCallerPlayer: boolean;
    worldIsCancelled?: boolean;
  }): Promise<MediaPipelineResult> {
    const { ownerId, worldId, intent, currentAssetCount, callerActorId, isCallerPlayer, worldIsCancelled } = params;

    // 1. Quota check
    const quota = checkMediaQuota(currentAssetCount, this.budget, 'video');
    if (!quota.allowed) {
      throw Object.assign(new Error(quota.reason ?? 'EXCEEDED_WORLD_MEDIA_QUOTA'), {
        code: 'QUOTA_EXCEEDED',
      });
    }

    // 2. Character anchor resolution
    let targetAnchor: CharacterVisualAnchor | null = null;
    if (intent.targetActorId) {
      if (intent.targetActorId === 'player') {
        targetAnchor = await this.visualAnchorRepo.findPlayerVisualAnchor(worldId, ownerId);
      } else {
        targetAnchor = await this.visualAnchorRepo.findActorVisualAnchor(worldId, intent.targetActorId, ownerId);
      }
    }

    const playerAnchor = await this.visualAnchorRepo.findPlayerVisualAnchor(worldId, ownerId);

    const refResolution = resolveCharacterReference({
      intent,
      callerActorId,
      isCallerPlayer,
      targetAnchor: targetAnchor ?? undefined,
      playerPortraitAssetId: playerAnchor?.referenceAssetId,
    });

    if (!refResolution.allowed) {
      throw Object.assign(new Error(refResolution.reason), {
        code: refResolution.code,
      });
    }

    // 3. Load first frame image bytes if available
    let firstFrameBytes: Buffer | undefined;
    let firstFrameMime: string | undefined;
    if (refResolution.mode === 'reference_guided' && refResolution.referenceAssetId && this.referenceAssetReader) {
      const readResult = await this.referenceAssetReader(refResolution.referenceAssetId, ownerId);
      if (readResult) {
        firstFrameBytes = readResult.bytes;
        firstFrameMime = readResult.mimeType;
      }
    }

    // 4. Construct video prompt
    const builtPrompt = this.promptBuilder.buildVideoPrompt({
      intent,
      characterSnippet: refResolution.characterPromptSnippet,
      hasFirstFrameImage: refResolution.mode === 'reference_guided',
      targetModel: 'minimax-video-01',
    });

    // 5. Submit to provider
    const deduplicationKey = createHash('sha256')
      .update([worldId, intent.targetActorId ?? '', intent.sourceEventId ?? '', builtPrompt.prompt].join(':'))
      .digest('hex');

    const receipt = await this.providerAdapter.submitVideo({
      deduplicationKey,
      builtPrompt,
      firstFrameImageBytes: firstFrameBytes,
      firstFrameImageMimeType: firstFrameMime,
    });

    // 6. Poll for completion
    let outputUrl: string | undefined =
      receipt.outputUrls && receipt.outputUrls.length > 0 ? receipt.outputUrls[0] : undefined;
    let status = receipt.status;
    let attempts = 0;

    while (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled' && attempts < this.maxPollAttempts) {
      attempts++;
      if (this.pollIntervalMs > 0) {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
      const pollRes = await this.providerAdapter.queryStatus(receipt.providerTaskId);
      status = pollRes.status;
      if (status === 'succeeded' && pollRes.outputUrls && pollRes.outputUrls.length > 0) {
        outputUrl = pollRes.outputUrls[0];
        break;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw Object.assign(new Error(`Provider video generation failed: ${pollRes.error ?? status}`), {
          code: 'PROVIDER_GENERATION_FAILED',
        });
      }
    }

    if (!outputUrl) {
      throw Object.assign(new Error('Video generation incomplete or output URL missing'), {
        code: 'GENERATION_INCOMPLETE',
        providerTaskId: receipt.providerTaskId,
      });
    }

    // 7. Download and validate video
    const mediaResponse = await this.fetchFn(outputUrl);
    if (!mediaResponse.ok) {
      throw Object.assign(new Error(`Failed to download output video: ${mediaResponse.status}`), {
        code: 'DOWNLOAD_FAILED',
      });
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const mediaBuffer = Buffer.from(arrayBuffer);

    const magicCheck = isValidMediaMagicBytes(mediaBuffer);
    if (!magicCheck.valid || magicCheck.type !== 'video') {
      throw Object.assign(new Error('Downloaded video asset has invalid magic bytes'), {
        code: 'INVALID_MEDIA_FORMAT',
      });
    }

    // 8. Persist to private AssetStore
    const assetId = randomUUID();
    const storageKey = `worlds/${worldId}/generated/${assetId}.mp4`;
    await this.assetStore.put(storageKey, mediaBuffer);

    // 9. Pre-delivery check
    let approved = true;
    let reason: string | undefined;
    if (worldIsCancelled) {
      approved = false;
      reason = 'WORLD_CANCELLED_LATE_DELIVERY_PREVENTED';
    }

    const referenceAssetIds: string[] = [];
    if (refResolution.referenceAssetId) {
      referenceAssetIds.push(refResolution.referenceAssetId);
    }

    return {
      assetId,
      storageKey,
      mimeType: 'video/mp4',
      byteLength: mediaBuffer.length,
      width: 1280,
      height: 720,
      referenceAssetIds,
      prompt: builtPrompt.prompt,
      providerTaskId: receipt.providerTaskId,
      deliveryDecision: {
        channel: intent.deliveryIntent?.channel,
        approved,
        reason,
        deliverToChat: approved && (!intent.deliveryIntent?.channel || intent.deliveryIntent?.channel === 'chat'),
        deliverToAlbum: approved && (!intent.deliveryIntent?.channel || intent.deliveryIntent?.channel === 'album' || intent.deliveryIntent?.channel === 'chat'),
      },
    };
  }
}
