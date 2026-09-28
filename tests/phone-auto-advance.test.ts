import assert from 'node:assert/strict';
import test from 'node:test';
import { BEAT_MINUTES } from '../src/modules/world/domain/clock.ts';
import { ACTIVE_PHONE_CHECK_MS, autoAdvanceDue } from '../src/features/phone/auto-advance.ts';

const anchor = Date.parse('2026-09-29T10:00:00.000Z');
const clock = { lastTickAt: new Date(anchor).toISOString(), paused: false, speed: 1 };

test('online phone uses the same story beat boundary as the director', () => {
  assert.equal(ACTIVE_PHONE_CHECK_MS, 60_000);
  assert.equal(autoAdvanceDue(clock, anchor + BEAT_MINUTES * 60_000 - 1), false);
  assert.equal(autoAdvanceDue(clock, anchor + BEAT_MINUTES * 60_000), true);
  assert.equal(autoAdvanceDue({ ...clock, speed: 2 }, anchor + 15 * 60_000), true);
});

test('a paused, stopped, invalid or future clock never triggers an automatic beat', () => {
  assert.equal(autoAdvanceDue({ ...clock, paused: true }, anchor + 60 * 60_000), false);
  assert.equal(autoAdvanceDue({ ...clock, speed: 0 }, anchor + 60 * 60_000), false);
  assert.equal(autoAdvanceDue({ ...clock, speed: Number.NaN }, anchor + 60 * 60_000), false);
  assert.equal(autoAdvanceDue(clock, anchor - 1), false);
  assert.equal(autoAdvanceDue({ ...clock, lastTickAt: 'invalid' }, anchor + 60 * 60_000), false);
});
