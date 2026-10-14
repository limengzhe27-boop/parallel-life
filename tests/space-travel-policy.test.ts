import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  applySpaceEvent,
  validateSpace,
  type TravelEvent,
} from '../src/modules/world/domain/space.ts';
import {
  defaultTravelRoute,
  defaultTravelRoutes,
} from '../src/modules/world/domain/space-travel-policy.ts';
function fixture() {
  const pack = OFFICIAL_LIFE_PACKS[0]!;
  const world = officialGenesis({
    opening: pack.opening,
    presetId: pack.card.id,
    contentVersion: pack.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: pack.card.title,
    newId: randomUUID,
  });
  world.space!.routes = [];
  world.space!.places.forEach((p) => (p.description = ''));
  return world;
}
test('known places have stable read-only default routes; explicit authored routes take priority', () => {
  const world = fixture(),
    space = world.space!;
  validateSpace(space);
  const before = structuredClone(space);
  const routes = defaultTravelRoutes(space);
  assert.equal(routes.length, space.places.length - 1);
  assert.deepEqual(space, before);
  assert.deepEqual(defaultTravelRoutes(space), routes);
  assert.equal(defaultTravelRoute(space, space.currentPlaceId, 'unknown'), null);
  const route = routes[0]!;
  space.routes.push({
    ...route,
    id: 'authored',
    durationMinutes: 45,
    source: space.places[0]!.source,
  });
  assert.equal(defaultTravelRoute(space, route.fromPlaceId, route.toPlaceId), null);
});
test('actual default travel replays without persisting generated edges or moving any NPC', () => {
  const world = fixture(),
    route = defaultTravelRoutes(world.space!)[0]!;
  const event: TravelEvent = {
    schemaVersion: 1,
    id: randomUUID(),
    commandId: randomUUID(),
    worldId: world.id,
    version: world.version + 1,
    occurredAt: world.time,
    storyAt: new Date(Date.parse(world.time) + 600000).toISOString(),
    type: 'travel.completed',
    data: {
      routeId: route.id,
      fromPlaceId: route.fromPlaceId,
      toPlaceId: route.toPlaceId,
      durationMinutes: 10,
      departedAt: world.time,
      arrivedAt: new Date(Date.parse(world.time) + 600000).toISOString(),
      leftSceneId: null,
      generatedRoute: route,
    },
  };
  const changed = applySpaceEvent(world, event);
  assert.equal(changed.space!.currentPlaceId, route.toPlaceId);
  assert.equal(changed.space!.routes.length, 0);
  assert.deepEqual(changed.actors, world.actors);
  assert.deepEqual(changed.facts, world.facts);
  for (const patch of [
    { routeId: 'forged' },
    { durationMinutes: 1 },
    { toPlaceId: 'unknown' },
    { generatedRoute: { ...route, durationMinutes: 1 } },
    {
      generatedRoute: {
        ...route,
        source: { kind: 'system_policy', policy: 'forged', snapshotVersion: 0 },
      },
    },
  ])
    assert.throws(() =>
      applySpaceEvent(world, { ...event, data: { ...event.data, ...patch } } as TravelEvent),
    );
  const explicit = structuredClone(world);
  explicit.space!.routes.push({
    ...route,
    id: 'authored',
    durationMinutes: 45,
    source: explicit.space!.places[0]!.source,
  });
  assert.throws(() => applySpaceEvent(explicit, event));
});
test('default route policy cannot impersonate a place or position source', () => {
  const world = fixture(),
    route = defaultTravelRoutes(world.space!)[0]!;
  const forged = structuredClone(world.space!);
  forged.places[0]!.source = route.source;
  assert.throws(() => validateSpace(forged));
  const forgedPosition = structuredClone(world.space!);
  forgedPosition.positionSource = route.source;
  assert.throws(() => validateSpace(forgedPosition));
});
