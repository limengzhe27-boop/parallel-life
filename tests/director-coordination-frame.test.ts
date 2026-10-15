import test from 'node:test';
import assert from 'node:assert/strict';
import { directorCoordinationFrameHash } from '../src/modules/world/infrastructure/director-runtime-repository.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { DirectorSnapshot } from '../src/modules/world/domain/director-runtime.ts';

function snapshot(): DirectorSnapshot {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 0);
  state.responsibilities.push({
    id: 'request',
    subject: { kind: 'request', id: 'request' },
    summary: 'Wait until the author supplied time',
    status: 'waiting',
    waitingOn: null,
    sourceIds: ['s'],
    nextCheck: [{ kind: 'at_or_after', at: '2026-10-15T10:00:00Z', sourceId: 's' }],
  });
  return {
    schemaVersion: 1,
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 2,
    storyAt: '2026-10-15T09:00:00Z',
    observedThroughVersion: 2,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'w',
      actorIds: ['a'],
      placeIds: [],
      capabilityIds: [],
      extensionPermission: 'none',
      createdFromVersion: 0,
      sourceEventId: null,
    },
    actorStates: [state],
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [],
    focus: [],
  };
}
test('idle ticks and evaluated bookkeeping do not purchase another director call for the same semantic frame', () => {
  const original = snapshot(),
    later = structuredClone(original);
  later.storyAt = '2026-10-15T09:59:59Z';
  later.evaluatedThroughVersion = 2;
  assert.equal(directorCoordinationFrameHash(later), directorCoordinationFrameHash(original));
  later.storyAt = '2026-10-15T10:00:00Z';
  assert.notEqual(
    directorCoordinationFrameHash(later),
    directorCoordinationFrameHash(original),
    'crossing a sourced condition creates a new semantic frame',
  );
});
test('actual focus, candidate or state changes alter the command frame without array-order or random routing', () => {
  const original = snapshot(),
    changed = structuredClone(original);
  changed.focus = [{ channel: 'private', threadId: 'a', actorIds: ['a'] }];
  assert.notEqual(directorCoordinationFrameHash(changed), directorCoordinationFrameHash(original));
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as DirectorSnapshot;
  assert.equal(
    directorCoordinationFrameHash(reordered),
    directorCoordinationFrameHash(original),
    'JSONB object ordering does not change identity',
  );
});

test('persistent questions are part of the real Director frame, independent of topic focus', () => {
  const original = snapshot();
  original.actorStates[0]!.questions = [
    {
      id: 'q',
      sourceId: 's',
      channel: 'private',
      threadId: 'a',
      text: '要一起吃饭吗？',
      askedAt: original.storyAt,
      status: 'open',
    },
  ];
  const pending = directorCoordinationFrameHash(original);
  const changed = structuredClone(original);
  changed.actorStates[0]!.questions![0]!.status = 'answered';
  changed.actorStates[0]!.questions![0]!.resolution = {
    kind: 'answer',
    sourceId: 'input',
    quote: '先不去',
    at: original.storyAt,
  };
  assert.notEqual(directorCoordinationFrameHash(changed), pending);
  assert.equal(original.focus.length, 0);
});
