import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareAgentTravel,
  commitAgentDeparture,
  evaluateAgentArrival,
  commitAgentArrival,
  agentArrivalCommandId,
  type AgentTravelPlan,
  type AgentJourney,
  type AgentArrivalContinuation,
  type AgentArrivalReceipt,
} from '../src/modules/world/domain/agent-travel.ts';
import {
  emptyActorAgentState,
  type AgentActionResult,
  type AgentProposal,
  type AgentAction,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  evaluateAgentActionEligibility,
  type AgentEligibilitySnapshot,
} from '../src/modules/world/domain/agent-eligibility.ts';

const departureAt = '2026-10-15T09:50:00.000Z';
const dueAt = '2026-10-15T10:05:00.000Z';
function fixture(): Parameters<typeof prepareAgentTravel>[0] {
  return {
    frame: { worldId: 'w', actorId: 'a', worldVersion: 4, storyAt: departureAt },
    boundary: {
      worldId: 'w',
      actorIds: ['a', 'b'],
      placeIds: ['shop', 'park'],
      capabilityIds: [],
      extensionPermission: 'none',
      createdFromVersion: 4,
      sourceEventId: 'boundary',
    },
    ownPosition: {
      worldId: 'w',
      subject: { kind: 'actor', actorId: 'a' },
      status: 'at',
      placeId: 'shop',
      sourceEventId: 'setup',
      worldVersion: 2,
      occurredAt: '2026-10-15T09:00:00Z',
    },
    routes: [
      {
        id: 'route',
        fromPlaceId: 'shop',
        toPlaceId: 'park',
        durationMinutes: 15,
        modeLabel: '步行',
        source: { kind: 'seed_genesis', seedId: 'seed', snapshotVersion: 0 },
      },
    ],
    intent: { journeyId: 'j', actionId: 'begin', routeId: 'route' },
    existingJourneys: [],
  };
}
function plan(input = fixture()): AgentTravelPlan {
  const result = prepareAgentTravel(input);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw Error('expected plan');
  return result.plan;
}
function departureReceipt(): AgentActionResult {
  return {
    worldId: 'w',
    actorId: 'a',
    id: 'departure_result',
    actionId: 'begin',
    eventId: 'departure_event',
    worldVersion: 5,
    at: departureAt,
    outcome: 'succeeded',
    handledResponsibilityIds: [],
    evidenceSourceIds: ['setup'],
  };
}
function started(): AgentJourney {
  const result = commitAgentDeparture(plan(), departureReceipt());
  assert.equal(result.status, 'in_transit');
  if (result.status !== 'in_transit') throw Error('expected departure');
  return result.journey;
}
function arrivalInput(at = dueAt): Parameters<typeof evaluateAgentArrival>[0] {
  return {
    frame: { worldId: 'w', actorId: 'a', worldVersion: 8, storyAt: at },
    journey: started(),
    ownPosition: {
      worldId: 'w',
      subject: { kind: 'actor', actorId: 'a' },
      status: 'in_transit',
      placeId: null,
      sourceEventId: 'departure_event',
      worldVersion: 5,
      occurredAt: departureAt,
    },
  };
}
function continuation(input = arrivalInput()): AgentArrivalContinuation {
  const result = evaluateAgentArrival(input);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw Error('expected continuation');
  return result.continuation;
}
function arrivalReceipt(): AgentArrivalReceipt {
  return {
    worldId: 'w',
    actorId: 'a',
    id: 'arrival_receipt',
    eventId: 'arrival_event',
    commandId: agentArrivalCommandId('j'),
    worldVersion: 9,
    at: dueAt,
    journeyId: 'j',
  };
}

test('travel distinguishes immutable plan, committed departure and independently committed arrival', () => {
  const p = plan();
  assert.equal(p.status, 'planned');
  assert.equal(p.plannedArrivalAt, dueAt);
  assert.equal(p.departureLocalTime.localDateTime, '2026-10-15T17:50:00');
  assert.equal(p.plannedArrivalLocalTime.localDateTime, '2026-10-15T18:05:00');
  assert.equal('departure' in p, false);
  const journey = started();
  assert.equal(journey.status, 'in_transit');
  assert.equal('arrival' in journey, false);
  const result = commitAgentArrival(continuation(), arrivalReceipt());
  assert.equal(result.status, 'arrived');
  if (result.status !== 'arrived') throw Error('expected arrival');
  assert.equal(result.journey.status, 'arrived');
  assert.equal(result.journey.departure.eventId, 'departure_event');
  assert.equal(
    result.journey.status === 'arrived' && result.journey.arrival.eventId,
    'arrival_event',
  );
});

test('missing origin and missing existing route return explicit non-execution dispositions', () => {
  const f = fixture();
  f.ownPosition = null;
  assert.deepEqual(prepareAgentTravel(f), { status: 'missing', reason: 'missing_origin' });
  f.ownPosition = { ...fixture().ownPosition!, status: 'unknown', placeId: null };
  assert.deepEqual(prepareAgentTravel(f), { status: 'missing', reason: 'missing_origin' });
  assert.deepEqual(prepareAgentTravel({ ...fixture(), routes: [] }), {
    status: 'unsupported',
    reason: 'missing_route',
  });
});

test('player actual position, foreign actor and future/unproven origin cannot start an NPC trip', () => {
  for (const patch of [
    { subject: { kind: 'player' as const } },
    { subject: { kind: 'actor' as const, actorId: 'b' } },
    { worldId: 'other' },
    { worldVersion: 0 },
    { worldVersion: 5 },
    { sourceEventId: '' },
    { occurredAt: '2026-10-15T09:51:00Z' },
    { occurredAt: '2026-10-15 09:00' },
  ]) {
    const f = fixture();
    f.ownPosition = { ...f.ownPosition!, ...patch };
    assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'invalid_origin' });
  }
});

test('at origin must match directed route exactly; no route inversion or contact/address inference', () => {
  const f = fixture();
  f.ownPosition!.placeId = 'park';
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'origin_route_mismatch' });
  f.ownPosition = { ...fixture().ownPosition!, status: 'in_transit', placeId: null };
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'origin_in_transit' });
});

test('finite actor and both place endpoints must already belong to the same boundary', () => {
  for (const patch of [
    { actorIds: ['b'] },
    { placeIds: ['shop'] },
    { worldId: 'other' },
    { createdFromVersion: 5 },
  ]) {
    const f = fixture();
    Object.assign(f.boundary, patch);
    assert.deepEqual(prepareAgentTravel(f), { status: 'unsupported', reason: 'outside_boundary' });
  }
});

test('route duration/provenance must be existing valid space data, never generated defaults', () => {
  for (const minutes of [0, -1, 0.5, 121, NaN, Infinity]) {
    const f = fixture();
    f.routes = [{ ...f.routes[0]!, durationMinutes: minutes }];
    assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'invalid_route' });
  }
  const f = fixture();
  f.routes = [
    {
      ...f.routes[0]!,
      source: { kind: 'world_event', eventId: 'future', eventVersion: 5, snapshotVersion: 0 },
    },
  ];
  assert.equal(prepareAgentTravel(f).status, 'blocked');
  f.routes = [...fixture().routes, ...fixture().routes];
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'invalid_route' });
});

test('frame requires explicit valid offset instant, not host timezone or calendar rollover', () => {
  for (const storyAt of [
    '2026-10-15T09:50:00',
    '2026-02-30T09:50:00Z',
    '2026-10-15T24:00Z',
    '2026-10-15T09:50+24:00',
  ]) {
    const f = fixture();
    f.frame = { ...f.frame, storyAt };
    assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'invalid_frame' });
  }
  const f = fixture();
  f.frame = { ...f.frame, storyAt: '2026-10-15T17:50:00.123456+08:00' };
  const p = plan(f);
  assert.equal(p.departedAt, '2026-10-15T09:50:00.123Z');
  assert.equal(p.plannedArrivalAt, '2026-10-15T10:05:00.123Z');
});

test('departure requires distinct matching successful actual receipt and next world version', () => {
  for (const patch of [
    { outcome: 'failed' as const },
    { actionId: 'other' },
    { worldId: 'other' },
    { actorId: 'b' },
    { id: '' },
    { eventId: 'setup' },
    { eventId: '' },
    { worldVersion: 4 },
    { worldVersion: 6 },
    { at: '2026-10-15T09:51:00Z' },
  ]) {
    assert.deepEqual(commitAgentDeparture(plan(), { ...departureReceipt(), ...patch }), {
      status: 'blocked',
      reason: 'invalid_receipt',
    });
  }
  const r = departureReceipt();
  r.at = '2026-10-15T17:50:00+08:00';
  assert.equal(commitAgentDeparture(plan(), r).status, 'in_transit');
});

test('tampered planned endpoint/time cannot be committed', () => {
  const p = structuredClone(plan());
  assert.deepEqual(
    commitAgentDeparture({ ...p, plannedArrivalAt: departureAt }, departureReceipt()),
    { status: 'blocked', reason: 'invalid_plan' },
  );
  p.route.fromPlaceId = 'park';
  assert.equal(commitAgentDeparture(p, departureReceipt()).status, 'blocked');
});

test('same journey, same own begin action and concurrent own journey cannot depart twice', () => {
  const f = fixture();
  f.frame = { ...f.frame, worldVersion: 5 };
  f.existingJourneys = [started()];
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'duplicate_journey' });
  f.intent = { ...f.intent, journeyId: 'next' };
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'duplicate_action' });
  f.intent = { ...f.intent, actionId: 'next_action' };
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'active_journey' });
});

test('arrival requires original actual in-transit proof, not speech/at-place/player location', () => {
  for (const patch of [
    { sourceEventId: 'npc_says_arrived' },
    { worldVersion: 6 },
    { worldId: 'other' },
    { occurredAt: '2026-10-15T09:51:00Z' },
    { status: 'at' as const, placeId: 'park' },
    { placeId: 'shop' },
    { subject: { kind: 'player' as const } },
    { subject: { kind: 'actor' as const, actorId: 'b' } },
  ]) {
    const f = arrivalInput();
    f.ownPosition = { ...f.ownPosition!, ...patch };
    assert.deepEqual(evaluateAgentArrival(f), { status: 'blocked', reason: 'position_mismatch' });
  }
  assert.deepEqual(evaluateAgentArrival({ ...arrivalInput(), ownPosition: null }), {
    status: 'blocked',
    reason: 'position_mismatch',
  });
});

test('arrival is not early; a due check still does not assert actual arrival', () => {
  assert.deepEqual(evaluateAgentArrival(arrivalInput('2026-10-15T10:04:59.999Z')), {
    status: 'waiting',
    dueAt,
  });
  const c = continuation();
  assert.equal(c.journey.status, 'in_transit');
  assert.equal('arrival' in c.journey, false);
  assert.equal(c.commandId, agentArrivalCommandId('j'));
});

test('late settlement uses actual current world time, never backdates to ETA', () => {
  const at = '2026-10-15T11:00:00Z';
  const c = continuation(arrivalInput(at));
  assert.equal(commitAgentArrival(c, arrivalReceipt()).status, 'blocked');
  const result = commitAgentArrival(c, { ...arrivalReceipt(), at });
  assert.equal(result.status, 'arrived');
  if (result.status !== 'arrived' || result.journey.status !== 'arrived')
    throw Error('expected arrival');
  assert.equal(result.journey.arrival.at, '2026-10-15T11:00:00.000Z');
  assert.equal(result.journey.plannedArrivalAt, dueAt);
});

test('arrival receipt cannot reuse departure, cross actor/journey or stale world frame', () => {
  for (const patch of [
    { id: 'departure_result' },
    { eventId: 'departure_event' },
    { journeyId: 'other' },
    { actorId: 'b' },
    { worldId: 'other' },
    { commandId: 'model_says_arrive' },
    { worldVersion: 8 },
    { worldVersion: 10 },
    { at: departureAt },
  ]) {
    assert.deepEqual(commitAgentArrival(continuation(), { ...arrivalReceipt(), ...patch }), {
      status: 'blocked',
      reason: 'invalid_receipt',
    });
  }
});

test('arrival certifies only physical settlement, not goal completion or appointment attendance', () => {
  const result = commitAgentArrival(continuation(), arrivalReceipt());
  assert.equal(result.status, 'arrived');
  if (result.status !== 'arrived') throw Error('expected arrival');
  assert.equal('completedGoalIds' in result.journey, false);
  assert.equal('appointment' in result.journey, false);
  assert.equal('currentPlaceId' in result.journey, false);
});

test('withdrawing a goal blocks a new ordinary action but not the already-started physical journey', () => {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 4);
  state.goals.push({
    id: 'goal',
    summary: '去公园',
    status: 'active',
    resultIds: [],
    sourceIds: [],
  });
  const action: AgentAction = {
    id: 'begin',
    goalId: 'goal',
    capability: 'actor.travel.begin',
    targetIds: [],
    parameters: { routeId: 'route' },
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    status: 'proposed',
    sourceIds: [],
  };
  const proposal: AgentProposal = {
    statements: [],
    goals: [],
    plans: [],
    actions: [action],
    responsibilities: [],
    decisions: [],
  };
  const snapshot: AgentEligibilitySnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 4,
    storyAt: departureAt,
    sources: [],
    observations: [],
    input: { sourceId: 'wake', text: '', origin: 'wake' },
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: [] },
  };
  assert.equal(
    evaluateAgentActionEligibility(snapshot, proposal, action, { storyAt: departureAt }).status,
    'ready',
  );
  const journey = started();
  state.goals[0]!.status = 'withdrawn';
  snapshot.viewState = structuredClone(state);
  const eligibility = evaluateAgentActionEligibility(snapshot, proposal, action, {
    storyAt: dueAt,
  });
  assert.equal(eligibility.status, 'blocked');
  assert.ok(eligibility.missing.some((item) => item.code === 'inactive_goal'));
  const result = evaluateAgentArrival({ ...arrivalInput(), journey });
  assert.equal(result.status, 'ready');
});

test('ledger entries from the future and arrival reusing an old origin event are rejected', () => {
  const f = fixture();
  f.existingJourneys = [started()];
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'invalid_ledger' });
  assert.deepEqual(commitAgentArrival(continuation(), { ...arrivalReceipt(), eventId: 'setup' }), {
    status: 'blocked',
    reason: 'invalid_receipt',
  });
});

test('persisted arrived journey replay is already_arrived, even after own position changes', () => {
  const committed = commitAgentArrival(continuation(), arrivalReceipt());
  if (committed.status !== 'arrived') throw Error('expected arrival');
  const f = arrivalInput();
  f.frame = { ...f.frame, worldVersion: 9 };
  f.journey = committed.journey;
  f.ownPosition = { ...fixture().ownPosition!, placeId: 'shop' };
  assert.equal(evaluateAgentArrival(f).status, 'already_arrived');
  f.frame = { ...f.frame, worldVersion: 8 };
  assert.equal(evaluateAgentArrival(f).status, 'blocked');
});

test('completed trip keeps dedupe history but permits a separately evidenced next trip', () => {
  const committed = commitAgentArrival(continuation(), arrivalReceipt());
  if (committed.status !== 'arrived') throw Error('expected arrival');
  const f = fixture();
  f.frame = { ...f.frame, worldVersion: 9, storyAt: dueAt };
  f.existingJourneys = [committed.journey];
  f.ownPosition = {
    ...f.ownPosition!,
    placeId: 'park',
    sourceEventId: 'arrival_event',
    worldVersion: 9,
    occurredAt: dueAt,
  };
  f.routes = [{ ...f.routes[0]!, id: 'return', fromPlaceId: 'park', toPlaceId: 'shop' }];
  f.intent = { journeyId: 'next_journey', actionId: 'next_begin', routeId: 'return' };
  assert.equal(prepareAgentTravel(f).status, 'ready');
  f.intent = { ...f.intent, journeyId: 'j' };
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'duplicate_journey' });
  f.intent = { ...f.intent, journeyId: 'next_journey', actionId: 'begin' };
  assert.deepEqual(prepareAgentTravel(f), { status: 'blocked', reason: 'duplicate_action' });
});

test('another actor in transit does not monopolize the world travel slot', () => {
  const other = structuredClone(started());
  Object.assign(other, { id: 'other_journey', actorId: 'b' });
  other.origin.subject = { kind: 'actor', actorId: 'b' };
  Object.assign(other.departure, { actorId: 'b' });
  const f = fixture();
  f.frame = { ...f.frame, worldVersion: 5 };
  f.existingJourneys = [other];
  assert.equal(prepareAgentTravel(f).status, 'ready');
});

test('fresh world frames keep stable continuation identity; elapsed wall time is not an input', () => {
  const a = continuation();
  const f = arrivalInput('2026-10-15T10:10:00Z');
  f.frame = { ...f.frame, worldVersion: 19 };
  const b = continuation(f);
  assert.equal(a.commandId, b.commandId);
  assert.equal(b.frame.worldVersion, 19);
  assert.equal(evaluateAgentArrival(arrivalInput(departureAt)).status, 'waiting');
  assert.equal(
    commitAgentArrival(b, { ...arrivalReceipt(), at: f.frame.storyAt, worldVersion: 20 }).status,
    'arrived',
  );
});

test('outputs are detached, recursively frozen and exclude extra runtime/player fields', () => {
  const f = fixture();
  Object.assign(f.routes[0]!, { playerActualPlaceId: 'secret' });
  Object.assign(f.ownPosition!, { goal: 'secret_goal' });
  const p = plan(f);
  assert.equal(JSON.stringify(p).includes('secret'), false);
  assert.ok(Object.isFrozen(p.route.source));
  f.ownPosition!.placeId = 'park';
  f.routes[0]!.durationMinutes = 90;
  assert.equal(p.origin.placeId, 'shop');
  assert.equal(p.route.durationMinutes, 15);
  assert.throws(() => {
    p.route.toPlaceId = 'elsewhere';
  }, TypeError);
  const c = continuation();
  assert.ok(Object.isFrozen(c.journey.departure));
});
