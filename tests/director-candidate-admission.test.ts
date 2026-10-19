import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitDirectorCandidates,
  type DirectorCandidateFrame,
} from '../src/modules/world/application/director-candidate-admission.ts';
import type { AgentCandidate } from '../src/modules/world/domain/agent-runtime.ts';
const candidate = (
  id: string,
  source: AgentCandidate['source'] = 'agenda_initialize',
): AgentCandidate => ({
  id,
  source,
  worldId: 'world',
  actorId: id,
  expectedWorldVersion: 0,
  expectedActorRevision: 0,
  episodeId: null,
  actionId: null,
  resourceIds: [],
  channel: 'private',
  threadId: id,
  sourceIds: ['definition:x'],
  priority: 1,
  requiresCoordination: false,
  reason: 'original grant',
});
const frame = (candidates: AgentCandidate[]): DirectorCandidateFrame => ({
  worldId: 'world',
  engineEpoch: 2,
  worldVersion: 0,
  candidates,
});
const run = (pending: DirectorCandidateFrame | null, extra = {}) =>
  admitDirectorCandidates({
    current: frame([candidate('a'), candidate('b')]),
    pending,
    qualifiedOpeningAtBootstrap: true,
    explicitRetry: false,
    ...extra,
  });
test('qualified authored bootstrap defers initialization only; quiet is still allowed by the Director', () => {
  assert.deepEqual(run(null).candidates, []);
  assert.deepEqual(run(null).deferredInitializationIds, ['a', 'b']);
  assert.equal(run(null, { qualifiedOpeningAtBootstrap: false }).candidates.length, 2);
  assert.equal(run(null, { explicitRetry: true }).candidates.length, 2);
  const current = frame([candidate('a'), candidate('b', 'actor_plan')]);
  assert.deepEqual(
    run(null, { current }).candidates.map((c) => c.id),
    ['b'],
  );
});
test('old full and new filtered paid scopes survive a scheduling policy change', () => {
  assert.equal(run(frame([candidate('a'), candidate('b')])).candidates.length, 2);
  assert.deepEqual(run(frame([])).candidates, []);
  assert.deepEqual(
    run(frame([candidate('b')])).candidates.map((c) => c.id),
    ['b'],
  );
});
test('changed candidate, new nonfallback condition, world, version or epoch is never hidden from recovery', () => {
  const changed = candidate('a');
  changed.expectedActorRevision = 1;
  assert.equal(run(frame([changed])).candidates.length, 2);
  assert.equal(run({ ...frame([]), worldVersion: 1 }).candidates.length, 2);
  assert.equal(run({ ...frame([]), worldId: 'other' }).candidates.length, 2);
  assert.equal(run({ ...frame([]), engineEpoch: 3 }).candidates.length, 2);
  assert.equal(
    run(frame([]), { current: frame([candidate('a', 'actor_plan')]) }).candidates.length,
    1,
  );
});

test('pending wire reference order is stable even when current collection order changes', () => {
  const previous = frame([candidate('a'), candidate('b')]);
  const current = frame([candidate('b'), candidate('a')]);
  assert.deepEqual(
    run(previous, { current }).candidates.map((c) => c.id),
    ['a', 'b'],
  );
});
