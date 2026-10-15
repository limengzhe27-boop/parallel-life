import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneTimeMode, idleCheckDue } from '../src/features/phone/time-experience-policy.ts';
import { ClockActivityRequestSchema, WorldClockSchema } from '../src/contracts/world-clock.ts';
import { StoryWaitRequestSchema, StoryWaitReceiptSchema } from '../src/contracts/story-wait.ts';
const id = '12345678-1234-4234-8234-123456789012';
test('reading returns to fast time after dialogue grace, while pending replies and scenes remain slow', () => {
  assert.equal(phoneTimeMode(100000, 80000, false, false), 'conversation');
  assert.equal(phoneTimeMode(110001, 80000, false, false), 'browsing');
  assert.equal(phoneTimeMode(110001, 0, true, false), 'conversation');
  assert.equal(phoneTimeMode(110001, 0, false, true), 'conversation');
  assert.equal(idleCheckDue(75000, 0, 0), true);
  assert.equal(idleCheckDue(75000, 10000, 0), false);
  assert.equal(idleCheckDue(150000, 0, 100000), false);
});
test('activity and wait requests reject caller-controlled timestamps and owners', () => {
  const activity = { clientId: id, sequence: 4, mode: 'conversation' };
  assert(ClockActivityRequestSchema.safeParse(activity).success);
  assert(!ClockActivityRequestSchema.safeParse({ ...activity, ownerId: id }).success);
  assert(
    !ClockActivityRequestSchema.safeParse({ ...activity, storyNow: '2030-01-01T00:00:00Z' })
      .success,
  );
  const wait = { commandId: id, expectedVersion: 0, clientId: id, sequence: 5, target: 'morning' };
  assert(StoryWaitRequestSchema.safeParse(wait).success);
  assert(!StoryWaitRequestSchema.safeParse({ ...wait, at: '2030-01-01T00:00:00Z' }).success);
  assert(!StoryWaitRequestSchema.safeParse({ ...wait, sequence: -1 }).success);
});
test('clock and wait readback retain pause deadline without exposing author conditions', () => {
  assert(
    WorldClockSchema.safeParse({
      storyNow: '2026-10-15T01:00:00Z',
      lastTickAt: '2026-10-15T01:00:00Z',
      paused: true,
      speed: 12,
      missedBeats: 0,
      summary: null,
      managed: true,
      activeUntil: null,
    }).success,
  );
  const receipt = {
    status: 'committed',
    commandId: id,
    worldId: id,
    version: 1,
    sourceEventId: id,
    fromStoryAt: '2026-10-15T01:00:00Z',
    storyNow: '2026-10-15T01:10:00Z',
    targetAt: '2026-10-16T00:00:00Z',
    stoppedBy: { reason: 'story_boundary' },
  };
  assert(StoryWaitReceiptSchema.safeParse(receipt).success);
  assert(!StoryWaitReceiptSchema.safeParse({ ...receipt, privateScript: 'private' }).success);
});
