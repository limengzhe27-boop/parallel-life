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

function periodicFixture() {
  const s = fixture();
  s.evaluationCause = {
    kind: 'periodic_review',
    genesisHash: 'genesis',
    admittedAtVersion: 10,
    qualifications: ['c', 'a', 'b', 'opening'].map((key) => ({
      ...s.authoredEligibility!.find((q) => q.nodeKey === key)!,
    })),
  } as unknown as DirectorSnapshot['evaluationCause'];
  return s;
}

test('periodic review preserves authenticated least-recently-assessed order across the full qualified window', () => {
  const s = periodicFixture();
  s.deliberationWindow = selectDirectorDeliberationWindow(s);
  assert.deepEqual(s.deliberationWindow.nodeKeys, ['c', 'a', 'b', 'opening']);
  assert.equal(s.deliberationWindow.version, 2);
  assert.equal(validDirectorDeliberationWindow(s), true);
  s.deliberationWindow.nodeKeys = ['a', 'c'];
  assert.equal(validDirectorDeliberationWindow(s), false);
  // Semantic qualification wake keeps its existing canonical order.
  s.evaluationCause = {
    ...s.evaluationCause!,
    kind: 'authored_eligibility',
  } as DirectorSnapshot['evaluationCause'];
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, ['a', 'b']);
});

test('periodic review cannot admit occupied, blocked or mismatched author evidence', () => {
  const s = periodicFixture();
  s.occupiedAuthoredEventKeys = ['c'];
  const a = s.authoredEligibility!.find((q) => q.nodeKey === 'a')!;
  a.status = 'blocked' as typeof a.status;
  const b = s.authoredEligibility!.find((q) => q.nodeKey === 'b')!;
  b.nodeHash = 'not-the-authored-material';
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, ['opening']);
  s.occupiedAuthoredEventKeys.push('opening');
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, []);
});

test('periodic scope never leaks into native turns, opening context or old unscoped snapshots', () => {
  const s = periodicFixture();
  s.nativeTurn = {} as NonNullable<DirectorSnapshot['nativeTurn']>;
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, []);
  delete s.nativeTurn;
  s.evaluationCause = { kind: 'opening_context' } as DirectorSnapshot['evaluationCause'];
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, []);
  delete s.evaluationCause;
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, []);
  delete s.deliberationWindow;
  assert.equal(validDirectorAuthoredAssessments(s, { opportunities: [] }), true);
});

test('periodic qualification identity must still match current authenticated eligibility', () => {
  const s = periodicFixture();
  s.authoredEligibility!.find((q) => q.nodeKey === 'c')!.qualificationKey = 'changed-proof';
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, ['a', 'b', 'opening']);
});
