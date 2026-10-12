import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planAppointmentWait,
  applyAppointmentWaitEvent,
  appointmentWaitReceipt,
  canonicalWaitInstant,
  type AppointmentWaitCommand,
  type AppointmentWaitEvent,
} from '../src/modules/world/domain/appointment-wait.ts';
import {
  AppointmentWaitRequestSchema,
  AppointmentWaitReceiptSchema,
  AppointmentWaitEventSchema,
} from '../src/contracts/appointment-wait.ts';
import { waitToAppointment } from '../src/modules/world/application/appointment-wait.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { WorldClock } from '../src/modules/world/domain/clock.ts';
const worldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  commandId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  seedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = '2026-10-12T10:00:00.000Z';
function world(): WorldState {
  const source = { kind: 'seed_genesis' as const, seedId, snapshotVersion: 0 as const };
  return {
    schemaVersion: 1,
    id: worldId,
    ownerId: 'local_owner',
    version: 0,
    title: '仅领域合成验证',
    time: '2026-10-16T08:20:00.000Z',
    actors: [],
    actorTies: [],
    facts: [],
    messages: [],
    notes: [
      {
        id: 'keep_note',
        title: '原便签',
        text: '等待不改原稿',
        version: 0,
        updatedAt: now,
        sourceEventId: 'genesis',
      },
    ],
    mediaRequests: [],
    appointments: [
      {
        id: 'confirmed_friday',
        title: '周五约定',
        at: '2026-10-16T19:30:00Z',
        participantIds: [],
        sourceEventId: 'genesis',
        status: 'confirmed',
        responseVersion: 0,
      },
    ],
    space: {
      currentPlaceId: 'shop',
      positionSource: source,
      places: [
        {
          id: 'shop',
          name: '约定地点',
          description: '真实场景中的地点',
          source,
          contactActorIds: [],
          appointmentIds: ['confirmed_friday'],
        },
        {
          id: 'other',
          name: '另一个地点',
          description: '别处',
          source,
          contactActorIds: [],
          appointmentIds: [],
        },
      ],
      routes: [
        {
          id: 'shop_other',
          fromPlaceId: 'shop',
          toPlaceId: 'other',
          durationMinutes: 20,
          modeLabel: '20分钟路线',
          source,
        },
      ],
    },
  };
}
function clock(w = world()): WorldClock {
  return {
    storyNow: w.time,
    lastTickAt: now,
    speed: 1,
    paused: false,
    missedBeats: 0,
    summary: null,
  };
}
function command(w = world()): AppointmentWaitCommand {
  return { commandId, worldId: w.id, expectedVersion: w.version, invitationId: 'confirmed_friday' };
}
function event(w = world()): AppointmentWaitEvent {
  const data = planAppointmentWait(w, command(w), { clock: clock(w), realNow: now });
  return {
    schemaVersion: 1,
    type: 'appointment.waited',
    id: eventId,
    worldId: w.id,
    commandId,
    version: w.version + 1,
    occurredAt: now,
    storyAt: data.toStoryAt,
    data,
  };
}
function block(w: WorldState, reason: string) {
  assert.throws(() => planAppointmentWait(w, command(w), { clock: clock(w), realNow: now }), {
    reason,
  });
}
test('arrival at 08:20 naturally waits to real confirmed Friday19:30 without pretending another20-minute journey', () => {
  const w = world(),
    e = event(w);
  assert.equal(e.data.fromStoryAt, w.time);
  assert.equal(e.storyAt, '2026-10-16T19:30:00.000Z');
  assert.equal(appointmentWaitReceipt(e).waitedMinutes, 670);
  assert.equal(w.space!.routes[0]!.durationMinutes, 20);
});
test('wait reducer advances only time/version, retaining confirmed invitation and all cast/data/place fields', () => {
  const w = world(),
    original = structuredClone(w),
    e = event(w),
    n = applyAppointmentWaitEvent(w, e);
  assert.deepEqual(n, { ...original, version: 1, time: e.storyAt });
  assert.deepEqual(w, original);
  assert.equal(n.appointments[0]!.status, 'confirmed');
  assert.equal(n.space!.currentPlaceId, 'shop');
  assert.equal(n.messages.length, 0);
});
test('public request rejects arbitrary timestamp, speed, minutes, owner, place and client-approved flags', () => {
  const input = { commandId, expectedVersion: 0, invitationId: 'confirmed_friday' };
  assert.ok(AppointmentWaitRequestSchema.safeParse(input).success);
  for (const field of ['at', 'speed', 'minutes', 'ownerId', 'placeId', 'approved'])
    assert.equal(
      AppointmentWaitRequestSchema.safeParse({ ...input, [field]: 'arbitrary' }).success,
      false,
    );
});
test('event and derived original receipt match strict frozen public structures', () => {
  const e = event();
  assert.ok(AppointmentWaitEventSchema.safeParse(e).success);
  assert.ok(AppointmentWaitReceiptSchema.safeParse(appointmentWaitReceipt(e)).success);
  assert.equal(
    AppointmentWaitEventSchema.safeParse({ ...e, type: 'travel.completed' }).success,
    false,
  );
});
test('paused world and active scene are rejected rather than silently resumed or left', () => {
  const w = world();
  assert.throws(
    () =>
      planAppointmentWait(w, command(w), { clock: { ...clock(w), paused: true }, realNow: now }),
    { reason: 'PAUSED' },
  );
  assert.throws(
    () =>
      planAppointmentWait(w, command(w), {
        clock: clock(w),
        realNow: now,
        currentSceneId: eventId,
      }),
    { reason: 'ACTIVE_SCENE' },
  );
});
test('invitation must actually be confirmed; proposed/cancelled/attended/missed never qualify', () => {
  for (const status of ['proposed', 'cancelled', 'attended', 'missed'] as const) {
    const w = world();
    w.appointments[0]!.status = status;
    block(w, 'UNCONFIRMED');
  }
});
test('already due or past invitation must enter normally; waiting never runs backwards', () => {
  for (const at of ['2026-10-16T08:20:00.000Z', '2026-10-16T08:19:00.000Z']) {
    const w = world();
    w.appointments[0]!.at = at;
    block(w, 'ALREADY_DUE');
  }
});
test('unknown invitation and stale world version fail without changing state', () => {
  const w = world();
  assert.throws(
    () =>
      planAppointmentWait(
        w,
        { ...command(w), invitationId: 'foreign_invitation' },
        { clock: clock(w), realNow: now },
      ),
    { code: 'NOT_FOUND' },
  );
  assert.throws(
    () =>
      planAppointmentWait(
        w,
        { ...command(w), expectedVersion: 1 },
        { clock: clock(w), realNow: now },
      ),
    { code: 'VERSION_CONFLICT' },
  );
  assert.equal(w.version, 0);
});
test('being at another place or lacking a reliable venue mapping blocks wait', () => {
  let w = world();
  w.space!.currentPlaceId = 'other';
  block(w, 'NOT_AT_PLACE');
  w = world();
  w.space!.places[0]!.appointmentIds = [];
  block(w, 'NOT_AT_PLACE');
  w = world();
  delete w.space;
  block(w, 'NOT_AT_PLACE');
});
test('ambiguous venue mapping cannot guess one matching current place', () => {
  const w = world();
  w.space!.places[1]!.appointmentIds = ['confirmed_friday'];
  assert.throws(() => event(w));
});
test('earlier future confirmed appointment elsewhere blocks skipping it', () => {
  const w = world();
  w.appointments.push({
    id: 'earlier',
    title: '更早的真实确认约定',
    at: '2026-10-16T10:00:00.000Z',
    participantIds: [],
    sourceEventId: 'source',
    status: 'confirmed',
  });
  w.space!.places[1]!.appointmentIds = ['earlier'];
  block(w, 'EARLIER_APPOINTMENT');
});
test('an appointment due exactly now elsewhere is not silently missed', () => {
  const w = world();
  w.appointments.push({
    id: 'earlier',
    title: '此刻约定',
    at: w.time,
    participantIds: [],
    sourceEventId: 'source',
    status: 'confirmed',
  });
  w.space!.places[1]!.appointmentIds = ['earlier'];
  block(w, 'EARLIER_APPOINTMENT');
});
test('earlier confirmation with unknown venue is blocked without inventing a location', () => {
  const w = world();
  w.appointments.push({
    id: 'earlier',
    title: '地点未知',
    at: '2026-10-16T10:00:00.000Z',
    participantIds: [],
    sourceEventId: 'source',
    status: 'confirmed',
  });
  block(w, 'EARLIER_APPOINTMENT');
});
test('unaccepted optional invitation never locks waiting for a confirmed one', () => {
  const w = world();
  w.appointments.push({
    id: 'optional',
    title: '还未答应',
    at: '2026-10-16T10:00:00.000Z',
    participantIds: [],
    sourceEventId: 'source',
    status: 'proposed',
  });
  assert.ok(event(w));
});
test('earlier confirmed invitation at the same place does not fabricate attendance or block the allowed transition', () => {
  const w = world();
  w.appointments.push({
    id: 'earlier',
    title: '同地点',
    at: '2026-10-16T10:00:00.000Z',
    participantIds: [],
    sourceEventId: 'source',
    status: 'confirmed',
  });
  w.space!.places[0]!.appointmentIds.push('earlier');
  const n = applyAppointmentWaitEvent(w, event(w));
  assert.equal(n.appointments[1]!.status, 'confirmed');
});
test('past confirmed invitation elsewhere does not become silently missed or indefinitely lock later waits', () => {
  const w = world();
  w.appointments.push({
    id: 'old',
    title: '更早已过去',
    at: '2026-10-15T10:00:00.000Z',
    participantIds: [],
    sourceEventId: 'source',
    status: 'confirmed',
  });
  const n = applyAppointmentWaitEvent(w, event(w));
  assert.equal(n.appointments[1]!.status, 'confirmed');
});
test('effective starting time uses both world time and projected clock and anchors no added travel duration', () => {
  const w = world();
  const data = planAppointmentWait(w, command(w), {
    clock: {
      ...clock(w),
      storyNow: '2026-10-16T08:00:00.000Z',
      lastTickAt: '2026-10-12T09:00:00.000Z',
    },
    realNow: now,
  });
  assert.equal(data.fromStoryAt, '2026-10-16T09:00:00.000Z');
  const older = planAppointmentWait(w, command(w), {
    clock: { ...clock(w), storyNow: '2026-10-16T07:00:00.000Z' },
    realNow: now,
  });
  assert.equal(older.fromStoryAt, w.time);
});
test('cross-day waiting uses the actual Saturday invitation, without constructing an intervening story', () => {
  const w = world();
  w.appointments[0]!.at = '2026-10-17T10:00:00.000Z';
  const e = event(w);
  assert.notEqual(e.data.fromStoryAt.slice(0, 10), e.storyAt.slice(0, 10));
  assert.equal(e.storyAt, w.appointments[0]!.at);
  assert.equal(applyAppointmentWaitEvent(w, e).facts.length, 0);
});
test('runtime timestamps are canonical, valid leap days work and impossible dates are refused', () => {
  assert.equal(canonicalWaitInstant('2028-02-29T10:00Z'), '2028-02-29T10:00:00.000Z');
  for (const t of [
    '2026-02-29T10:00:00Z',
    '2026-02-30T10:00:00Z',
    '2026-10-16T24:00:00Z',
    'arbitrary',
  ])
    assert.throws(() => canonicalWaitInstant(t));
});
test('history reducer refuses changed target time, response version, place, source instant or another world', () => {
  const w = world(),
    e = event(w);
  for (const data of [
    { ...e.data, toStoryAt: '2026-10-18T10:00:00.000Z' },
    { ...e.data, invitationResponseVersion: 8 },
    { ...e.data, placeId: 'other' },
    { ...e.data, fromStoryAt: '2026-10-16T08:19:00.000Z' },
  ])
    assert.throws(() => applyAppointmentWaitEvent(w, { ...e, data }));
  assert.throws(() => applyAppointmentWaitEvent(w, { ...e, worldId: seedId }));
});
test('an invitation rescheduled after the wait source was produced invalidates this event', () => {
  const w = world(),
    e = event(w);
  w.appointments[0]!.at = '2026-10-18T10:00:00.000Z';
  w.appointments[0]!.responseVersion = 1;
  assert.throws(() => applyAppointmentWaitEvent(w, e));
});
test('replaying a wait twice as a fresh event refuses duplicate time/version advance', () => {
  const w = world(),
    e = event(w),
    n = applyAppointmentWaitEvent(w, e);
  assert.throws(() => applyAppointmentWaitEvent(n, e), { code: 'VERSION_CONFLICT' });
  assert.deepEqual(appointmentWaitReceipt(e), appointmentWaitReceipt(e));
});
test('application delegates once to its production port without running a planner, clock control or scene entry', async () => {
  let calls = 0;
  const e = event(),
    input = { commandId, expectedVersion: 0, invitationId: 'confirmed_friday' };
  const r = await waitToAppointment(
    {
      async wait(owner, id, body) {
        calls++;
        assert.equal(owner, 'local_owner');
        assert.equal(id, worldId);
        assert.deepEqual(body, input);
        return appointmentWaitReceipt(e);
      },
    },
    'local_owner',
    worldId,
    input,
  );
  assert.equal(calls, 1);
  assert.deepEqual(r, appointmentWaitReceipt(e));
});
