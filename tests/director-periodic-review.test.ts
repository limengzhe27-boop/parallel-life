import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDirectorDeliberationWindow,
  validDirectorDeliberationWindow,
  isDirectorDeliberationEvent,
  type DirectorSnapshot,
} from '../src/modules/world/domain/director-runtime.ts';
function periodic(count = 5) {
  const keys = Array.from({ length: count }, (_, i) => `node_${i}`);
  const qualifications = keys.map((nodeKey) => ({
    nodeKey,
    nodeHash: nodeKey,
    qualificationKey: nodeKey,
    status: 'eligible',
    reasons: [],
    basisSourceIds: [],
  }));
  return {
    authoredMaterials: {
      materials: keys.map((nodeKey) => ({
        ref: { nodeKey, nodeHash: nodeKey },
        role: 'candidate',
      })),
    },
    authoredEligibility: qualifications,
    occupiedAuthoredEventKeys: [],
    evaluationCause: {
      kind: 'periodic_review',
      id: 'periodic',
      genesisHash: 'hash',
      admittedAtVersion: 0,
      qualifications,
    },
    candidates: [],
  } as unknown as DirectorSnapshot;
}
test('new periodic review sees all qualified author choices up to 32, without granting extra emergent slots', () => {
  const s = periodic();
  s.deliberationWindow = selectDirectorDeliberationWindow(s);
  assert.equal(s.deliberationWindow.version, 2);
  assert.deepEqual(s.deliberationWindow.nodeKeys, [
    'node_0',
    'node_1',
    'node_2',
    'node_3',
    'node_4',
  ]);
  assert.equal(validDirectorDeliberationWindow(s), true);
  assert.equal(isDirectorDeliberationEvent(s, 'outside'), false);
  const many = periodic(35);
  many.deliberationWindow = selectDirectorDeliberationWindow(many);
  assert.equal(many.deliberationWindow.nodeKeys.length, 32);
  assert.equal(isDirectorDeliberationEvent(many, 'node_32'), false);
});
test('saved v1 periodic frames retain their original two choices and are not upgraded by validation', () => {
  const s = periodic();
  s.deliberationWindow = { version: 1, nodeKeys: ['node_0', 'node_1'] };
  const before = JSON.stringify(s);
  assert.equal(validDirectorDeliberationWindow(s), true);
  assert.equal(isDirectorDeliberationEvent(s, 'node_2'), false);
  assert.equal(JSON.stringify(s), before);
  s.deliberationWindow.nodeKeys.push('node_2');
  assert.equal(validDirectorDeliberationWindow(s), false);
});
test('expanded window still excludes blocked, occupied and unbound evidence; nonperiodic remains v1', () => {
  const s = periodic();
  s.occupiedAuthoredEventKeys = ['node_1'];
  s.authoredEligibility![2]!.status = 'blocked';
  s.authoredEligibility![3]!.nodeHash = 'mismatch';
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, ['node_0', 'node_4']);
  s.evaluationCause = {
    ...s.evaluationCause!,
    kind: 'authored_eligibility',
  } as DirectorSnapshot['evaluationCause'];
  assert.equal(selectDirectorDeliberationWindow(s).version, 1);
  s.nativeTurn = {} as never;
  assert.deepEqual(selectDirectorDeliberationWindow(s).nodeKeys, []);
});
