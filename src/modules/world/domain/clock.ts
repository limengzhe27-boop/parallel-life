import { buildAgenda, threadFor, type AgendaThread } from './agenda.ts';
import { directionLines, EMPTY_DIRECTION, type WorldDirection } from './direction.ts';
import type { WorldState } from './types.ts';

/**
 * The director's deterministic half.
 *
 * A world moves in real time (1:1 by default, adjustable, pausable). Time itself is
 * computed, never simulated minute by minute: when the user comes back, the clock
 * jumps to the real elapsed time and only a bounded number of beats are actually
 * played — the rest are folded into a summary, exactly as PRODUCT.md §10 requires.
 * Everything here is a pure function so it can be reasoned about and tested.
 */
export const DEFAULT_SPEED = 1;
export const MAX_SPEED = 60;
/** Beats actually played on one resume or advance. */
export const MAX_BEATS_PER_ADVANCE = 3;
/** How long one beat represents in story time. */
export const BEAT_MINUTES = 30;
/** Never let one advance speak for more than this many characters. */
export const MAX_SPEAKERS_PER_BEAT = 1;

export type WorldClock = {
  storyNow: string;
  speed: number;
  paused: boolean;
  lastTickAt: string;
  missedBeats: number;
  summary: string | null;
};
export type ClockAdvance = {
  clock: WorldClock;
  /** Story times that are actually played, oldest first. */
  beats: string[];
  /** Beats that elapsed and were folded into the summary instead of being played. */
  folded: number;
};

const MINUTE = 60_000;

export function advanceClock(
  clock: WorldClock,
  realNow: string,
  options: { maxBeats?: number; beatMinutes?: number } = {},
): ClockAdvance {
  const maxBeats = Math.max(
    1,
    Math.min(options.maxBeats ?? MAX_BEATS_PER_ADVANCE, MAX_BEATS_PER_ADVANCE),
  );
  const beatMs = (options.beatMinutes ?? BEAT_MINUTES) * MINUTE;
  const elapsedReal = Date.parse(realNow) - Date.parse(clock.lastTickAt);
  const nextTick = { ...clock, lastTickAt: realNow };
  /* A paused world does not move; a backwards clock is treated as no time passing. */
  if (clock.paused || !Number.isFinite(elapsedReal) || elapsedReal <= 0)
    return { clock: { ...nextTick, missedBeats: 0 }, beats: [], folded: 0 };
  const elapsedStory = (elapsedReal * clock.speed) / 1;
  const due = Math.floor(elapsedStory / beatMs);
  const played = Math.min(due, maxBeats);
  const storyStart = Date.parse(clock.storyNow);
  const beats: string[] = [];
  for (let index = 1; index <= played; index += 1)
    beats.push(new Date(storyStart + index * beatMs).toISOString());
  return {
    clock: {
      ...nextTick,
      /* Story time always catches up to reality, even when beats were folded. */
      storyNow: new Date(storyStart + elapsedStory).toISOString(),
      missedBeats: Math.max(0, due - played),
      summary:
        due > played
          ? `你离开的这段时间里，世界照常运转了大约 ${Math.round(elapsedStory / MINUTE / 60)} 小时。`
          : null,
    },
    beats,
    folded: Math.max(0, due - played),
  };
}

/**
 * Who speaks this beat. Deterministic and bounded: the character who has waited
 * longest, never the same one twice in a row while another is available. This is what
 * keeps a world feeling like it revolves around the protagonist without turning into
 * a group chat or a model-call storm.
 */
export function selectSpeaker(
  state: WorldState,
  spokenInThisAdvance: string[],
  agenda: AgendaThread[] = buildAgenda(state),
  focusActorIds: string[] = [],
): string | null {
  if (!state.actors.length) return null;
  const available = (actorId: string) => !spokenInThisAdvance.includes(actorId);
  /*
   * Unfinished business first: someone owes the protagonist a reply, then a proposed
   * appointment that is still open. Only when nothing is pending does the "longest
   * silence" rule decide, so a quiet world still moves without a group-chat storm.
   */
  const awaiting = agenda.find((thread) => thread.kind === 'awaiting_reply');
  if (awaiting && available(awaiting.actorId)) return awaiting.actorId;
  const pending = agenda.find(
    (thread) => thread.kind === 'proposed_appointment' && available(thread.actorId),
  );
  if (pending) return pending.actorId;
  const focused = state.actors.find(
    (actor) => focusActorIds.includes(actor.id) && available(actor.id),
  );
  if (focused) return focused.id;
  const lastSpoke = new Map<string, number>();
  state.messages.forEach((message, index) => lastSpoke.set(message.actorId, index));
  return (
    [...state.actors].sort((a, b) => {
      const spokeHere =
        Number(spokenInThisAdvance.includes(a.id)) - Number(spokenInThisAdvance.includes(b.id));
      if (spokeHere !== 0) return spokeHere;
      const left = lastSpoke.has(a.id) ? lastSpoke.get(a.id)! : -1;
      const right = lastSpoke.has(b.id) ? lastSpoke.get(b.id)! : -1;
      return left - right || a.id.localeCompare(b.id);
    })[0]?.id ?? null
  );
}

/** The stage direction handed to the character for one beat. */
export function beatCue(
  state: WorldState,
  actorId: string,
  agenda: AgendaThread[] = buildAgenda(state),
  direction: WorldDirection = EMPTY_DIRECTION,
): string {
  const actor = state.actors.find((item) => item.id === actorId);
  const thread = threadFor(agenda, actorId);
  return [
    `（导演节拍：此刻是 ${state.time}，用户没有开口，${actor?.name ?? '这个角色'} 可以主动做点什么。）`,
    thread ? `（未了结的事：${thread.detail}。可以自然提起，但不要替用户答应用户的事。）` : '',
    ...directionLines(direction, actorId),
    '如果此刻确实没有任何想说的，就只输出一条很短的消息说明你在忙什么。',
  ]
    .filter(Boolean)
    .join('');
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED;
  return Math.min(MAX_SPEED, Math.max(0, Math.round(speed * 100) / 100));
}
