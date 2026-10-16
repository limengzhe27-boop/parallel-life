import type { CharacterVisualAnchor, ImageGenerationIntent, VideoGenerationIntent } from './types.ts';

export type ReferenceResolutionOutcome =
  | {
      allowed: true;
      mode: 'reference_guided';
      referenceAssetId: string;
      referenceAssetRevision: number;
      characterPromptSnippet: string;
    }
  | {
      allowed: true;
      mode: 'text_anchored_only';
      referenceAssetId: undefined;
      referenceAssetRevision: undefined;
      characterPromptSnippet: string;
    }
  | {
      allowed: true;
      mode: 'pure_scene';
      referenceAssetId: undefined;
      referenceAssetRevision: undefined;
      characterPromptSnippet: '';
    }
  | {
      allowed: false;
      code:
        | 'FORBIDDEN_PLAYER_PORTRAIT_LEAK'
        | 'UNAUTHORIZED_REFERENCE_ASSET'
        | 'CHARACTER_NOT_AUTHORIZED_IN_WORLD'
        | 'INVALID_MEDIA_INTENT';
      reason: string;
    };

/**
 * Pure domain logic for resolving and validating character reference assets.
 * Enforces the strict rule:
 * 1. An NPC request must NEVER fallback to the player's portrait.
 * 2. An asset must be explicitly bound to the target actor in the current world.
 * 3. Scene requests must not inadvertently attach character portrait references.
 */
export function resolveCharacterReference(params: {
  intent: ImageGenerationIntent | VideoGenerationIntent;
  callerActorId: string;
  isCallerPlayer: boolean;
  targetAnchor?: CharacterVisualAnchor;
  playerPortraitAssetId?: string;
  explicitReferenceAssetId?: string;
}): ReferenceResolutionOutcome {
  const { intent, isCallerPlayer, targetAnchor, playerPortraitAssetId, explicitReferenceAssetId } = params;

  // 1. Pure Scene mode
  if (intent.purpose === 'scene' || (!intent.targetActorId && intent.purpose !== 'portrait')) {
    // If an explicit reference is requested for a pure scene, verify it's not a player portrait masquerade
    if (explicitReferenceAssetId && playerPortraitAssetId && explicitReferenceAssetId === playerPortraitAssetId) {
      return {
        allowed: false,
        code: 'FORBIDDEN_PLAYER_PORTRAIT_LEAK',
        reason: 'Player portrait cannot be attached to a pure scene generation request.',
      };
    }
    return {
      allowed: true,
      mode: 'pure_scene',
      referenceAssetId: undefined,
      referenceAssetRevision: undefined,
      characterPromptSnippet: '',
    };
  }

  // 2. Character Portrait / Action mode requires targetAnchor
  if (!targetAnchor) {
    return {
      allowed: false,
      code: 'CHARACTER_NOT_AUTHORIZED_IN_WORLD',
      reason: `Target character [${intent.targetActorId ?? 'unknown'}] is not authorized in this world.`,
    };
  }

  if (!targetAnchor.authorizedForWorld) {
    return {
      allowed: false,
      code: 'CHARACTER_NOT_AUTHORIZED_IN_WORLD',
      reason: `Character [${targetAnchor.name}] has not been admitted into the current world context.`,
    };
  }

  // 3. Strict anti-leak defense: If target is NPC, forbid using player's portrait
  if (!targetAnchor.isPlayer) {
    if (explicitReferenceAssetId && playerPortraitAssetId && explicitReferenceAssetId === playerPortraitAssetId) {
      return {
        allowed: false,
        code: 'FORBIDDEN_PLAYER_PORTRAIT_LEAK',
        reason: `Cannot substitute player portrait as reference for NPC [${targetAnchor.name}].`,
      };
    }
  }

  // 4. Verify explicit reference asset matches target's authorized binding
  if (explicitReferenceAssetId) {
    if (targetAnchor.referenceAssetId !== explicitReferenceAssetId) {
      return {
        allowed: false,
        code: 'UNAUTHORIZED_REFERENCE_ASSET',
        reason: `Reference asset [${explicitReferenceAssetId}] is not authorized for character [${targetAnchor.name}].`,
      };
    }
  }

  // Build structured character prompt snippet from visual anchor
  const snippetParts: string[] = [];
  if (targetAnchor.gender) snippetParts.push(targetAnchor.gender);
  if (targetAnchor.age) snippetParts.push(`${targetAnchor.age} years old`);
  if (targetAnchor.hairStyle || targetAnchor.hairColor) {
    const hair = [targetAnchor.hairColor, targetAnchor.hairStyle].filter(Boolean).join(' ');
    snippetParts.push(`with ${hair} hair`);
  }
  if (targetAnchor.distinctiveFeatures && targetAnchor.distinctiveFeatures.length > 0) {
    snippetParts.push(`featuring ${targetAnchor.distinctiveFeatures.join(', ')}`);
  }
  if (targetAnchor.clothingStyle) {
    snippetParts.push(`wearing ${targetAnchor.clothingStyle}`);
  }

  const characterPromptSnippet = snippetParts.length > 0
    ? `A ${targetAnchor.isPlayer ? 'person' : targetAnchor.name}, ${snippetParts.join(', ')}`
    : `A portrait of ${targetAnchor.name}`;

  // 5. If authorized reference asset is present on target anchor
  if (targetAnchor.referenceAssetId && targetAnchor.referenceAssetRevision) {
    return {
      allowed: true,
      mode: 'reference_guided',
      referenceAssetId: targetAnchor.referenceAssetId,
      referenceAssetRevision: targetAnchor.referenceAssetRevision,
      characterPromptSnippet,
    };
  }

  // 6. Otherwise honest text-only description fallback (no image-to-image reference)
  return {
    allowed: true,
    mode: 'text_anchored_only',
    referenceAssetId: undefined,
    referenceAssetRevision: undefined,
    characterPromptSnippet,
  };
}
