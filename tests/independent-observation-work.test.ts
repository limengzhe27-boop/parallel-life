import test from 'node:test';
import assert from 'node:assert/strict';
import { independentObservationWork } from '../src/modules/world/domain/independent-observation-work.ts';
import type { AgentCandidate } from '../src/modules/world/domain/agent-runtime.ts';

const candidate: AgentCandidate = {
  id: 'observation:' + 'a'.repeat(64),
  worldId: 'world',
  actorId: 'actor',
  source: 'observation',
  episodeId: null,
  actionId: null,
  resourceIds: [],
  channel: 'private',
  threadId: 'actor',
  sourceIds: ['narrative:knowledge'],
  expectedWorldVersion: 16,
  expectedActorRevision: 2,
  priority: 40,
  reason: 'Authenticated private observation',
  requiresCoordination: false,
};

test('selects the original eligible observation in scheduler priority order', () => {
  const later = { ...candidate, id: 'observation:' + 'b'.repeat(64) };
  assert.equal(independentObservationWork([candidate, later]), candidate);
  assert.equal(independentObservationWork([later, candidate]), later);
  for (const source of ['narrative:knowledge', 'scene:entry', 'group:message']) {
    const item = { ...candidate, sourceIds: [source] };
    assert.equal(independentObservationWork([item]), item);
  }
  assert.equal(independentObservationWork([]), null);
});

test('does not bypass shared work, other channels, or unrecognized source shapes', () => {
  for (const change of [
    { source: 'responsibility' },
    { id: 'episode-answer:' + 'a'.repeat(64) },
    { id: 'observation:bad' },
    { episodeId: 'episode' },
    { actionId: 'action' },
    { resourceIds: ['shared:resource'] },
    { requiresCoordination: true },
    { channel: 'group' },
    { threadId: 'other' },
    { sourceIds: [] },
    { sourceIds: ['accepted:input'] },
    { sourceIds: ['narrative:'] },
    { sourceIds: ['narrative:good', 'appointment:other'] },
  ])
    assert.equal(independentObservationWork([{ ...candidate, ...change } as AgentCandidate]), null);
  assert.equal(candidate.resourceIds.length, 0);
});
