import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validNativeTurnDecision,
  type DirectorSnapshot,
  type DirectorDecision,
} from '../src/modules/world/domain/director-runtime.ts';

test('native speaker coordination cannot create events, write nudges, select everyone or borrow another channel', () => {
  const snapshot = {
    nativeTurn: { taskId: 'task', inputReceiptId: 'input', channel: 'group', threadId: 'group' },
    candidates: [
      {
        id: 'a',
        source: 'conversation',
        channel: 'group',
        threadId: 'group',
        sourceIds: ['input'],
      },
      {
        id: 'b',
        source: 'conversation',
        channel: 'group',
        threadId: 'group',
        sourceIds: ['input'],
      },
    ],
  } as unknown as DirectorSnapshot;
  const choice = {
    mode: 'coordinate',
    selectedCandidateIds: ['b'],
    opportunities: [],
    nudges: [],
  } satisfies Pick<DirectorDecision, 'mode' | 'selectedCandidateIds' | 'opportunities' | 'nudges'>;
  assert.equal(validNativeTurnDecision(snapshot, choice), true);
  assert.equal(
    validNativeTurnDecision(snapshot, { ...choice, mode: 'quiet', selectedCandidateIds: [] }),
    true,
  );
  assert.equal(
    validNativeTurnDecision(snapshot, { ...choice, selectedCandidateIds: ['a', 'b'] }),
    false,
  );
  assert.equal(
    validNativeTurnDecision(snapshot, { ...choice, selectedCandidateIds: ['unknown'] }),
    false,
  );
  assert.equal(
    validNativeTurnDecision(snapshot, { ...choice, mode: 'bounded_opportunity' }),
    false,
  );
  for (const change of [
    { channel: 'scene' },
    { threadId: 'other' },
    { sourceIds: ['private-input'] },
    { source: 'actor_plan' },
  ]) {
    const modified = structuredClone(snapshot);
    Object.assign(modified.candidates[1]!, change);
    assert.equal(validNativeTurnDecision(modified, choice), false);
  }
  assert.equal(validNativeTurnDecision({ ...snapshot, nativeTurn: undefined }, choice), true);
});
