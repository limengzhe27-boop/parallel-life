import type { ImageGenerationIntent, VideoGenerationIntent } from './types.ts';

export const MEDIA_PROMPT_RULE_VERSION = '1.0.0';

export type BuiltImagePrompt = {
  ruleVersion: string;
  targetModel: 'flux-schnell' | 'flux-1.1-pro';
  prompt: string;
  aspectRatio: '1:1' | '9:16' | '16:9' | '3:4';
  outputFormat: 'webp';
  hasReferenceImage: boolean;
  referenceAssetId?: string;
  seed?: number;
};

export type BuiltVideoPrompt = {
  ruleVersion: string;
  targetModel: 'minimax-video-01' | 'luma-ray';
  prompt: string;
  durationSeconds: 5 | 6;
  hasFirstFrameImage: boolean;
  cameraMotion?: string;
  audioPrompt?: string;
};

const STYLE_PRESETS: Record<string, string> = {
  film_photo: 'cinematic 35mm film photograph, Kodak Portra 400 aesthetic, soft natural grain, authentic candid capture',
  documentary: 'raw documentary photography, natural daylight, neutral color balance, honest candid moment',
  cinematic: 'cinematic widescreen movie still, anamorphic lens character, subtle depth of field, atmospheric mood',
  illustration: 'detailed editorial illustration, painterly textured brushwork, expressive color harmony',
};

const LIGHTING_PRESETS: Record<string, string> = {
  natural_sunlight: 'illuminated by clear natural morning sunlight with gentle shadows',
  golden_hour: 'bathed in the warm low golden hour glow of late afternoon',
  overcast_diffused: 'under an overcast sky with even diffused ambient light and soft edges',
  warm_interior: 'lit by warm interior tungsten lamps creating cozy, inviting ambient highlights',
  neon_night: 'illuminated by distant ambient neon signs casting colorful reflections in the darkness',
};

const COMPOSITION_PRESETS: Record<string, string> = {
  close_up: 'close-up shot focusing tightly on expression and nuanced details',
  medium_shot: 'medium shot framed from the waist up showing posture and surrounding environment',
  wide_shot: 'wide establishing shot balancing the subject within the full environmental context',
};

const CAMERA_MOTION_PRESETS: Record<string, string> = {
  dolly_in: 'Slow and steady dolly shot pushing forward gently toward the subject.',
  dolly_out: 'Gradual dolly-out pulling back to reveal more of the surrounding space.',
  pan_horizontal: 'Smooth horizontal panning camera following the focal action.',
  static: 'Locked-off static camera on a sturdy tripod, letting motion occur naturally in frame.',
  tracking: 'Dynamic tracking shot maintaining a stable parallel view of the subject.',
};

/**
 * Versioned, deterministic PromptBuilder for image and video synthesis.
 * Implements best practices distilled from official prompt-images & prompt-videos rules:
 * - Natural language declarative sentences (no comma-stuffed tags)
 * - Specific photography, cinematography, and lighting terminology
 * - Seven-layer video scene composition & four-layer audio specifications
 * - Anti-subtitle syntax enforcement
 */
export class MediaPromptBuilder {
  public readonly ruleVersion = MEDIA_PROMPT_RULE_VERSION;

  /**
   * Builds an image prompt adhering to modern diffusion/rectified flow conventions.
   */
  public buildImagePrompt(params: {
    intent: ImageGenerationIntent;
    characterSnippet?: string;
    hasReferenceImage?: boolean;
    referenceAssetId?: string;
    targetModel?: 'flux-schnell' | 'flux-1.1-pro';
  }): BuiltImagePrompt {
    const { intent, characterSnippet, hasReferenceImage = false, referenceAssetId, targetModel = 'flux-schnell' } = params;

    const sentenceComponents: string[] = [];

    // 1. Subject Anchor
    if (intent.purpose === 'portrait' || characterSnippet) {
      if (characterSnippet && characterSnippet.trim().length > 0) {
        sentenceComponents.push(characterSnippet.trim());
      } else {
        sentenceComponents.push('A portrait of a person');
      }
    }

    // 2. Scene Context & Intent
    const cleanScene = intent.sceneDescription.trim().replace(/[.,;]+$/, '');
    if (sentenceComponents.length > 0) {
      sentenceComponents.push(`depicted in ${cleanScene}.`);
    } else {
      sentenceComponents.push(`${cleanScene}.`);
    }

    // 3. Lighting Setup
    const lightingPreset = intent.lighting ? LIGHTING_PRESETS[intent.lighting] : undefined;
    if (lightingPreset) {
      sentenceComponents.push(`The scene is ${lightingPreset}.`);
    }

    // 4. Composition & Framing
    const compositionPreset = intent.composition ? COMPOSITION_PRESETS[intent.composition] : undefined;
    if (compositionPreset) {
      sentenceComponents.push(`Composed as a ${compositionPreset}.`);
    }

    // 5. Photographic Style & Equipment
    const styleKey = intent.style ?? 'film_photo';
    const styleText = STYLE_PRESETS[styleKey] ?? STYLE_PRESETS.film_photo;
    sentenceComponents.push(`${styleText}, shot on a 50mm portrait lens at eye level.`);

    // 6. Reference guidance hint if reference image is available
    if (hasReferenceImage) {
      sentenceComponents.push('Carefully preserving facial likeness, proportions and distinct features from the reference image.');
    }

    const fullPrompt = sentenceComponents.join(' ');

    return {
      ruleVersion: this.ruleVersion,
      targetModel,
      prompt: fullPrompt,
      aspectRatio: intent.aspectRatio ?? '1:1',
      outputFormat: 'webp',
      hasReferenceImage,
      referenceAssetId,
    };
  }

  /**
   * Builds a video prompt implementing the 7-layer scene structure and 4-layer audio specification.
   */
  public buildVideoPrompt(params: {
    intent: VideoGenerationIntent;
    characterSnippet?: string;
    hasFirstFrameImage?: boolean;
    targetModel?: 'minimax-video-01' | 'luma-ray';
  }): BuiltVideoPrompt {
    const { intent, characterSnippet, hasFirstFrameImage = false, targetModel = 'minimax-video-01' } = params;

    const sceneLayers: string[] = [];

    // Layer 1 & 2: Subject & Context
    if (characterSnippet && characterSnippet.trim().length > 0) {
      sceneLayers.push(characterSnippet.trim());
    } else {
      sceneLayers.push('A cinematic scene');
    }

    // Layer 3: Action & Event
    const cleanAction = intent.actionDescription.trim().replace(/[.,;]+$/, '');
    sceneLayers.push(`performing the following action: ${cleanAction}.`);

    // Layer 4: Style aesthetic
    sceneLayers.push('Cinematic realism, high fidelity physical motion, realistic physics and momentum.');

    // Layer 5 & 6: Camera motion & Composition
    const cameraPreset = intent.cameraMotion ? CAMERA_MOTION_PRESETS[intent.cameraMotion] : undefined;
    if (cameraPreset) {
      sceneLayers.push(cameraPreset);
    } else {
      sceneLayers.push('Camera maintains smooth cinematic focus on the subject.');
    }

    // Layer 7: Audio Layers & Subtitle suppression
    const audioSnippets: string[] = [];
    if (intent.audioLayers) {
      const { dialogue, ambient, sfx, music } = intent.audioLayers;
      if (dialogue && dialogue.trim().length > 0) {
        // Use colon syntax to avoid burnt-in subtitles
        audioSnippets.push(`The character says: ${dialogue.trim()}`);
      }
      if (ambient && ambient.trim().length > 0) {
        audioSnippets.push(`Ambient soundscape of ${ambient.trim()}`);
      }
      if (sfx && sfx.trim().length > 0) {
        audioSnippets.push(`Clear sound effects of ${sfx.trim()}`);
      }
      if (music && music.trim().length > 0) {
        audioSnippets.push(`Subtle background musical score: ${music.trim()}`);
      }
    }

    // Always enforce anti-subtitle instruction
    sceneLayers.push('(no subtitles, no captions, no on-screen text)');

    let audioPrompt: string | undefined;
    if (audioSnippets.length > 0) {
      audioPrompt = audioSnippets.join('. ') + '.';
      sceneLayers.push(`Audio details: ${audioPrompt}`);
    }

    if (hasFirstFrameImage) {
      sceneLayers.push('Beginning smoothly from the initial reference frame, seamlessly extending motion forward in time.');
    }

    const fullPrompt = sceneLayers.join(' ');

    return {
      ruleVersion: this.ruleVersion,
      targetModel,
      prompt: fullPrompt,
      durationSeconds: intent.durationSeconds ?? 6,
      hasFirstFrameImage,
      cameraMotion: intent.cameraMotion,
      audioPrompt,
    };
  }
}
