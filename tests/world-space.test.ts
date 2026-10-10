import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officialGenesis } from '../src/modules/world/domain/official-genesis.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  travelTimes,
  applySpaceEvent,
  deriveInitialSpace,
  validateSpace,
  authoredSpace,
  type TravelEvent,
} from '../src/modules/world/domain/space.ts';
import { SpaceSourceSchema } from '../src/contracts/world-space.ts';
import { replayWorldHistory } from '../src/modules/world/domain/world-history.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { restoreTravel, storeTravel } from '../src/features/phone/map/operation.ts';
import { buildAgenda, threadFor, eligibleAgenda } from '../src/modules/world/domain/agenda.ts';
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
test('deriveInitialSpace constructs coherent places, routes and starting position from seed setup', () => {
  const seedId = randomUUID();
  const actor1Id = randomUUID();
  const actor2Id = randomUUID();
  const actorIds = new Map([
    ['actor_a', actor1Id],
    ['actor_b', actor2Id],
  ]);
  const seed = {
    setup: { place: '青石老街·林记汽修' },
    story: { premise: '你接管了父亲在青石老街留下的汽修铺。', title: '汽修岁月' },
  };
  const opening = {
    setting: '午后的老街修车铺里，满是旧工具和发动机的气味。',
    actors: [
      { key: 'actor_a', name: '林叔' },
      { key: 'actor_b', name: '阿杰' },
    ],
  };
  const apptId = randomUUID();
  const space = deriveInitialSpace({
    seed,
    opening,
    actorIds,
    appointments: [{ id: apptId, title: '老茶馆碰头', participantIds: [actor1Id] }],
    source: { kind: 'seed_genesis', seedId, snapshotVersion: 0 },
  });
  assert.ok(space);
  assert.equal(space.currentPlaceId, 'primary_place');
  assert.equal(space.places.length, 3);
  assert.equal(space.places[0]!.id, 'primary_place');
  assert.equal(space.places[0]!.name, '青石老街·林记汽修');
  assert.deepEqual(space.places[0]!.contactActorIds, [actor1Id, actor2Id]);
  assert.equal(space.places[1]!.id, 'community_area');
  assert.ok(space.places[1]!.name.includes('周边街区'));
  assert.equal(space.places[2]!.id, 'appointment_venue');
  assert.ok(space.places[2]!.name.includes('老茶馆碰头'));
  assert.deepEqual(space.places[2]!.appointmentIds, [apptId]);
  assert.equal(space.routes.length, 6);
  assert.ok(
    space.routes.every(
      (r) =>
        r.durationMinutes >= 1 &&
        r.durationMinutes <= 120 &&
        r.fromPlaceId !== r.toPlaceId &&
        Boolean(r.modeLabel),
    ),
  );
  assert.doesNotThrow(() => validateSpace(space));
  // Validates through SpaceSourceSchema
  assert.ok(SpaceSourceSchema.safeParse(space.places[0]!.source).success);
  assert.equal(space.places[0]!.source.kind, 'seed_genesis');
});
test('deriveInitialSpace returns undefined when seed has no reliable place, preserving honest empty state', () => {
  const seedId = randomUUID();
  const actorIds = new Map([['actor_a', randomUUID()]]);
  const emptySeed = {
    setup: { place: '   ' },
    story: { premise: '一段没有设定地点的人生。', title: '无题' },
  };
  const opening = {
    setting: '未指明任何地点。',
    actors: [{ key: 'actor_a', name: '张三' }],
  };
  const space = deriveInitialSpace({
    seed: emptySeed,
    opening,
    actorIds,
    source: { kind: 'seed_genesis', seedId, snapshotVersion: 0 },
  });
  assert.equal(space, undefined);
});
test('validateSpace strictly rejects invalid spatial proposals', () => {
  const seedId = randomUUID();
  const baseSource = { kind: 'seed_genesis' as const, seedId, snapshotVersion: 0 as const };
  const validSpace = {
    places: [
      {
        id: 'place_a',
        name: '地点A',
        description: '描述A',
        source: baseSource,
        contactActorIds: [],
        appointmentIds: [],
      },
      {
        id: 'place_b',
        name: '地点B',
        description: '描述B',
        source: baseSource,
        contactActorIds: [],
        appointmentIds: [],
      },
    ],
    routes: [
      {
        id: 'a_to_b',
        fromPlaceId: 'place_a',
        toPlaceId: 'place_b',
        durationMinutes: 10,
        modeLabel: '步行',
        source: baseSource,
      },
    ],
    currentPlaceId: 'place_a',
    positionSource: baseSource,
  };
  assert.doesNotThrow(() => validateSpace(validSpace));
  // Reject missing current place
  assert.throws(() => validateSpace({ ...validSpace, currentPlaceId: 'place_unknown' }));
  // Reject route to unknown place
  assert.throws(() =>
    validateSpace({
      ...validSpace,
      routes: [
        {
          ...validSpace.routes[0]!,
          toPlaceId: 'place_unknown',
        },
      ],
    }),
  );
  // Reject self route
  assert.throws(() =>
    validateSpace({
      ...validSpace,
      routes: [
        {
          ...validSpace.routes[0]!,
          toPlaceId: 'place_a',
        },
      ],
    }),
  );
  // Reject route duration out of bounds (0 or >120)
  assert.throws(() =>
    validateSpace({
      ...validSpace,
      routes: [{ ...validSpace.routes[0]!, durationMinutes: 0 }],
    }),
  );
  assert.throws(() =>
    validateSpace({
      ...validSpace,
      routes: [{ ...validSpace.routes[0]!, durationMinutes: 121 }],
    }),
  );
  // Reject invalid key pattern
  assert.throws(() =>
    validateSpace({
      ...validSpace,
      places: [{ ...validSpace.places[0]!, id: 'INVALID-UPPER' }, validSpace.places[1]!],
    }),
  );
});

test('departure inquiry only cues actual observers, clears after reply, uninformed NPCs remain silent', () => {
  const w = fixture();
  const observer = w.actors[0]!;
  const uninformed = w.actors[1]!;
  const fromPlace = w.space!.places[0]!;

  // 1. Initially no departure inquiry
  const agenda0 = buildAgenda(w);
  assert.ok(!agenda0.some((t) => t.kind === 'departure_inquiry'));

  // 2. Add departure observation fact visible ONLY to observer
  const departureFact = {
    id: randomUUID(),
    text: `你亲眼看到主角离开了${fromPlace.name}，没有获知目的地。`,
    kind: 'canonical' as const,
    visibility: { kind: 'actors' as const, actorIds: [observer.id] },
    sourceEventId: randomUUID(),
    departure: { fromPlaceName: fromPlace.name, eventVersion: w.version + 1 },
  };
  const wWithFact = {
    ...w,
    version: w.version + 1,
    facts: [...w.facts, departureFact],
  };

  const agenda1 = buildAgenda(wWithFact);
  const observerThread = agenda1.find(
    (t) => t.kind === 'departure_inquiry' && t.actorId === observer.id,
  );
  assert.ok(observerThread, 'Observer actor must receive departure_inquiry thread');
  assert.match(observerThread.detail, new RegExp(fromPlace.name));
  assert.match(observerThread.detail, /绝不能假装知道目的地/);

  // Uninformed NPC must NOT receive departure_inquiry
  const uninformedThread = agenda1.find(
    (t) => t.kind === 'departure_inquiry' && t.actorId === uninformed.id,
  );
  assert.ok(!uninformedThread, 'Uninformed actor must NOT receive departure_inquiry');

  // Eligible agenda owed now includes departure_inquiry even with recent actor filter
  const eligible = eligibleAgenda(agenda1, new Set([observer.id]));
  assert.ok(eligible.some((t) => t.kind === 'departure_inquiry' && t.actorId === observer.id));

  // 3. Once observer replies, departure inquiry clears
  const wAfterReply = {
    ...wWithFact,
    version: wWithFact.version + 1,
    messages: [
      ...wWithFact.messages,
      {
        id: randomUUID(),
        actorId: observer.id,
        role: 'assistant' as const,
        text: '刚才看你急匆匆走了，是有什么急事吗？',
        at: wWithFact.time,
        sourceEventId: randomUUID(),
        sourceVersion: wWithFact.version + 1,
      },
    ],
  };
  const agenda2 = buildAgenda(wAfterReply);
  assert.ok(
    !agenda2.some((t) => t.kind === 'departure_inquiry' && t.actorId === observer.id),
    'Cleared after observer spoke',
  );
});

test('appointment_due distinguishes player present at venue vs absent elsewhere; unconfirmed proposed stays quiet', () => {
  const w = fixture();
  const actor = w.actors[0]!;
  const venue = w.space!.places[0]!;
  const appointmentId = randomUUID();
  const appointmentTime = w.time;

  // Link appointment to venue
  const placesWithAppt = w.space!.places.map((p) =>
    p.id === venue.id ? { ...p, appointmentIds: [...p.appointmentIds, appointmentId] } : p,
  );

  // 1. Confirmed appointment when player IS at venue
  const wAtVenue = {
    ...w,
    space: {
      ...w.space!,
      places: placesWithAppt,
      currentPlaceId: venue.id,
    },
    appointments: [
      ...w.appointments,
      {
        id: appointmentId,
        title: '维修店工作交接',
        at: appointmentTime,
        status: 'confirmed' as const,
        participantIds: [actor.id],
        sourceEventId: randomUUID(),
      },
    ],
  };
  const agendaAtVenue = buildAgenda(wAtVenue);
  const dueAtVenue = agendaAtVenue.find(
    (t) => t.kind === 'appointment_due' && t.actorId === actor.id,
  );
  assert.ok(dueAtVenue);
  assert.match(dueAtVenue.detail, /主角此刻就在/);
  assert.match(dueAtVenue.detail, /绝不能声称主角迟到或失约/);

  // 2. Confirmed appointment when player travelled to a different place
  const otherPlace = w.space!.places[1]!;
  const wAtOther = {
    ...wAtVenue,
    space: {
      ...wAtVenue.space!,
      currentPlaceId: otherPlace.id,
    },
  };
  const agendaAtOther = buildAgenda(wAtOther);
  const dueAtOther = agendaAtOther.find(
    (t) => t.kind === 'appointment_due' && t.actorId === actor.id,
  );
  assert.ok(dueAtOther);
  assert.match(dueAtOther.detail, /主角尚未到达约定现场/);
  assert.match(dueAtOther.detail, /绝不能无端指责主角故意失约/);

  // 3. Proposed (unconfirmed) appointment past due stays quiet, does not become missed or due
  const wProposedPastDue = {
    ...w,
    appointments: [
      ...w.appointments,
      {
        id: randomUUID(),
        title: '未确认的聚餐邀请',
        at: new Date(Date.parse(w.time) - 3600000).toISOString(),
        status: 'proposed' as const,
        participantIds: [actor.id],
        sourceEventId: randomUUID(),
      },
    ],
  };
  const agendaProposed = buildAgenda(wProposedPastDue);
  assert.ok(!agendaProposed.some((t) => t.detail.includes('未确认的聚餐邀请')));
});

