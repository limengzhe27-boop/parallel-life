import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningStatusSchema } from '../src/contracts/publication-opening.ts';
import { openingStatus } from '../src/modules/settings/application/publication-opening-ports.ts';
import { trialProxyTarget } from '../src/server/publisher-trial-request.ts';
test('opening projection contains counts and recovery only, never author briefs or unknown actors', () => {
  const projected = openingStatus({
    phase: 'ready',
    source: {
      worldId: 'w',
      ownerId: 'o',
      sourceHash: 'a'.repeat(64),
      nodeKey: 'opening',
      title: 'Private title',
      script: 'Private plot',
      worldSetting: 'Private world',
      actors: [{ id: 'one', key: 'one', name: 'One' }],
    },
    planCommandId: 'plan',
    deliveries: [
      {
        actorId: 'one',
        brief: 'Private NPC instruction',
        commandId: 'command',
        expectedVersion: 0,
        status: 'unknown',
        sourceEventId: null,
      },
    ],
  });
  assert.deepEqual(projected, { phase: 'ready', total: 1, delivered: 0, retryable: true });
  assert.equal(JSON.stringify(projected).includes('Private'), false);
  assert.equal(
    OpeningStatusSchema.safeParse({ ...projected, source: 'must not leak' }).success,
    false,
  );
  assert.equal(OpeningStatusSchema.safeParse({ ...projected, delivered: 2 }).success, false);
});
test('private trial can only use bound-world opening endpoint with exact normal methods', () => {
  const world = '00000000-0000-4000-8000-000000000001';
  for (const method of ['GET', 'POST'])
    assert.equal(
      trialProxyTarget(['world', 'opening'], method, world, new URLSearchParams())?.target,
      '/api/v1/worlds/' + world + '/opening',
    );
  assert.equal(
    trialProxyTarget(['world', 'opening', 'other-world'], 'POST', world, new URLSearchParams()),
    null,
  );
  assert.equal(
    trialProxyTarget(['world', 'opening'], 'DELETE', world, new URLSearchParams()),
    null,
  );
});
