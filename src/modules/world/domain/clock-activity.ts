import { DomainError } from './errors.ts';
import { projectStoryTime, type WorldClock } from './clock.ts';

export const CLOCK_ACTIVITY_LEASE_MS = 45_000;
export const BROWSING_SPEED = 12;
export const CONVERSATION_SPEED = 1;
export type ClockConversationFocus = { channel: 'private' | 'group' | 'scene'; threadId: string };
export type ClockActivityInput = {
  clientId: string;
  sequence: number;
  mode: 'browsing' | 'conversation' | 'away';
  resume?: boolean;
  /** Omitted heartbeats retain the current conversation target; null ends that target explicitly. */
  focus?: ClockConversationFocus | null;
};
export type ClockActivityLease = {
  clientId: string;
  sequence: number;
  mode: ClockActivityInput['mode'];
  expiresAt: string;
  focus?: ClockConversationFocus | null;
};
export function validateClockActivity(input: ClockActivityInput): void {
  if (
    !input ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.clientId,
    ) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    !['browsing', 'conversation', 'away'].includes(input.mode) ||
    (input.resume !== undefined && typeof input.resume !== 'boolean') ||
    (input.focus !== undefined && input.focus !== null && !validClockConversationFocus(input.focus))
  )
    throw new DomainError('INVALID_COMMAND');
}
/** Only a business identity is accepted; audience and actor IDs are server-derived. */
export function validClockConversationFocus(value: unknown): value is ClockConversationFocus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    Object.keys(v).every((k) => k === 'channel' || k === 'threadId') &&
    ['private', 'group', 'scene'].includes(String(v.channel)) &&
    typeof v.threadId === 'string' &&
    v.threadId.length <= 240 &&
    v.threadId.trim().length > 0
  );
}
export function nextClockConversationFocus(
  input: ClockActivityInput,
  previous?: ClockActivityLease,
): ClockConversationFocus | null {
  if (input.mode !== 'conversation') return null;
  const focus =
    input.focus === undefined && previous?.mode === 'conversation' ? previous.focus : input.focus;
  return focus ? { channel: focus.channel, threadId: focus.threadId } : null;
}
/** Expiration is a clock boundary, not permission to replay the offline interval. */
export function readableActivityClock(clock: WorldClock, realNow: string): WorldClock {
  if (
    clock.continuityMode === 'continuous' ||
    !clock.managed ||
    (clock.activeUntil && Date.parse(clock.activeUntil) > Date.parse(realNow))
  )
    return clock;
  return {
    ...clock,
    storyNow: projectStoryTime(clock, realNow),
    lastTickAt:
      clock.activeUntil && Date.parse(clock.activeUntil) > Date.parse(clock.lastTickAt)
        ? clock.activeUntil
        : clock.lastTickAt,
    paused: true,
  };
}
export function activityMode(leases: readonly ClockActivityLease[], realNow: string) {
  const live = leases.filter(
    (l) => l.mode !== 'away' && Date.parse(l.expiresAt) > Date.parse(realNow),
  );
  return {
    speed: live.some((l) => l.mode === 'conversation') ? CONVERSATION_SPEED : BROWSING_SPEED,
    activeUntil: live.length
      ? new Date(Math.max(...live.map((l) => Date.parse(l.expiresAt)))).toISOString()
      : null,
  };
}

/** A confirmed calendar instant is a stopping boundary, never evidence of attendance. */
export function appointmentDeadline(
  clock: WorldClock,
  appointments: readonly { at: string; status?: string }[],
  afterStoryAt = clock.storyNow,
): string | null {
  // A calendar instant limits a deliberate wait, not an entire continuously living world.
  if (clock.continuityMode === 'continuous' || !clock.managed || clock.paused || clock.speed <= 0)
    return null;
  const boundary = Math.min(
    ...appointments
      .filter(
        (a) =>
          a.status === 'confirmed' &&
          Number.isFinite(Date.parse(a.at)) &&
          Date.parse(a.at) > Date.parse(afterStoryAt),
      )
      .map((a) => Date.parse(a.at)),
  );
  if (!Number.isFinite(boundary)) return null;
  return new Date(
    Math.ceil(Date.parse(clock.lastTickAt) + (boundary - Date.parse(clock.storyNow)) / clock.speed),
  ).toISOString();
}
