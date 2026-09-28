import type { WorldClock } from '../../contracts/world-clock.ts';

/** Recheck while the phone stays visible; the server still decides whether a beat plays. */
export const ACTIVE_PHONE_CHECK_MS = 60_000;

/** Keep this threshold aligned with the world's 30-minute beat cadence. */
const STORY_BEAT_MS = 30 * 60_000;

export function autoAdvanceDue(
  clock: Pick<WorldClock, 'lastTickAt' | 'paused' | 'speed'>,
  realNowMs: number,
): boolean {
  if (clock.paused || clock.speed <= 0 || !Number.isFinite(clock.speed)) return false;
  const lastTickMs = Date.parse(clock.lastTickAt);
  if (!Number.isFinite(lastTickMs) || !Number.isFinite(realNowMs)) return false;
  return (realNowMs - lastTickMs) * clock.speed >= STORY_BEAT_MS;
}
