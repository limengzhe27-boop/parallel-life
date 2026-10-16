import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicationLocalTime,
  publicationUtcTime,
} from '../src/features/publisher/publisher-story-time.ts';
test('story authoring shows UTC+08 dates across UTC midnight without OS timezone inference', () => {
  assert.equal(publicationLocalTime('2026-10-15T16:15:00.000Z'), '2026-10-16T00:15');
  assert.equal(publicationUtcTime('2026-10-16T00:15'), '2026-10-15T16:15:00.000Z');
  assert.equal(publicationUtcTime('2026-10-16T19:30'), '2026-10-16T11:30:00.000Z');
  assert.equal(publicationUtcTime(''), '');
  assert.equal(publicationLocalTime('invalid'), '');
  assert.throws(() => publicationUtcTime('2026-02-30T12:30'));
  assert.throws(() => publicationUtcTime('2026-10-16T25:30'));
});
