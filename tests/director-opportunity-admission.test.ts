import test from 'node:test';
import assert from 'node:assert/strict';
import { admitDirectorOpportunity as admit } from '../src/modules/world/domain/director-opportunity-admission.ts';
const base = {
  previouslyAssessed: false,
  hasPriorPaidAssessment: true,
  hasOutstandingWork: true,
  hasRelatedNewEvidence: false,
  hasIndependentNewEvidence: false,
  hasNewlyReleasedEpisode: false,
};
test('unreviewed catalogue is not demand, even after a quiet assessment with no active episode', () => {
  for (let remaining = 17; remaining > 0; remaining--) assert.equal(admit(base), false);
  assert.equal(admit({ ...base, hasOutstandingWork: false }), false);
  assert.equal(admit({ ...base, hasPriorPaidAssessment: false }), true);
});
test('real related reassessment and independent results survive outstanding work', () => {
  assert.equal(admit({ ...base, previouslyAssessed: true, hasRelatedNewEvidence: true }), true);
  assert.equal(
    admit({ ...base, hasIndependentNewEvidence: true, hasRelatedNewEvidence: true }),
    true,
  );
  assert.equal(admit({ ...base, previouslyAssessed: true }), false);
});
test('new personal plans cannot crowd existing work; explicit releases permit a next window', () => {
  assert.equal(admit({ ...base, hasRelatedNewEvidence: true }), false);
  assert.equal(admit({ ...base, hasRelatedNewEvidence: true, hasOutstandingWork: false }), true);
  assert.equal(admit({ ...base, hasNewlyReleasedEpisode: true }), true);
});
