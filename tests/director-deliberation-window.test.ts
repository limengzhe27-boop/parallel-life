import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDirectorDeliberationWindow,
  validDirectorDeliberationWindow,
  validDirectorAuthoredAssessments,
  type DirectorSnapshot,
} from '../src/modules/world/domain/director-runtime.ts';
function fixture() {
  return {
    authoredMaterials: {
      materials: ['opening', 'a', 'b', 'c'].map((nodeKey) => ({
        ref: { nodeKey, nodeHash: nodeKey },
        role: nodeKey === 'opening' ? 'opening' : 'candidate',
      })),
    },
    authoredEligibility: ['opening', 'a', 'b', 'c'].map((nodeKey) => ({
      nodeKey,
      nodeHash: nodeKey,
      status: 'eligible',
      qualificationKey: nodeKey,
    })),
    occupiedAuthoredEventKeys: [],
    evaluationCause: { kind: 'bootstrap' },
  } as unknown as DirectorSnapshot;
}
test('bootstrap scopes opening; subsequent window uses only stable unseen qualifications', () => {
  const s = fixture();
  s.deliberationWindow = selectDirectorDeliberationWindow(s);
  assert.deepEqual(s.deliberationWindow.nodeKeys, ['opening']);
  assert.equal(validDirectorDeliberationWindow(s), true);
  const assessment = {
    nodeKey: 'opening',
    nodeHash: 'opening',
    qualificationKey: 'opening',
    decision: 'defer' as const,
    reason: 'Waiting for legitimate conditions',
  };
  assert.equal(
    validDirectorAuthoredAssessments(s, { authoredAssessments: [assessment], opportunities: [] }),
    true,
  );
  assert.equal(validDirectorAuthoredAssessments(s, { opportunities: [] }), false);
  s.evaluationCause = {
    kind: 'authored_eligibility',
    qualifications: s.authoredEligibility!.filter((q) => q.nodeKey !== 'opening'),
  } as unknown as DirectorSnapshot['evaluationCause'];
  s.deliberationWindow = selectDirectorDeliberationWindow(s);
  assert.deepEqual(s.deliberationWindow.nodeKeys, ['a', 'b']);
  s.deliberationWindow.nodeKeys = ['c'];
  assert.equal(validDirectorDeliberationWindow(s), false);
});
test('protected old snapshots retain legacy assessment scope and are never silently upgraded', () => {
  const s = fixture();
  assert.equal(validDirectorAuthoredAssessments(s, { opportunities: [] }), true);
  assert.equal(
    validDirectorAuthoredAssessments(s, { authoredAssessments: [], opportunities: [] }),
    false,
  );
  delete s.evaluationCause;
  s.deliberationWindow = selectDirectorDeliberationWindow(s);
  assert.deepEqual(s.deliberationWindow.nodeKeys, []);
});
