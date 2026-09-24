import { DomainError } from './errors.ts';
import { MAX_BEATS_PER_ADVANCE } from './clock.ts';
import type { WorldState } from './types.ts';

/**
 * The user steering the director (L-03).
 *
 * Two rules are enforced here rather than left to a prompt:
 *  1. only the future can be directed — rewriting the past is refused and must go
 *     through a branch, so the original life is preserved;
 *  2. pacing and focus have concrete, bounded effects on beats, so guidance is not
 *     decoration: it changes who speaks and how often the world moves.
 */
export type Pacing = 'slow' | 'normal' | 'fast';
export type WorldDirection = {
  guidance: string;
  themes: string[];
  pacing: Pacing;
  focusActorIds: string[];
};
export const EMPTY_DIRECTION: WorldDirection = {
  guidance: '',
  themes: [],
  pacing: 'normal',
  focusActorIds: [],
};

/** Pacing is a hard cap on how many beats one advance may play. */
export function beatsForPacing(pacing: Pacing): number {
  if (pacing === 'slow') return 1;
  if (pacing === 'fast') return 3;
  return MAX_BEATS_PER_ADVANCE;
}

export function normalizeDirection(
  input: Partial<WorldDirection> & { guidance?: string },
  state?: WorldState,
): WorldDirection {
  const guidance = (input.guidance ?? '').trim();
  if (guidance.length > 500) throw new DomainError('INVALID_COMMAND', 'Guidance is too long');
  const themes = (input.themes ?? []).map((theme) => theme.trim()).filter(Boolean);
  if (themes.length > 5 || themes.some((theme) => theme.length > 40))
    throw new DomainError('INVALID_COMMAND', 'At most 5 themes of 40 characters');
  const focusActorIds = [...new Set(input.focusActorIds ?? [])];
  if (focusActorIds.length > 3)
    throw new DomainError('INVALID_COMMAND', 'At most 3 focused characters');
  const pacing = input.pacing ?? 'normal';
  if (!['slow', 'normal', 'fast'].includes(pacing))
    throw new DomainError('INVALID_COMMAND', 'Unknown pacing');
  if (state)
    for (const actorId of focusActorIds)
      if (!state.actors.some((actor) => actor.id === actorId))
        throw new DomainError('INVALID_COMMAND', 'Unknown focused character');
  return { guidance, themes, pacing: pacing as Pacing, focusActorIds };
}

/**
 * What a change would do, without doing it. Used by the preview endpoint so the user
 * sees the impact of a direction before it takes effect.
 */
export function describeImpact(
  direction: WorldDirection,
  state: WorldState,
): { beatsPerAdvance: number; speaksFirst: string | null; themes: string[] } {
  const focused = state.actors.find((actor) => direction.focusActorIds.includes(actor.id));
  return {
    beatsPerAdvance: beatsForPacing(direction.pacing),
    speaksFirst: focused?.name ?? null,
    themes: direction.themes,
  };
}

/** The brief lines handed to a character for a beat, so guidance actually reaches it. */
export function directionLines(direction: WorldDirection, actorId: string): string[] {
  const lines: string[] = [];
  if (direction.guidance || direction.themes.length)
    lines.push(
      `（导演要求：${[
        direction.guidance,
        direction.themes.length ? `围绕主题「${direction.themes.join('、')}」` : '',
      ]
        .filter(Boolean)
        .join('；')}。）`,
    );
  if (direction.focusActorIds.includes(actorId)) lines.push('（导演希望这一段多由你出场。）');
  return lines;
}
