import type {
  ImageGenerationIntent,
  VideoGenerationIntent,
  MediaShareIntent,
  MediaPurpose,
} from './types.ts';

export const MEDIA_TOOL_NAMES = {
  GENERATE_IMAGE: 'media.generate_image',
  GENERATE_VIDEO: 'media.generate_video',
  SHARE: 'media.share',
} as const;

export type MediaToolName = (typeof MEDIA_TOOL_NAMES)[keyof typeof MEDIA_TOOL_NAMES];

export type ToolValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errorCode: string; errorMessage: string };

const VALID_IMAGE_PURPOSES: ReadonlySet<MediaPurpose> = new Set([
  'portrait',
  'scene',
  'memorial',
  'evidence',
  'author_asset',
]);

const VALID_ASPECT_RATIOS = new Set(['1:1', '9:16', '16:9', '3:4']);
const VALID_STYLES = new Set(['film_photo', 'documentary', 'cinematic', 'illustration']);
const VALID_CAMERA_MOTIONS = new Set(['dolly_in', 'dolly_out', 'pan_horizontal', 'static', 'tracking']);

/**
 * Validates media.generate_image input payload.
 * Rejects unsupported options explicitly (no silent ignore).
 */
export function validateGenerateImageToolInput(input: unknown): ToolValidationResult<ImageGenerationIntent> {
  if (!input || typeof input !== 'object') {
    return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'Payload must be a non-null object' };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.sceneDescription !== 'string' || raw.sceneDescription.trim().length === 0) {
    return { success: false, errorCode: 'MISSING_SCENE_DESCRIPTION', errorMessage: 'sceneDescription is required' };
  }

  const purpose = raw.purpose as MediaPurpose;
  if (!purpose || !VALID_IMAGE_PURPOSES.has(purpose)) {
    return {
      success: false,
      errorCode: 'INVALID_PURPOSE',
      errorMessage: `purpose must be one of: ${Array.from(VALID_IMAGE_PURPOSES).join(', ')}`,
    };
  }

  if (raw.aspectRatio !== undefined) {
    if (typeof raw.aspectRatio !== 'string' || !VALID_ASPECT_RATIOS.has(raw.aspectRatio)) {
      return {
        success: false,
        errorCode: 'UNSUPPORTED_ASPECT_RATIO',
        errorMessage: `aspectRatio must be one of: ${Array.from(VALID_ASPECT_RATIOS).join(', ')}`,
      };
    }
  }

  if (raw.style !== undefined) {
    if (typeof raw.style !== 'string' || !VALID_STYLES.has(raw.style)) {
      return {
        success: false,
        errorCode: 'UNSUPPORTED_STYLE',
        errorMessage: `style must be one of: ${Array.from(VALID_STYLES).join(', ')}`,
      };
    }
  }

  return {
    success: true,
    data: {
      purpose,
      sceneDescription: raw.sceneDescription.trim(),
      targetActorId: typeof raw.targetActorId === 'string' ? raw.targetActorId.trim() : undefined,
      style: raw.style as ImageGenerationIntent['style'],
      aspectRatio: raw.aspectRatio as ImageGenerationIntent['aspectRatio'],
      composition: raw.composition as ImageGenerationIntent['composition'],
      lighting: raw.lighting as ImageGenerationIntent['lighting'],
      sourceEventId: typeof raw.sourceEventId === 'string' ? raw.sourceEventId.trim() : undefined,
      deliveryIntent: raw.deliveryIntent as ImageGenerationIntent['deliveryIntent'],
    },
  };
}

/**
 * Validates media.generate_video input payload.
 * Rejects unsupported options explicitly.
 */
export function validateGenerateVideoToolInput(input: unknown): ToolValidationResult<VideoGenerationIntent> {
  if (!input || typeof input !== 'object') {
    return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'Payload must be a non-null object' };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.actionDescription !== 'string' || raw.actionDescription.trim().length === 0) {
    return { success: false, errorCode: 'MISSING_ACTION_DESCRIPTION', errorMessage: 'actionDescription is required' };
  }

  const purpose = raw.purpose;
  if (purpose !== 'scene_moment' && purpose !== 'character_action') {
    return {
      success: false,
      errorCode: 'INVALID_VIDEO_PURPOSE',
      errorMessage: 'purpose must be either "scene_moment" or "character_action"',
    };
  }

  if (raw.cameraMotion !== undefined) {
    if (typeof raw.cameraMotion !== 'string' || !VALID_CAMERA_MOTIONS.has(raw.cameraMotion)) {
      return {
        success: false,
        errorCode: 'UNSUPPORTED_CAMERA_MOTION',
        errorMessage: `cameraMotion must be one of: ${Array.from(VALID_CAMERA_MOTIONS).join(', ')}`,
      };
    }
  }

  if (raw.durationSeconds !== undefined) {
    if (raw.durationSeconds !== 5 && raw.durationSeconds !== 6) {
      return {
        success: false,
        errorCode: 'UNSUPPORTED_DURATION',
        errorMessage: 'durationSeconds must be either 5 or 6',
      };
    }
  }

  return {
    success: true,
    data: {
      purpose,
      actionDescription: raw.actionDescription.trim(),
      targetActorId: typeof raw.targetActorId === 'string' ? raw.targetActorId.trim() : undefined,
      cameraMotion: raw.cameraMotion as VideoGenerationIntent['cameraMotion'],
      durationSeconds: raw.durationSeconds as 5 | 6 | undefined,
      audioLayers: raw.audioLayers as VideoGenerationIntent['audioLayers'],
      sourceEventId: typeof raw.sourceEventId === 'string' ? raw.sourceEventId.trim() : undefined,
      deliveryIntent: raw.deliveryIntent as VideoGenerationIntent['deliveryIntent'],
    },
  };
}

/**
 * Validates media.share input payload.
 */
export function validateMediaShareToolInput(input: unknown): ToolValidationResult<MediaShareIntent> {
  if (!input || typeof input !== 'object') {
    return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'Payload must be a non-null object' };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.assetId !== 'string' || raw.assetId.trim().length === 0) {
    return { success: false, errorCode: 'MISSING_ASSET_ID', errorMessage: 'assetId is required' };
  }

  if (typeof raw.targetRecipientActorId !== 'string' || raw.targetRecipientActorId.trim().length === 0) {
    return {
      success: false,
      errorCode: 'MISSING_TARGET_RECIPIENT',
      errorMessage: 'targetRecipientActorId is required',
    };
  }

  return {
    success: true,
    data: {
      assetId: raw.assetId.trim(),
      targetRecipientActorId: raw.targetRecipientActorId.trim(),
      contextEventId: typeof raw.contextEventId === 'string' ? raw.contextEventId.trim() : undefined,
      caption: typeof raw.caption === 'string' ? raw.caption.trim() : undefined,
    },
  };
}
