import test from 'node:test';
import assert from 'node:assert/strict';
import {
  committedAwarenessDelta,
  awarenessLocalTime,
  type CommittedAwarenessEvent,
} from '../src/modules/world/domain/world-awareness.ts';
import type {
  AgentJourney,
  AgentArrivalReceipt,
} from '../src/modules/world/domain/agent-travel.ts';
import {
  emptyActorAgentState,
  type AgentAction,
  type AgentActionResult,
  type AgentProposal,
} from '../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { SceneSession } from '../src/modules/world/domain/experience-rules.ts';
const departedAt = '2026-10-15T10:00:00.000Z',
  dueAt = '2026-10-15T10:15:00.000Z';
function fixture() {
  const source = { kind: 'seed_genesis' as const, seedId: 'seed', snapshotVersion: 0 as const };
  const route = {
    id: 'route',
    fromPlaceId: 'shop',
    toPlaceId: 'park',
    durationMinutes: 15,
    modeLabel: '步行',
    source,
  };
  const world: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'owner',
    title: 'Synthetic projection',
    version: 4,
    time: departedAt,
    actors: ['a', 'b'].map((id) => ({ id, name: id, persona: id })),
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    space: {
      places: ['shop', 'park'].map((id) => ({
        id,
        name: id,
        description: '',
        source,
        contactActorIds: ['b'],
        appointmentIds: [],
      })),
      routes: [route],
      currentPlaceId: 'shop',
      positionSource: source,
    },
  };
  const action: AgentAction = {
    id: 'begin',
    goalId: 'goal',
    capability: 'travel.begin',
    parameters: { routeId: 'route' },
    targetIds: [],
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: [],
    status: 'succeeded',
    resultId: 'result',
  };
  const result: AgentActionResult = {
    worldId: 'w',
    actorId: 'a',
    id: 'result',
    actionId: 'begin',
    eventId: 'departure',
    worldVersion: 4,
    at: departedAt,
    outcome: 'succeeded',
    handledResponsibilityIds: [],
    evidenceSourceIds: ['origin'],
  };
  const journey: AgentJourney = {
    id: 'j',
    worldId: 'w',
    actorId: 'a',
    status: 'in_transit',
    revision: 0,
    beginActionId: 'begin',
    preparedAtVersion: 3,
    origin: {
      worldId: 'w',
      subject: { kind: 'actor', actorId: 'a' },
      status: 'at',
      placeId: 'shop',
      sourceEventId: 'origin',
      worldVersion: 1,
      occurredAt: '2026-10-15T09:00:00.000Z',
    },
    route,
    departedAt,
    plannedArrivalAt: dueAt,
    departure: {
      worldId: result.worldId,
      actorId: result.actorId,
      id: result.id,
      actionId: result.actionId,
      eventId: result.eventId,
      worldVersion: result.worldVersion,
      at: result.at,
      outcome: 'succeeded',
    },
    departureLocalTime: awarenessLocalTime(departedAt),
    plannedArrivalLocalTime: awarenessLocalTime(dueAt),
  };
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 3);
  state.revision = 1;
  state.projectedWorldVersion = 4;
  state.actions = [action];
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [{ ...action, status: 'proposed' }],
    responsibilities: [],
    decisions: [],
  };
  const runtime = { stateAfter: state, proposal, results: [result], departures: [journey] };
  const event: CommittedAwarenessEvent = {
    id: 'departure',
    worldId: 'w',
    commandId: 'begin_command',
    version: 4,
    occurredAt: '2026-10-15T01:00:00.000Z',
    storyAt: departedAt,
    type: 'agent.state_committed',
    data: { actorId: 'a', agentRuntime: runtime },
  };
  return { world, event, journey, runtime, result, state, route };
}
function arrivalFixture(at = dueAt) {
  const f = fixture();
  f.world.version = 7;
  f.world.time = at;
  const arrival: AgentArrivalReceipt = {
    worldId: 'w',
    actorId: 'a',
    id: 'arrival_receipt',
    commandId: 'arrival_j',
    eventId: 'arrival_event',
    worldVersion: 7,
    at,
    journeyId: 'j',
  };
  const event: CommittedAwarenessEvent = {
    id: arrival.eventId,
    worldId: 'w',
    commandId: arrival.commandId,
    version: 7,
    occurredAt: '2026-10-15T01:00:01.000Z',
    storyAt: at,
    type: 'agent.arrival_committed',
    data: {
      actorId: 'a',
      journeyId: 'j',
      departureEventId: 'departure',
      route: structuredClone(f.route),
      arrival,
    },
  };
  return {
    ...f,
    event,
    arrival,
    data: event.data as {
      actorId: string;
      journeyId: string;
      departureEventId: string;
      route: typeof f.route;
      arrival: AgentArrivalReceipt;
    },
  };
}
function scene(): SceneSession {
  return {
    id: 'scene',
    worldId: 'w',
    ownerId: 'owner',
    title: '小店现场',
    status: 'active',
    placeId: 'shop',
    sourceEventId: 'scene_open',
    sourceVersion: 1,
    presence: ['a', 'b'].map((actorId) => ({
      participant: { kind: 'actor' as const, actorId },
      joinedVersion: 1,
      sourceEventId: 'scene_open',
      sourceVersion: 1,
    })),
  };
}

test('certified departure projects only own actual in-transit position and actual pending evidence', () => {
  const f = fixture();
  const delta = committedAwarenessDelta(f.world, f.event, { scene: scene() });
  assert.deepEqual(delta.positions, [
    {
      worldId: 'w',
      subject: { kind: 'actor', actorId: 'a' },
      status: 'in_transit',
      placeId: null,
      sourceEventId: 'departure',
      worldVersion: 4,
      occurredAt: departedAt,
    },
  ]);
  assert.deepEqual(delta.knowledge, []);
  assert.ok(delta.reasons.some((r) => r.kind === 'action_result' && r.ref.id === 'result'));
  assert.ok(delta.reasons.some((r) => r.kind === 'new_condition'));
  assert.equal(f.world.space!.currentPlaceId, 'shop');
});
for (const type of ['turn.resolved', 'group.turn_resolved', 'scene.reaction_recorded'])
  test('same certified movement works in ' + type, () => {
    const f = fixture();
    f.event.type = type;
    assert.equal(committedAwarenessDelta(f.world, f.event).positions[0]?.status, 'in_transit');
  });
test('dialogue, an intent and even a success result without a certified departure do not move anyone', () => {
  const f = fixture();
  delete (f.runtime as Partial<typeof f.runtime>).departures;
  Object.assign(f.event.data as object, {
    userText: '我已经到了公园',
    travelPlan: { routeId: 'route', status: 'planned' },
  });
  assert.deepEqual(committedAwarenessDelta(f.world, f.event).positions, []);
  f.runtime.departures = [];
  assert.deepEqual(committedAwarenessDelta(f.world, f.event).positions, []);
});
const badDeparture: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
  [
    'wrong world',
    (f) => {
      (f.journey as { worldId: string }).worldId = 'foreign';
    },
  ],
  [
    'unknown actor',
    (f) => {
      (f.journey as { actorId: string }).actorId = 'unknown';
    },
  ],
  [
    'planned rather than actual',
    (f) => {
      Object.assign(f.journey, { status: 'planned' });
    },
  ],
  [
    'wrong revision',
    (f) => {
      Object.assign(f.journey, { revision: 1 });
    },
  ],
  [
    'unexpected arrival data',
    (f) => {
      Object.assign(f.journey, { arrival: null });
    },
  ],
  [
    'failed result',
    (f) => {
      f.result.outcome = 'failed';
    },
  ],
  [
    'missing result',
    (f) => {
      f.runtime.results = [];
    },
  ],
  [
    'duplicate result',
    (f) => {
      f.runtime.results.push(structuredClone(f.result));
    },
  ],
  [
    'wrong result event',
    (f) => {
      f.result.eventId = 'unrelated';
    },
  ],
  [
    'wrong action result',
    (f) => {
      f.state.actions[0]!.resultId = 'other';
    },
  ],
  [
    'nontravel state action',
    (f) => {
      f.state.actions[0]!.capability = 'plan.record';
    },
  ],
  [
    'nontravel proposed action',
    (f) => {
      f.runtime.proposal.actions[0]!.capability = 'plan.record';
    },
  ],
  [
    'wrong route parameter',
    (f) => {
      f.state.actions[0]!.parameters.routeId = 'unavailable';
    },
  ],
  [
    'unmatched existing route',
    (f) => {
      f.world.space!.routes = [];
    },
  ],
  [
    'bad duration',
    (f) => {
      f.journey.route.durationMinutes = 0;
    },
  ],
  [
    'invented ETA',
    (f) => {
      Object.assign(f.journey, { plannedArrivalAt: departedAt });
    },
  ],
  [
    'unknown origin',
    (f) => {
      f.journey.origin.status = 'unknown';
    },
  ],
  [
    'player origin',
    (f) => {
      f.journey.origin.subject = { kind: 'player' };
    },
  ],
  [
    'future origin',
    (f) => {
      f.journey.origin.worldVersion = 4;
    },
  ],
  [
    'unproven origin',
    (f) => {
      f.journey.origin.sourceEventId = '';
    },
  ],
  [
    'future origin time',
    (f) => {
      f.journey.origin.occurredAt = dueAt;
    },
  ],
  [
    'mismatched departure time',
    (f) => {
      f.event.storyAt = dueAt;
    },
  ],
  [
    'ambiguous duplicate journey',
    (f) => {
      f.runtime.departures.push(structuredClone(f.journey));
    },
  ],
  [
    'unsafe journey id',
    (f) => {
      Object.assign(f.journey, { id: 'bad:id' });
    },
  ],
  [
    'wrong runtime event type',
    (f) => {
      f.event.type = 'scene.action_resolved';
    },
  ],
];
for (const [label, mutate] of badDeparture)
  test('reject departure: ' + label, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => committedAwarenessDelta(f.world, f.event), /INVALID_AWARENESS/);
  });

test('arrival projects own at-position with independent event/receipt, never fabricated action/attendance', () => {
  const f = arrivalFixture();
  const delta = committedAwarenessDelta(f.world, f.event, { journey: f.journey, scene: scene() });
  assert.deepEqual(delta.positions, [
    {
      worldId: 'w',
      subject: { kind: 'actor', actorId: 'a' },
      status: 'at',
      placeId: 'park',
      sourceEventId: 'arrival_event',
      worldVersion: 7,
      occurredAt: dueAt,
    },
  ]);
  assert.deepEqual(delta.knowledge, []);
  assert.deepEqual(
    delta.reasons.map((r) => r.kind),
    ['new_condition'],
  );
  assert.equal(f.world.space!.currentPlaceId, 'shop');
});
test('arrival may use the exact already-CAS arrived ledger, and replay yields the same projection', () => {
  const f = arrivalFixture();
  const journey: AgentJourney = {
    ...f.journey,
    status: 'arrived',
    revision: 1,
    arrival: structuredClone(f.arrival),
  };
  const first = committedAwarenessDelta(f.world, f.event, { journey });
  assert.deepEqual(first, committedAwarenessDelta(f.world, f.event, { journey }));
  assert.deepEqual(first, committedAwarenessDelta(f.world, f.event, { journey: f.journey }));
});
test('late physical settlement keeps actual current world time even when old purpose is withdrawn', () => {
  const at = '2026-10-15T11:00:00.000Z',
    f = arrivalFixture(at);
  const previous = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 4);
  previous.goals = [
    { id: 'goal', summary: '已经不想参加', status: 'withdrawn', sourceIds: [], resultIds: [] },
  ];
  const delta = committedAwarenessDelta(f.world, f.event, {
    journey: f.journey,
    previousAgentState: previous,
  });
  assert.equal(delta.positions[0]!.occurredAt, at);
  assert.equal(f.journey.plannedArrivalAt, dueAt);
  assert.equal(
    delta.reasons.some((r) => r.kind === 'action_result'),
    false,
  );
  assert.equal(previous.goals[0]!.status, 'withdrawn');
});
test('arrival honors pinned old route, not later route duration; JSON order is irrelevant', () => {
  const f = arrivalFixture();
  f.world.space!.routes[0] = { ...f.world.space!.routes[0]!, durationMinutes: 30 };
  f.data.route = {
    source: f.route.source,
    modeLabel: '步行',
    durationMinutes: 15,
    toPlaceId: 'park',
    fromPlaceId: 'shop',
    id: 'route',
  };
  assert.equal(
    committedAwarenessDelta(f.world, f.event, { journey: f.journey }).positions[0]!.placeId,
    'park',
  );
});
test('arrival without original trusted ledger cannot manufacture a physical fact', () => {
  const f = arrivalFixture();
  assert.throws(() => committedAwarenessDelta(f.world, f.event), /INVALID_AWARENESS_JOURNEY/);
});
test('malformed arrival data or an empty actual event identity fails instead of silently projecting nothing', () => {
  for (const data of [null, [], 'NPC says arrived']) {
    const f = arrivalFixture();
    f.event.data = data;
    assert.throws(
      () => committedAwarenessDelta(f.world, f.event, { journey: f.journey }),
      /INVALID_AWARENESS/,
    );
  }
  const f = arrivalFixture();
  f.event.id = '';
  Object.assign(f.arrival, { eventId: '' });
  assert.throws(
    () => committedAwarenessDelta(f.world, f.event, { journey: f.journey }),
    /INVALID_AWARENESS/,
  );
});
const badArrival: Array<[string, (f: ReturnType<typeof arrivalFixture>) => void]> = [
  [
    'different actor',
    (f) => {
      f.data.actorId = 'b';
    },
  ],
  [
    'different journey',
    (f) => {
      f.data.journeyId = 'other';
    },
  ],
  [
    'different departure source',
    (f) => {
      f.data.departureEventId = 'wrong';
    },
  ],
  [
    'different pinned route',
    (f) => {
      f.data.route = { ...f.data.route, toPlaceId: 'shop' };
    },
  ],
  [
    'different receipt event',
    (f) => {
      Object.assign(f.arrival, { eventId: 'wrong' });
    },
  ],
  [
    'different receipt version',
    (f) => {
      Object.assign(f.arrival, { worldVersion: 6 });
    },
  ],
  [
    'different receipt world',
    (f) => {
      Object.assign(f.arrival, { worldId: 'foreign' });
    },
  ],
  [
    'different receipt actor',
    (f) => {
      Object.assign(f.arrival, { actorId: 'b' });
    },
  ],
  [
    'reused departure receipt',
    (f) => {
      Object.assign(f.arrival, { id: 'result' });
    },
  ],
  [
    'reused departure event',
    (f) => {
      f.event.id = 'departure';
      Object.assign(f.arrival, { eventId: 'departure' });
    },
  ],
  [
    'unsafe/stale arrival command',
    (f) => {
      f.event.commandId = 'journey:j:arrival';
      Object.assign(f.arrival, { commandId: f.event.commandId });
    },
  ],
  [
    'earlier than ETA',
    (f) => {
      f.event.storyAt = '2026-10-15T10:14:59.999Z';
      Object.assign(f.arrival, { at: f.event.storyAt });
    },
  ],
  [
    'backdated receipt',
    (f) => {
      Object.assign(f.arrival, { at: departedAt });
    },
  ],
  [
    'unknown endpoint',
    (f) => {
      f.world.space!.places = f.world.space!.places.filter((p) => p.id !== 'park');
    },
  ],
  [
    'untrusted observer list',
    (f) => {
      Object.assign(f.data, { observerActorIds: ['b'] });
    },
  ],
  [
    'foreign ledger',
    (f) => {
      Object.assign(f.journey, { worldId: 'foreign' });
    },
  ],
  [
    'ledger is still merely planned',
    (f) => {
      Object.assign(f.journey, { status: 'planned' });
    },
  ],
  [
    'different completed receipt',
    (f) => {
      Object.assign(f.journey, {
        status: 'arrived',
        revision: 1,
        arrival: { ...f.arrival, id: 'other_arrival' },
      });
    },
  ],
  [
    'missing timezone',
    (f) => {
      Object.assign(f.arrival, { at: '2026-10-15T10:15:00' });
    },
  ],
];
for (const [label, mutate] of badArrival)
  test('reject arrival: ' + label, () => {
    const f = arrivalFixture();
    mutate(f);
    assert.throws(
      () => committedAwarenessDelta(f.world, f.event, { journey: f.journey }),
      /INVALID_AWARENESS/,
    );
  });

test('canonical scene closure prevents a later scene event from resurrecting a departed NPC', () => {
  const f = fixture(),
    room = scene();
  room.presence[0]!.leftVersion = 4;
  f.world.version = 5;
  f.world.time = '2026-10-15T10:01:00.000Z';
  const later: CommittedAwarenessEvent = {
    id: 'scene_after_departure',
    worldId: 'w',
    commandId: 'scene_command',
    version: 5,
    occurredAt: f.world.time,
    storyAt: f.world.time,
    type: 'scene.action_resolved',
    data: { sceneId: 'scene' },
  };
  const delta = committedAwarenessDelta(f.world, later, { scene: room });
  assert.equal(
    delta.positions.some((p) => p.subject.kind === 'actor' && p.subject.actorId === 'a'),
    false,
  );
  assert.ok(delta.positions.some((p) => p.subject.kind === 'actor' && p.subject.actorId === 'b'));
});
test('inputs remain immutable and a claimed watcher roster grants no NPC movement knowledge', () => {
  const f = fixture();
  Object.assign(f.event.data as object, {
    sceneId: 'scene',
    observerActorIds: ['a', 'b'],
    departureObservation: { visibility: { kind: 'actors', actorIds: ['b'] } },
  });
  const before = JSON.stringify(f);
  const delta = committedAwarenessDelta(f.world, f.event, { scene: scene() });
  assert.equal(JSON.stringify(f), before);
  assert.deepEqual(delta.knowledge, []);
});
