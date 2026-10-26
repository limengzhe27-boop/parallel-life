import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentSceneArrival } from '../src/modules/world/domain/agent-scene-arrival.ts';
import type { SceneSession } from '../src/modules/world/domain/experience-rules.ts';
import type { AgentArrivalCommittedEvent } from '../src/modules/world/domain/agent-arrival-event.ts';
import type { AuthoritativePosition } from '../src/modules/world/domain/world-awareness.ts';
const at = '2026-10-15T09:15:00.000Z';
function fixture() {
  const scene: SceneSession = {
    id: 'scene',
    ownerId: 'owner',
    worldId: 'world',
    title: '公园',
    placeId: 'park',
    status: 'active',
    sourceEventId: 'entered',
    sourceVersion: 1,
    presence: [
      {
        participant: { kind: 'player' },
        joinedVersion: 1,
        sourceVersion: 1,
        sourceEventId: 'entered',
      },
    ],
  };
  const event: AgentArrivalCommittedEvent = {
    schemaVersion: 1,
    id: 'arrival',
    worldId: 'world',
    commandId: 'arrival_journey',
    version: 3,
    occurredAt: at,
    storyAt: at,
    type: 'agent.arrival_committed',
    data: {
      actorId: 'actor',
      journeyId: 'journey',
      departureEventId: 'departure',
      route: {
        id: 'route',
        fromPlaceId: 'shop',
        toPlaceId: 'park',
        durationMinutes: 15,
        modeLabel: '步行',
        source: { kind: 'seed_genesis', seedId: 'seed', snapshotVersion: 0 },
      },
      arrival: {
        worldId: 'world',
        actorId: 'actor',
        id: 'receipt',
        commandId: 'arrival_journey',
        eventId: 'arrival',
        worldVersion: 3,
        at,
        journeyId: 'journey',
      },
    },
  };
  const player: AuthoritativePosition = {
    worldId: 'world',
    subject: { kind: 'player' },
    status: 'at',
    placeId: 'park',
    sourceEventId: 'entered',
    worldVersion: 1,
    occurredAt: '2026-10-15T09:00:00.000Z',
  };
  return { scene, event, player };
}
test('actual arrival appends one exact source interval without changing prior scene history', () => {
  const { scene, event, player } = fixture(),
    before = structuredClone(scene);
  const joined = applyAgentSceneArrival(scene, { ownerId: 'owner', event, playerPosition: player });
  assert.equal(joined.presence.length, 2);
  assert.deepEqual(joined.presence[1], {
    participant: { kind: 'actor', actorId: 'actor' },
    joinedVersion: 3,
    sourceVersion: 3,
    sourceEventId: 'arrival',
  });
  assert.deepEqual(scene, before);
  assert.deepEqual(joined.presence[0], before.presence[0]);
  assert.equal(
    applyAgentSceneArrival(joined, { ownerId: 'owner', event, playerPosition: player }),
    joined,
  );
  const later = {
    ...joined,
    status: 'ended' as const,
    presence: joined.presence.map((p) => ({ ...p, leftVersion: 4 })),
  };
  assert.equal(
    applyAgentSceneArrival(later, { ownerId: 'owner', event, playerPosition: null }),
    later,
  );
});
test('unknown/away player, no actual player interval, closed or wrong scene do not invent presence', () => {
  const { scene, event, player } = fixture();
  for (const p of [
    null,
    { ...player, status: 'unknown' as const, placeId: null },
    { ...player, status: 'in_transit' as const, placeId: null },
    { ...player, placeId: 'shop' },
    { ...player, worldVersion: 3 },
  ])
    assert.equal(
      applyAgentSceneArrival(scene, { ownerId: 'owner', event, playerPosition: p }),
      scene,
    );
  for (const s of [
    { ...scene, placeId: 'shop' },
    { ...scene, status: 'ended' as const },
    { ...scene, presence: [] },
    { ...scene, presence: scene.presence.map((p) => ({ ...p, leftVersion: 2 })) },
  ])
    assert.equal(applyAgentSceneArrival(s, { ownerId: 'owner', event, playerPosition: player }), s);
});
test('forged arrival or owner scope rejects; a prior closed interval permits a real rejoin', () => {
  const { scene, event, player } = fixture();
  assert.throws(
    () => applyAgentSceneArrival(scene, { ownerId: 'other', event, playerPosition: player }),
    { code: 'INVALID_PROPOSAL' },
  );
  assert.throws(
    () =>
      applyAgentSceneArrival(scene, {
        ownerId: 'owner',
        event: {
          ...event,
          data: { ...event.data, arrival: { ...event.data.arrival, eventId: 'said_arrived' } },
        },
        playerPosition: player,
      }),
    { code: 'INVALID_PROPOSAL' },
  );
  const s = {
    ...scene,
    presence: [
      ...scene.presence,
      {
        participant: { kind: 'actor' as const, actorId: 'actor' },
        sourceEventId: 'old',
        sourceVersion: 1,
        joinedVersion: 1,
        leftVersion: 2,
      },
    ],
  };
  assert.equal(
    applyAgentSceneArrival(s, { ownerId: 'owner', event, playerPosition: player }).presence.length,
    3,
  );
});
