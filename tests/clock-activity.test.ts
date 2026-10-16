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
  projectStoryTime,
  type WorldClock,
} from '../src/modules/world/domain/clock.ts';
const start = '2026-10-15T00:00:00.000Z';
const base: WorldClock = {
  storyNow: start,
  lastTickAt: start,
  speed: 12,
  paused: false,
  missedBeats: 0,
  summary: null,
  managed: true,
  activeUntil: '2026-10-15T00:00:45.000Z',
};
test('managed projections and advances stop at the lease, not the elapsed offline hours', () => {
  const later = '2026-10-16T00:00:00.000Z';
  assert.equal(projectStoryTime(base, later), '2026-10-15T00:09:00.000Z');
  assert.equal(advanceClock(base, later).clock.storyNow, '2026-10-15T00:09:00.000Z');
  const expired = readableActivityClock(base, later);
  assert.equal(expired.paused, true);
  assert.equal(expired.storyNow, '2026-10-15T00:09:00.000Z');
  assert.equal(projectStoryTime(expired, later), expired.storyNow);
  assert.equal(projectStoryTime({ ...base, activeUntil: null }, later), start);
});
test('a conversation tab slows browsing; expired and away tabs do not', () => {
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
  assert.equal(activityMode([browsing, chatting], start).speed, 1);
  assert.equal(activityMode([browsing, chatting], '2026-10-15T00:00:35Z').speed, 12);
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

test('a five-minute confirmed appointment caps twelve-speed browsing at twenty-five real seconds', () => {
  const appointments = [{ at: '2026-10-15T00:05:00Z', status: 'confirmed' }];
  assert.equal(appointmentDeadline(base, appointments), '2026-10-15T00:00:25.000Z');
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
    '2026-10-15T00:00:34.167Z',
  );
});
