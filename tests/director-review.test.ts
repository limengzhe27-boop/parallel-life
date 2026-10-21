import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directorRecoveryEligible,
  directorReviewDue,
  emptyDirectorRecoveryDue,
  emptyDirectorReviewDue,
  nextDirectorReviewAt,
} from '../src/modules/world/domain/director-review.ts';

test('director review is due when absent or at the persisted boundary', () => {
  const at = '2026-10-21T06:00:00.000Z';
  const next = nextDirectorReviewAt(at);
  assert.equal(next, '2026-10-21T07:00:00.000Z');
  assert.equal(directorReviewDue(null, at), true);
  assert.equal(
    directorReviewDue(
      { nextReviewAt: next, lastReviewedAt: at, reviewCount: 1 },
      '2026-10-21T06:59:59.999Z',
    ),
    false,
  );
  assert.equal(
    directorReviewDue(
      { nextReviewAt: next, lastReviewedAt: at, reviewCount: 1 },
      '2026-10-21T07:00:00.000Z',
    ),
    true,
  );
});

test('empty director review requires due, zero selection, no retry and no handled actor', () => {
  const at = '2026-10-21T06:00:00.000Z';
  const base = { state: null, storyAt: at, selectedCount: 0, retry: false, handledActorCount: 0 };
  assert.equal(emptyDirectorReviewDue(base), true);
  assert.equal(emptyDirectorReviewDue({ ...base, retry: true }), false);
  assert.equal(emptyDirectorReviewDue({ ...base, selectedCount: 1 }), false);
  assert.equal(emptyDirectorReviewDue({ ...base, handledActorCount: 1 }), false);
  assert.equal(
    emptyDirectorReviewDue({
      ...base,
      state: {
        nextReviewAt: '2026-10-21T07:00:00.000Z',
        lastReviewedAt: at,
        reviewCount: 1,
      },
    }),
    false,
  );
});

test('director retry is seconds for known failure and recovery-only for unknown work', () => {
  const at = '2026-10-21T06:00:00.000Z';
  assert.equal(nextDirectorReviewAt(at, 'invalid_output'), '2026-10-21T06:00:15.000Z');
  assert.equal(nextDirectorReviewAt(at, 'cancelled_before_send'), '2026-10-21T06:00:15.000Z');
  assert.equal(nextDirectorReviewAt(at, 'committed'), '2026-10-21T07:00:00.000Z');
  assert.equal(
    directorRecoveryEligible({
      nextReviewAt: '2026-10-21T07:00:00.000Z',
      lastReviewedAt: at,
      reviewCount: 1,
      lastStatus: 'unknown_after_send',
    }),
    true,
  );
  assert.equal(
    directorRecoveryEligible({
      nextReviewAt: '2026-10-21T07:00:00.000Z',
      lastReviewedAt: at,
      reviewCount: 1,
      lastStatus: 'committed',
    }),
    false,
  );
});

test('unknown work enters recovery without becoming a new paid review', () => {
  const at = '2026-10-21T06:00:00.000Z';
  const unknown = {
    nextReviewAt: '2026-10-21T07:00:00.000Z',
    lastReviewedAt: at,
    reviewCount: 1,
    lastStatus: 'unknown_after_send',
  };
  assert.equal(
    emptyDirectorRecoveryDue({
      state: unknown,
      selectedCount: 0,
      retry: false,
      handledActorCount: 0,
    }),
    true,
  );
  assert.equal(
    emptyDirectorRecoveryDue({
      state: unknown,
      selectedCount: 1,
      retry: false,
      handledActorCount: 0,
    }),
    false,
  );
  assert.equal(
    emptyDirectorRecoveryDue({
      state: unknown,
      selectedCount: 0,
      retry: true,
      handledActorCount: 0,
    }),
    false,
  );
});

