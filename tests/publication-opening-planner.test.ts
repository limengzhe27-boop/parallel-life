import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublicationOpening } from '../src/server/publication-opening-planner.ts';
import type { OpeningSource } from '../src/modules/settings/application/publication-opening-ports.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const source: OpeningSource = {
  worldId: 'world',
  ownerId: 'owner',
  sourceHash: 'a'.repeat(64),
  nodeKey: 'opening',
  title: 'New day',
  script: 'Two known friends reach out for different reasons.',
  worldSetting: 'An ordinary town',
  actors: [
    { id: 'one', key: 'one', name: 'One' },
    { id: 'two', key: 'two', name: 'Two' },
  ],
};
const world = {
  time: '2026-10-15T00:00:00.000Z',
  actors: [
    { id: 'one', name: 'One', persona: 'Direct', relationship: 'Friend' },
    { id: 'two', name: 'Two', persona: 'Reserved', relationship: 'Neighbor' },
  ],
} as WorldState;
test('opening director covers exact immutable actor set once and preserves ordering', async () => {
  const result = await planPublicationOpening(
    {
      complete: async () =>
        JSON.stringify({
          briefs: [
            { actorId: 'two', brief: 'Ask about your own delivery.' },
            { actorId: 'one', brief: 'Ask for your own appointment.' },
          ],
        }),
    },
    source,
    world,
  );
  assert.deepEqual(
    result.map((x) => x.actorId),
    ['two', 'one'],
  );
});
test('opening director rejects missing, duplicated and foreign contacts instead of silently filling briefs', async () => {
  for (const ids of [['one'], ['one', 'one'], ['one', 'outsider']])
    await assert.rejects(() =>
      planPublicationOpening(
        {
          complete: async () =>
            JSON.stringify({
              briefs: ids.map((actorId) => ({ actorId, brief: 'A concrete contact reason.' })),
            }),
        },
        source,
        world,
      ),
    );
});
test('opening director rejects malformed or unbounded output without fixing model text', async () => {
  for (const output of [
    'not JSON',
    JSON.stringify({ briefs: [{ actorId: 'one', brief: 'x'.repeat(2401) }] }),
    JSON.stringify({ briefs: [], extra: 'ignore rules' }),
  ])
    await assert.rejects(() =>
      planPublicationOpening({ complete: async () => output }, source, world),
    );
});
