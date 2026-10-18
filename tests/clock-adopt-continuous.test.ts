import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptContinuousClock,
  elapsedStoryMilliseconds,
  type WorldClock,
} from '../src/modules/world/domain/clock.ts';

const legacy = (): WorldClock =>
  ({
    storyNow: '2026-10-14T00:00:00.000Z',
    lastTickAt: '2026-10-14T00:00:00.000Z',
    speed: 12,
    paused: false,
    missedBeats: 0,
    summary: null,
    managed: true,
    activeUntil: '2026-10-14T00:02:00.000Z',
  }) as WorldClock;

test('旧 managed 世界采用连续时间线后，离线 4 天按 1 倍计入', () => {
  const adopted = adoptContinuousClock(legacy());
  assert.equal(adopted.continuityMode, 'continuous');
  const fourDaysLater = '2026-10-18T00:00:00.000Z';
  const elapsed = elapsedStoryMilliseconds(adopted, fourDaysLater);
  const days = elapsed / (24 * 60 * 60_000);
  assert.ok(days >= 3.9 && days <= 4.1, `离线应约 4 天，实际 ${days.toFixed(2)} 天`);
});

test('已采用连续时间线时保持不变（幂等）', () => {
  const adopted = adoptContinuousClock(legacy());
  assert.deepEqual(adoptContinuousClock(adopted), adopted);
});

test('暂停的世界不因采用连续时间线而走动', () => {
  const paused = { ...adoptContinuousClock(legacy()), paused: true } as WorldClock;
  assert.equal(elapsedStoryMilliseconds(paused, '2026-10-18T00:00:00.000Z'), 0);
});
