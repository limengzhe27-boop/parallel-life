import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldWithdrawDeclinedEpisode } from '../src/modules/world/domain/episode-participation-lifecycle.ts';
import type { SharedEpisode } from '../src/modules/world/domain/director-runtime.ts';

const episode = (status: SharedEpisode['status'] = 'proposed'): SharedEpisode => ({
  schemaVersion: 1,
  id: 'episode',
  worldId: 'world',
  revision: 0,
  origin: { kind: 'director', sourceId: 'decision' },
  status,
  title: 'Existing opportunity',
  description: 'Not an executed event',
  participantActorIds: ['a', 'b'],
  placeIds: [],
  sourceEventIds: [],
  resultIds: [],
  unresolvedResponsibilityIds: [],
});
const declined = [
  { actorId: 'a', choice: 'decline' },
  { actorId: 'b', choice: 'decline' },
];

test('only complete unique initial declines withdraw a proposed shared episode without mutation', () => {
  const input = episode();
  const before = structuredClone(input);
  assert.equal(shouldWithdrawDeclinedEpisode(input, [...declined].reverse()), true);
  assert.deepEqual(input, before);
  assert.equal(
    shouldWithdrawDeclinedEpisode({ ...input, participantActorIds: ['a'] }, declined.slice(0, 1)),
    true,
  );
});
test('pending, quiet, defer, missing information, unassessed and engagement are not declines', () => {
  for (const choice of ['pending', 'quiet', 'defer', 'need_information', 'unassessed', 'engage']) {
    assert.equal(
      shouldWithdrawDeclinedEpisode(episode(), [declined[0]!, { actorId: 'b', choice }]),
      false,
      choice,
    );
  }
  assert.equal(shouldWithdrawDeclinedEpisode(episode(), declined.slice(0, 1)), false);
  assert.equal(shouldWithdrawDeclinedEpisode(episode(), []), false);
});
test('duplicate or wrong actor receipts cannot substitute for another participant', () => {
  assert.equal(shouldWithdrawDeclinedEpisode(episode(), [declined[0]!, declined[0]!]), false);
  assert.equal(
    shouldWithdrawDeclinedEpisode(episode(), [
      declined[0]!,
      { actorId: 'other', choice: 'decline' },
    ]),
    false,
  );
  assert.equal(
    shouldWithdrawDeclinedEpisode(episode(), [
      ...declined,
      { actorId: 'other', choice: 'decline' },
    ]),
    false,
  );
  assert.equal(shouldWithdrawDeclinedEpisode({ ...episode(), participantActorIds: [] }, []), false);
  assert.equal(
    shouldWithdrawDeclinedEpisode({ ...episode(), participantActorIds: ['a', 'a'] }, [
      declined[0]!,
    ]),
    false,
  );
});
test('active or terminal shared events never close or reopen through initial decline aggregation', () => {
  for (const status of ['active', 'resolved', 'withdrawn'] as const)
    assert.equal(shouldWithdrawDeclinedEpisode(episode(status), declined), false);
});
