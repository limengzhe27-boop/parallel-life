import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchEntryState } from '../src/features/interview/branch-entry.ts';

const base = {
  ready: true,
  hasReadyWorld: false,
  confirmedCount: 0,
  pendingCandidates: 0,
  directionCount: 0,
};

test('the branch entry never appears before the assistant has replied', () => {
  assert.deepEqual(branchEntryState({ ...base, ready: false, pendingCandidates: 3 }), {
    kind: 'hidden',
  });
});

test('an existing world can be reopened even without freshly confirmed records', () => {
  assert.deepEqual(branchEntryState({ ...base, hasReadyWorld: true }), { kind: 'open-ready' });
});

test('no confirmed material never calls the model: pending records are confirmed first', () => {
  assert.deepEqual(branchEntryState({ ...base, pendingCandidates: 5 }), {
    kind: 'confirm-records',
    pending: 5,
  });
  assert.deepEqual(branchEntryState({ ...base, pendingCandidates: 0 }), { kind: 'needs-material' });
});

test('confirmed material offers generation, and reports how many directions already exist', () => {
  assert.deepEqual(branchEntryState({ ...base, confirmedCount: 1 }), {
    kind: 'create',
    directionCount: 0,
  });
  assert.deepEqual(branchEntryState({ ...base, confirmedCount: 3, directionCount: 3 }), {
    kind: 'create',
    directionCount: 3,
  });
});

test('the entry is offered before confirmation is possible only through a ready world', () => {
  const states = [
    branchEntryState({ ...base, pendingCandidates: 2 }),
    branchEntryState(base),
    branchEntryState({ ...base, confirmedCount: 2 }),
    branchEntryState({ ...base, hasReadyWorld: true }),
  ];
  assert.deepEqual(
    states.map((state) => state.kind),
    ['confirm-records', 'needs-material', 'create', 'open-ready'],
  );
});
