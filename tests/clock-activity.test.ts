import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityMode,
  appointmentDeadline,
  readableActivityClock,
  validateClockActivity,
} from '../src/modules/world/domain/clock-activity.ts';
import {
  advanceClock,
  elapsedStoryMilliseconds,
  projectStoryTime,
  type WorldClock,
} from '../src/modules/world/domain/clock.ts';
const start = '2026-10-15T00:00:00.000Z';
const base: WorldClock = {
  storyNow: start,
  lastTickAt: start,
  speed: 3,
  paused: false,
  missedBeats: 0,
  summary: null,
  managed: true,
  activeUntil: '2026-10-15T00:00:45.000Z',
};
test('managed projections and advances stop at the lease, not the elapsed offline hours', () => {
  const later = '2026-10-16T00:00:00.000Z';
  assert.equal(projectStoryTime(base, later), '2026-10-15T00:02:15.000Z');
  assert.equal(advanceClock(base, later).clock.storyNow, '2026-10-15T00:02:15.000Z');
  const expired = readableActivityClock(base, later);
  assert.equal(expired.paused, true);
  assert.equal(expired.storyNow, '2026-10-15T00:02:15.000Z');
  assert.equal(projectStoryTime(expired, later), expired.storyNow);
  assert.equal(projectStoryTime({ ...base, activeUntil: null }, later), start);
});
test('visible tabs share one foreground speed whether or not a chat is open', () => {
  const browsing = {
    clientId: 'a',
    sequence: 1,
    mode: 'browsing' as const,
    expiresAt: '2026-10-15T00:00:45Z',
  };
  const chatting = {
    ...browsing,
    clientId: 'b',
    mode: 'conversation' as const,
    expiresAt: '2026-10-15T00:00:30Z',
  };
  assert.equal(activityMode([browsing, chatting], start).speed, 3);
  assert.equal(activityMode([browsing, chatting], '2026-10-15T00:00:35Z').speed, 3);
  assert.equal(activityMode([{ ...browsing, mode: 'away' }], start).activeUntil, null);
});
test('activity sequence and client IDs reject malformed inputs before storage', () => {
  for (const sequence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() =>
      validateClockActivity({
        clientId: '00000000-0000-4000-8000-000000000001',
        sequence,
        mode: 'browsing',
      }),
    );
  assert.throws(() =>
    validateClockActivity({ clientId: 'not-a-client', sequence: 0, mode: 'browsing' }),
  );
});

test('a five-minute confirmed appointment caps three-speed foreground at one hundred real seconds', () => {
  const appointments = [{ at: '2026-10-15T00:05:00Z', status: 'confirmed' }];
  assert.equal(appointmentDeadline(base, appointments), '2026-10-15T00:01:40.000Z');
  assert.equal(appointmentDeadline(base, [{ ...appointments[0]!, status: 'cancelled' }]), null);
  assert.equal(
    appointmentDeadline({ ...base, storyNow: '2026-10-15T00:05:00Z' }, appointments),
    null,
  );
});

test('fractional real deadlines round forward so explicit continue cannot stick before the same appointment', () => {
  const shifted = {
    ...base,
    storyNow: '2026-10-15T00:00:10.000Z',
    lastTickAt: '2026-10-15T00:00:10.000Z',
  };
  assert.equal(
    appointmentDeadline(shifted, [{ at: '2026-10-15T00:05:00Z', status: 'confirmed' }]),
    '2026-10-15T00:01:46.667Z',
  );
});

test('continuous worlds separate foreground speed, offline 1x and explicit run-state', () => {
  const continuous: WorldClock = { ...base, continuityMode: 'continuous' };
  const later = '2026-10-15T01:00:45.000Z';
  // 45s of foreground at 3x, then one real hour offline, never three offline hours.
  assert.equal(projectStoryTime(continuous, later), '2026-10-15T01:02:15.000Z');
  assert.equal(advanceClock(continuous, later).clock.storyNow, projectStoryTime(continuous, later));
  assert.equal(readableActivityClock(continuous, later).paused, false);
  assert.equal(projectStoryTime({ ...continuous, activeUntil: null }, later), later);
  assert.equal(
    projectStoryTime({ ...continuous, paused: true, pauseReason: 'manual' }, later),
    start,
  );
  assert.equal(
    appointmentDeadline(continuous, [{ at: '2026-10-15T00:03:00Z', status: 'confirmed' }]),
    null,
  );
  // Offline time also remains monotonic when the old presence expired before the current anchor.
  assert.equal(
    projectStoryTime({ ...continuous, activeUntil: '2026-10-14T23:59:00Z' }, later),
    later,
  );
});

test('ten visible minutes advance about thirty story minutes, then hidden minutes stay 1x', () => {
  const stillOpen = '2026-10-15T00:10:00.000Z';
  const hiddenTen = '2026-10-15T00:20:00.000Z';
  const continuous: WorldClock = {
    ...base,
    continuityMode: 'continuous',
    activeUntil: stillOpen,
  };
  assert.equal(elapsedStoryMilliseconds(continuous, stillOpen), 30 * 60_000);
  assert.equal(elapsedStoryMilliseconds(continuous, hiddenTen), 40 * 60_000);
});
