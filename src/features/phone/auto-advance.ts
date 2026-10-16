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

/** One visible-phone attempt per real 30-minute window, even when story advance keeps its anchor. */
export function autoAdvanceAttemptKey(
  worldId: string,
  clock: Pick<WorldClock, 'lastTickAt' | 'paused' | 'speed'>,
  realNowMs: number,
): string | null {
  if (
    !worldId ||
    clock.paused ||
    clock.speed <= 0 ||
    !Number.isFinite(clock.speed) ||
    !Number.isFinite(realNowMs) ||
    !Number.isFinite(Date.parse(clock.lastTickAt)) ||
    realNowMs < Date.parse(clock.lastTickAt)
  )
    return null;
  return `pl_director_resume_${worldId}_${clock.lastTickAt}_${Math.floor(realNowMs / STORY_BEAT_MS)}`;
}

export type StoryBootstrapSnapshot = {
  totalNodes: number;
  presented: readonly unknown[];
  pending: unknown | null;
};
/** Read-only bootstrap eligibility. The server still verifies story ownership and conditions. */
export function storyBootstrapEligible(story: StoryBootstrapSnapshot): boolean {
  return story.totalNodes > 0 && story.presented.length === 0 && story.pending === null;
}

/** Cache only bootstrap knowledge; ordinary due beats never depend on this cache. */
export class PhoneStoryBootstrap {
  private records = new Map<
    string,
    { version: number; kind: 'empty' | 'started' | 'ready' | 'unavailable' | 'consumed' }
  >();

  async check(
    worldId: string,
    version: number,
    read: () => Promise<StoryBootstrapSnapshot>,
  ): Promise<boolean> {
    const cached = this.records.get(worldId);
    if (cached && ['empty', 'started', 'consumed'].includes(cached.kind)) return false;
    if (cached?.version === version) return cached.kind === 'ready';
    try {
      const story = await read();
      const kind =
        story.totalNodes === 0 ? 'empty' : storyBootstrapEligible(story) ? 'ready' : 'started';
      this.records.set(worldId, { version, kind });
      return kind === 'ready';
    } catch {
      // A failed read is not evidence that an event should run. Retry only after new saved data.
      this.records.set(worldId, { version, kind: 'unavailable' });
      return false;
    }
  }
  consume(worldId: string): void {
    const old = this.records.get(worldId);
    this.records.set(worldId, { version: old?.version ?? 0, kind: 'consumed' });
  }
}
