import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directorReviewDue,
  emptyDirectorReviewDue,
} from '../src/modules/world/domain/director-review.ts';
import { nextDirectorReviewAt } from '../src/modules/world/infrastructure/director-review-repository.ts';

test('director review is due when absent or at the persisted boundary', () => {
  const at = '2026-10-21T06:00:00.000Z';
  const next = nextDirectorReviewAt(at, 60 * 60 * 1000);
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
