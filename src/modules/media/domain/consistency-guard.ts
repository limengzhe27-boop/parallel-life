import type { FaceConsistencySpec, MediaCostBudget } from './types.ts';

export const DEFAULT_MEDIA_BUDGET: MediaCostBudget = {
  maxImagesPerWorld: 12,
  maxPendingRequests: 3,
  estimatedCostUsdPerImage: 0.04,
};

/**
 * Validates and enforces facial consistency protocol parameters.
 * Rejects requests that attempt generic face substitution or lack honest reference tracking.
 */
export function validateConsistencySpec(input: unknown): FaceConsistencySpec {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('INVALID_CONSISTENCY_SPEC: payload must be an object'), {
      code: 'INVALID_COMMAND',
    });
  }
  const spec = input as Partial<FaceConsistencySpec>;
  if (!spec.referenceAssetId || typeof spec.referenceAssetId !== 'string' || spec.referenceAssetId.trim().length === 0) {
    throw Object.assign(new Error('INVALID_CONSISTENCY_SPEC: referenceAssetId is required'), {
      code: 'INVALID_COMMAND',
    });
  }

  const threshold = typeof spec.fidelityThreshold === 'number' ? spec.fidelityThreshold : 0.8;
  if (threshold < 0.5 || threshold > 1.0) {
    throw Object.assign(new Error('INVALID_CONSISTENCY_SPEC: fidelityThreshold must be between 0.5 and 1.0'), {
      code: 'INVALID_COMMAND',
    });
  }

  return {
    referenceAssetId: spec.referenceAssetId.trim(),
    fidelityThreshold: threshold,
    preserveFacialFeatures: spec.preserveFacialFeatures !== false,
    ageDeviationMaxYears: typeof spec.ageDeviationMaxYears === 'number' ? spec.ageDeviationMaxYears : 5,
  };
}

/**
 * Enforces per-world hard image generation quotas to avoid runaway API costs.
 */
export function checkMediaQuota(
  currentImageCount: number,
  budget: MediaCostBudget = DEFAULT_MEDIA_BUDGET,
): { allowed: boolean; reason?: string } {
  if (currentImageCount >= budget.maxImagesPerWorld) {
    return {
      allowed: false,
      reason: `EXCEEDED_WORLD_MEDIA_QUOTA: World has reached the limit of ${budget.maxImagesPerWorld} images`,
    };
  }
  return { allowed: true };
}

/**
 * Asserts that an asset is genuine and not a masqueraded generic wallpaper.
 * Prohibits substituting real character portraits with stock photos.
 */
export function assertGenuineCharacterMedia(asset: {
  origin: 'upload' | 'generated';
  referenceAssetIds: string[];
  isMockPlaceholder?: boolean;
}): void {
  if (asset.isMockPlaceholder) {
    throw Object.assign(
      new Error('FORBIDDEN_GENERIC_SUBSTITUTION: Cannot masquerade generic stock photo as character generation'),
      { code: 'INVALID_COMMAND' },
    );
  }
  if (asset.origin === 'generated' && asset.referenceAssetIds.length === 0) {
    throw Object.assign(
      new Error('UNTRACKED_REFERENCE: Generated character portrait must track source reference asset ID'),
      { code: 'INVALID_COMMAND' },
    );
  }
}
