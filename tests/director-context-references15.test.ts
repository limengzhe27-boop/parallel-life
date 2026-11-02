import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDirectorContextReferences } from '../src/modules/world/infrastructure/director-context-references.ts';

test('director reuses scoped references without losing speech, evidence or mutating its saved input', () => {
  const payload = {
    wireCatalog: {
      actors: [{ ref: 'actor:1', actorId: 'npc-original', name: '甲' }],
      sources: [{ ref: 'source:1', sourceId: 'action-result:original' }],
      candidates: [],
      places: [],
    },
    actorStates: [
      {
        actorId: 'npc-original',
        plans: [{ id: 'plan-1', status: 'waiting', sourceIds: ['action-result:original'] }],
      },
    ],
    observations: [
      {
        sourceId: 'action-result:original',
        kind: 'result',
        knownByActorIds: ['npc-original'],
        text: JSON.stringify({
          actorId: 'npc-original',
          outcome: 'failed',
          at: '2026-11-02T00:00:00Z',
          reason: 'not_here',
        }),
      },
      {
        sourceId: 'speech-1',
        kind: 'speech',
        text: 'npc-original said action-result:original',
        knownByActorIds: [],
      },
    ],
  };
  const original = structuredClone(payload);
  const output = compactDirectorContextReferences(payload) as typeof payload;
  assert.deepEqual(payload, original);
  assert.equal(output.actorStates[0]!.actorId, 'actor:1');
  assert.equal(output.actorStates[0]!.plans[0]!.sourceIds[0], 'source:1');
  assert.equal(output.observations.length, 2);
  assert.deepEqual(JSON.parse(output.observations[0]!.text), {
    actorId: 'actor:1',
    outcome: 'failed',
    at: '2026-11-02T00:00:00Z',
    reason: 'not_here',
  });
  assert.equal(output.observations[1]!.text, original.observations[1]!.text);
  assert.deepEqual(output.wireCatalog.sources, [{ ref: 'source:1' }]);
  assert.equal(output.actorStates[0]!.plans[0]!.status, 'waiting');
});
