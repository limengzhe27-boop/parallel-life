import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  travelTimes,
  applySpaceEvent,
  type TravelEvent,
} from '../src/modules/world/domain/space.ts';
import { replayWorldHistory } from '../src/modules/world/domain/world-history.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { restoreTravel, storeTravel } from '../src/features/phone/map/operation.ts';
function fixture() {
  const pack = OFFICIAL_LIFE_PACKS[0];
  return officialGenesis({
    opening: pack.opening,
    presetId: pack.card.id,
    contentVersion: pack.card.version,
    worldId: randomUUID(),
    ownerId: randomUUID(),
    title: pack.card.title,
    newId: randomUUID,
  });
}
test('all authored spatial openings are sourced, bounded and invitation/actor-bound', () => {
  for (const p of OFFICIAL_LIFE_PACKS) {
    const w = officialGenesis({
      opening: p.opening,
      presetId: p.card.id,
      contentVersion: p.card.version,
      worldId: randomUUID(),
      ownerId: randomUUID(),
      title: p.card.title,
      newId: randomUUID,
    });
    assert.equal(w.space!.places.length, 3);
    assert.equal(w.space!.routes.length, 6);
    assert.ok(
      w.space!.places.every(
        (place) =>
          place.source.kind === 'official_genesis' &&
          place.source.contentVersion === 2 &&
          place.contactActorIds.every((id) => w.actors.some((a) => a.id === id)) &&
          place.appointmentIds.every((id) => w.appointments.some((a) => a.id === id)),
      ),
    );
  }
  assert.equal(
    OFFICIAL_LIFE_PACKS[3].opening.space!.routes.find(
      (r) => r.from === 'seaside_home' && r.to === 'old_venue',
    )!.minutes,
    95,
  );
});
test('route duration is authoritative, does not multiply by speed; paused/unknown/wrong origin rejected', () => {
  const w = fixture(),
    realNow = '2026-10-10T00:00:00.000Z',
    clock = {
      storyNow: w.time,
      lastTickAt: realNow,
      speed: 60,
      paused: false,
      missedBeats: 0,
      summary: null,
    };
  const a = travelTimes(w, clock, 'repair_shop_to_lin_home', realNow);
  assert.equal(Date.parse(a.arrivedAt) - Date.parse(a.departedAt), 12 * 60000);
  const later = travelTimes(w, clock, 'repair_shop_to_lin_home', '2026-10-10T00:01:00.000Z');
  assert.equal(Date.parse(later.departedAt) - Date.parse(a.departedAt), 60 * 60000);
  assert.throws(() =>
    travelTimes(w, { ...clock, paused: true }, 'repair_shop_to_lin_home', realNow),
  );
  assert.throws(() =>
    travelTimes({ ...w, space: undefined }, clock, 'repair_shop_to_lin_home', realNow),
  );
  assert.throws(() => travelTimes(w, clock, 'lin_home_to_repair_shop', realNow));
});
test('travel replay retains exactly sourced departure knowledge, private destination withheld', () => {
  const w = fixture(),
    eid = randomUUID(),
    route = w.space!.routes[0]!,
    at = new Date(Date.parse(w.time) + route.durationMinutes * 60000).toISOString();
  const e: TravelEvent = {
    id: eid,
    worldId: w.id,
    commandId: randomUUID(),
    version: 1,
    schemaVersion: 1,
    type: 'travel.completed',
    occurredAt: '2026-10-10T00:00:00.000Z',
    storyAt: at,
    data: {
      routeId: route.id,
      fromPlaceId: route.fromPlaceId,
      toPlaceId: route.toPlaceId,
      durationMinutes: route.durationMinutes,
      departedAt: w.time,
      arrivedAt: at,
      leftSceneId: randomUUID(),
      departureObservation: {
        id: randomUUID(),
        sourceEventId: eid,
        text: 'Player left the garage; destination unknown.',
        kind: 'canonical',
        visibility: { kind: 'actors', actorIds: [w.actors[0]!.id] },
      },
    },
  };
  const next = applySpaceEvent(w, e),
    replayed = replayWorldHistory(w, [e]).world;
  assert.deepEqual(replayed, next);
  const known = actorContext(next, w.actors[0]!.id, 'Where?');
  const unknown = actorContext(next, w.actors[1]!.id, 'Where?');
  assert.ok(known.facts.some((f) => f.sourceEventId === eid));
  assert.ok(!unknown.facts.some((f) => f.sourceEventId === eid));
  assert.throws(() => applySpaceEvent(w, { ...e, data: { ...e.data, durationMinutes: 30 } }));
  assert.equal(replayWorldHistory(w, [e], 0).world.space!.currentPlaceId, w.space!.currentPlaceId);
});
test('persisted pending becomes unknown without losing original fingerprint; forged committed receipt rejected', () => {
  const worldId = randomUUID(),
    op = {
      request: { commandId: randomUUID(), expectedVersion: 4, routeId: 'a_to_b' },
      fromLabel: 'A',
      destinationLabel: 'B',
      status: 'pending' as const,
    };
  const value = restoreTravel(storeTravel(worldId, op), worldId);
  assert.equal(value!.status, 'unknown');
  assert.deepEqual(value!.request, op.request);
  assert.equal(restoreTravel(storeTravel(worldId, op), randomUUID()), null);
  assert.equal(
    restoreTravel(JSON.stringify({ worldId, ...op, status: 'committed', receipt: {} }), worldId),
    null,
  );
});
