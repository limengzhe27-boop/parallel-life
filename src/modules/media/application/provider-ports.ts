import type {
  CharacterVisualAnchor,
  ProviderTaskReceipt,
  ProviderTaskStatus,
} from '../domain/types.ts';
import type { BuiltImagePrompt, BuiltVideoPrompt } from '../domain/prompt-builder.ts';

export type SubmitImageProviderParams = {
  deduplicationKey: string;
  builtPrompt: BuiltImagePrompt;
  referenceImageBytes?: Buffer;
  referenceImageMimeType?: string;
  referenceImageUrl?: string;
  webhookUrl?: string;
};

export type SubmitVideoProviderParams = {
  deduplicationKey: string;
  builtPrompt: BuiltVideoPrompt;
  firstFrameImageBytes?: Buffer;
  firstFrameImageMimeType?: string;
  firstFrameImageUrl?: string;
  webhookUrl?: string;
};

/**
 * Port interface for external media generation providers (e.g. Replicate, fal.ai).
 * All provider-specific SDKs, URLs, and structures are strictly confined behind this port.
 */
export interface MediaProviderAdapter {
  readonly providerName: string;

  submitImage(params: SubmitImageProviderParams): Promise<ProviderTaskReceipt>;

  submitVideo(params: SubmitVideoProviderParams): Promise<ProviderTaskReceipt>;

  queryStatus(providerTaskId: string): Promise<ProviderTaskStatus>;

  cancel(providerTaskId: string): Promise<boolean>;
}

/**
 * Port interface for reading authorized character visual anchors from world person bindings.
 */
export interface CharacterVisualAnchorRepository {
  findActorVisualAnchor(
    worldId: string,
    actorId: string,
    ownerId: string,
  ): Promise<CharacterVisualAnchor | null>;

  findPlayerVisualAnchor(
    worldId: string,
    ownerId: string,
  ): Promise<CharacterVisualAnchor | null>;
}
