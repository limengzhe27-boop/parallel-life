import { DomainError } from './errors.ts';
import { projectStoryTime, type WorldClock } from './clock.ts';

export const CLOCK_ACTIVITY_LEASE_MS = 45_000;
export const BROWSING_SPEED = 12;
export const CONVERSATION_SPEED = 1;
export type ClockActivityInput = {
  clientId: string;
  sequence: number;
  mode: 'browsing' | 'conversation' | 'away';
  resume?: boolean;
};
export type ClockActivityLease = {
  clientId: string;
  sequence: number;
  mode: ClockActivityInput['mode'];
  expiresAt: string;
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
    (input.resume !== undefined && typeof input.resume !== 'boolean')
  )
    throw new DomainError('INVALID_COMMAND');
}
/** Expiration is a clock boundary, not permission to replay the offline interval. */
export function readableActivityClock(clock: WorldClock, realNow: string): WorldClock {
  if (!clock.managed || (clock.activeUntil && Date.parse(clock.activeUntil) > Date.parse(realNow)))
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
  if (!clock.managed || clock.paused || clock.speed <= 0) return null;
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
    Date.parse(clock.lastTickAt) + (boundary - Date.parse(clock.storyNow)) / clock.speed,
  ).toISOString();
}
