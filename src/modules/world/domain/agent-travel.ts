import type { AgentActionResult } from './agent-runtime.ts';
import type { SpaceRoute } from './space.ts';
import type { AuthoritativePosition, WorldBoundary } from './world-awareness.ts';
import { awarenessLocalTime } from './world-awareness.ts';
import { worldDateTimeInput } from './display-time.ts';

/** Server-resolved world time/version. No player position, wall clock or NPC self-report. */
export type TravelFrame = Readonly<{
  worldId: string;
  actorId: string;
  worldVersion: number;
  storyAt: string;
}>;
export type AgentTravelIntent = Readonly<{
  journeyId: string;
  actionId: string;
  routeId: string;
}>;
type JourneyBasis = Readonly<{
  id: string;
  worldId: string;
  actorId: string;
  beginActionId: string;
  preparedAtVersion: number;
  origin: AuthoritativePosition;
  /** Existing route pinned at departure, not a newly generated path. */
  route: SpaceRoute;
  departedAt: string;
  plannedArrivalAt: string;
  departureLocalTime: ReturnType<typeof awarenessLocalTime>;
  plannedArrivalLocalTime: ReturnType<typeof awarenessLocalTime>;
}>;
/** A proposal only: this object alone never establishes actual movement. */
export type AgentTravelPlan = JourneyBasis & { readonly status: 'planned' };
export type AgentDepartureReceipt = Readonly<
  Pick<
    AgentActionResult,
    'worldId' | 'actorId' | 'id' | 'actionId' | 'eventId' | 'worldVersion' | 'at'
  > & {
    outcome: 'succeeded';
  }
>;
/** Dedicated physical continuation receipt, NOT a goal-bound model action/result. */
export type AgentArrivalReceipt = Readonly<{
  worldId: string;
  actorId: string;
  id: string;
  commandId: string;
  eventId: string;
  worldVersion: number;
  at: string;
  journeyId: string;
}>;
export type AgentJourney = JourneyBasis &
  Readonly<
    { departure: AgentDepartureReceipt } & (
      | { status: 'in_transit'; revision: 0 }
      | { status: 'arrived'; revision: 1; arrival: AgentArrivalReceipt }
    )
  >;
/** Server-only invocation; never advertise this as a model capability. */
export type AgentArrivalContinuation = Readonly<{
  commandId: string;
  frame: TravelFrame;
  journey: AgentJourney & { status: 'in_transit'; revision: 0 };
}>;
export type AgentTravelReason =
  | 'invalid_frame'
  | 'invalid_intent'
  | 'outside_boundary'
  | 'missing_origin'
  | 'invalid_origin'
  | 'origin_in_transit'
  | 'missing_route'
  | 'invalid_route'
  | 'origin_route_mismatch'
  | 'invalid_ledger'
  | 'duplicate_journey'
  | 'duplicate_action'
  | 'active_journey'
  | 'invalid_plan'
  | 'invalid_journey'
  | 'position_mismatch'
  | 'invalid_receipt';
export type AgentTravelRejection = Readonly<{
  status: 'missing' | 'unsupported' | 'blocked';
  reason: AgentTravelReason;
}>;

const reject = (
  reason: AgentTravelReason,
  status: AgentTravelRejection['status'] = 'blocked',
): AgentTravelRejection => ({ status, reason });
const id = (value: string) => typeof value === 'string' && !!value.trim();
const journeyIdValid = (value: string) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,56}$/.test(value);
const version = (value: number) => Number.isSafeInteger(value) && value > 0;
/** Reuse the existing explicit-offset/calendar validation; normalize to UTC milliseconds. */
function instant(value: string): number {
  return worldDateTimeInput(value) ? Date.parse(value) : NaN;
}
const iso = (value: string) => new Date(instant(value)).toISOString();
function frameValid(frame: TravelFrame): boolean {
  return (
    id(frame.worldId) &&
    id(frame.actorId) &&
    version(frame.worldVersion) &&
    Number.isFinite(instant(frame.storyAt))
  );
}
function routeValid(route: SpaceRoute, worldVersion: number): boolean {
  const source = route.source;
  if (!source || source.snapshotVersion !== 0) return false;
  const provenance =
    (source.kind === 'system_policy' && source.policy === 'default_travel_v1') ||
    (source.kind === 'official_genesis' && id(source.presetId) && version(source.contentVersion)) ||
    (source.kind === 'seed_genesis' && id(source.seedId)) ||
    (source.kind === 'world_event' &&
      id(source.eventId) &&
      version(source.eventVersion) &&
      source.eventVersion <= worldVersion);
  return (
    !!provenance &&
    id(route.id) &&
    id(route.fromPlaceId) &&
    id(route.toPlaceId) &&
    route.fromPlaceId !== route.toPlaceId &&
    id(route.modeLabel) &&
    Number.isInteger(route.durationMinutes) &&
    route.durationMinutes >= 1 &&
    route.durationMinutes <= 120
  );
}
function ownPositionValid(position: AuthoritativePosition, frame: TravelFrame): boolean {
  return (
    position.worldId === frame.worldId &&
    position.subject.kind === 'actor' &&
    position.subject.actorId === frame.actorId &&
    id(position.sourceEventId) &&
    version(position.worldVersion) &&
    position.worldVersion <= frame.worldVersion &&
    Number.isFinite(instant(position.occurredAt)) &&
    instant(position.occurredAt) <= instant(frame.storyAt)
  );
}
/** Freeze detached, whitelisted outputs; never freeze or mutate caller-owned objects. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function positionCopy(value: AuthoritativePosition): AuthoritativePosition {
  return {
    worldId: value.worldId,
    subject:
      value.subject.kind === 'actor'
        ? { kind: 'actor', actorId: value.subject.actorId }
        : { kind: 'player' },
    status: value.status,
    placeId: value.placeId,
    sourceEventId: value.sourceEventId,
    worldVersion: value.worldVersion,
    occurredAt: iso(value.occurredAt),
  };
}
function routeCopy(route: SpaceRoute): SpaceRoute {
  // SpaceSource is a finite flat union. Clone only that typed source, not an entire world snapshot.
  const source = route.source;
  const copy: SpaceRoute['source'] =
    source.kind === 'system_policy'
      ? { kind: source.kind, policy: source.policy, snapshotVersion: 0 }
      : source.kind === 'official_genesis'
        ? {
            kind: source.kind,
            presetId: source.presetId,
            contentVersion: source.contentVersion,
            snapshotVersion: 0,
          }
        : source.kind === 'seed_genesis'
          ? { kind: source.kind, seedId: source.seedId, snapshotVersion: 0 }
          : {
              kind: 'world_event',
              eventId: source.eventId,
              eventVersion: source.eventVersion,
              snapshotVersion: 0,
              ...(source.presetId !== undefined ? { presetId: source.presetId } : {}),
              ...(source.seedId !== undefined ? { seedId: source.seedId } : {}),
              ...(source.contentVersion !== undefined
                ? { contentVersion: source.contentVersion }
                : {}),
            };
  return {
    id: route.id,
    fromPlaceId: route.fromPlaceId,
    toPlaceId: route.toPlaceId,
    durationMinutes: route.durationMinutes,
    modeLabel: route.modeLabel,
    source: copy,
  };
}
function basisCopy(basis: JourneyBasis): JourneyBasis {
  return {
    id: basis.id,
    worldId: basis.worldId,
    actorId: basis.actorId,
    beginActionId: basis.beginActionId,
    preparedAtVersion: basis.preparedAtVersion,
    origin: positionCopy(basis.origin),
    route: routeCopy(basis.route),
    departedAt: iso(basis.departedAt),
    plannedArrivalAt: iso(basis.plannedArrivalAt),
    departureLocalTime: awarenessLocalTime(iso(basis.departedAt)),
    plannedArrivalLocalTime: awarenessLocalTime(iso(basis.plannedArrivalAt)),
  };
}
function basisValid(basis: JourneyBasis): boolean {
  const frame = {
    worldId: basis.worldId,
    actorId: basis.actorId,
    worldVersion: basis.preparedAtVersion,
    storyAt: basis.departedAt,
  };
  const arrival = instant(basis.plannedArrivalAt);
  return (
    frameValid(frame) &&
    journeyIdValid(basis.id) &&
    id(basis.beginActionId) &&
    basis.origin.status === 'at' &&
    ownPositionValid(basis.origin, frame) &&
    basis.origin.placeId === basis.route.fromPlaceId &&
    routeValid(basis.route, basis.preparedAtVersion) &&
    Number.isFinite(arrival) &&
    arrival === instant(basis.departedAt) + basis.route.durationMinutes * 60_000
  );
}
function departureValid(
  plan: JourneyBasis,
  receipt: AgentActionResult | AgentDepartureReceipt,
): boolean {
  return (
    receipt.outcome === 'succeeded' &&
    receipt.worldId === plan.worldId &&
    receipt.actorId === plan.actorId &&
    receipt.actionId === plan.beginActionId &&
    id(receipt.id) &&
    id(receipt.eventId) &&
    receipt.eventId !== plan.origin.sourceEventId &&
    receipt.worldVersion === plan.preparedAtVersion + 1 &&
    version(receipt.worldVersion) &&
    instant(receipt.at) === instant(plan.departedAt)
  );
}
function departureCopy(receipt: AgentActionResult | AgentDepartureReceipt): AgentDepartureReceipt {
  return {
    worldId: receipt.worldId,
    actorId: receipt.actorId,
    id: receipt.id,
    actionId: receipt.actionId,
    eventId: receipt.eventId,
    worldVersion: receipt.worldVersion,
    at: iso(receipt.at),
    outcome: 'succeeded',
  };
}
/** Stable across fresh world versions, never a model-generated action ID. */
export function agentArrivalCommandId(journeyId: string): string {
  if (!journeyIdValid(journeyId)) throw Error('INVALID_JOURNEY_ID');
  return `arrival_${journeyId}`;
}
function arrivalValid(journey: AgentJourney, receipt: AgentArrivalReceipt): boolean {
  return (
    receipt.worldId === journey.worldId &&
    receipt.actorId === journey.actorId &&
    receipt.journeyId === journey.id &&
    receipt.commandId === agentArrivalCommandId(journey.id) &&
    id(receipt.id) &&
    id(receipt.eventId) &&
    receipt.id !== journey.departure.id &&
    receipt.eventId !== journey.departure.eventId &&
    receipt.eventId !== journey.origin.sourceEventId &&
    version(receipt.worldVersion) &&
    receipt.worldVersion > journey.departure.worldVersion &&
    Number.isFinite(instant(receipt.at)) &&
    instant(receipt.at) >= instant(journey.plannedArrivalAt)
  );
}
function arrivalCopy(receipt: AgentArrivalReceipt): AgentArrivalReceipt {
  return {
    worldId: receipt.worldId,
    actorId: receipt.actorId,
    id: receipt.id,
    commandId: receipt.commandId,
    eventId: receipt.eventId,
    worldVersion: receipt.worldVersion,
    at: iso(receipt.at),
    journeyId: receipt.journeyId,
  };
}
function journeyValid(journey: AgentJourney): boolean {
  return (
    basisValid(journey) &&
    departureValid(journey, journey.departure) &&
    ((journey.status === 'in_transit' && journey.revision === 0) ||
      (journey.status === 'arrived' &&
        journey.revision === 1 &&
        arrivalValid(journey, journey.arrival)))
  );
}
function journeyCopy(journey: AgentJourney): AgentJourney {
  const base = { ...basisCopy(journey), departure: departureCopy(journey.departure) };
  return journey.status === 'in_transit'
    ? { ...base, status: 'in_transit', revision: 0 }
    : { ...base, status: 'arrived', revision: 1, arrival: arrivalCopy(journey.arrival) };
}

/**
 * Call AFTER normal kernel goal/action/source/access eligibility. This is not an executor.
 * Routes, origin and ledger must come from the same owner-scoped authoritative transaction.
 */
export function prepareAgentTravel(input: {
  frame: TravelFrame;
  boundary: WorldBoundary;
  ownPosition: AuthoritativePosition | null;
  routes: readonly SpaceRoute[];
  intent: AgentTravelIntent;
  existingJourneys: readonly AgentJourney[];
}): { status: 'ready'; plan: AgentTravelPlan } | AgentTravelRejection {
  const { frame, boundary, ownPosition, routes, intent, existingJourneys } = input;
  if (!frameValid(frame)) return reject('invalid_frame');
  if (!journeyIdValid(intent.journeyId) || ![intent.actionId, intent.routeId].every(id))
    return reject('invalid_intent');
  if (
    boundary.worldId !== frame.worldId ||
    boundary.extensionPermission !== 'none' ||
    !Number.isSafeInteger(boundary.createdFromVersion) ||
    boundary.createdFromVersion < 0 ||
    boundary.createdFromVersion > frame.worldVersion ||
    !boundary.actorIds.includes(frame.actorId)
  )
    return reject('outside_boundary', 'unsupported');
  if (
    existingJourneys.some(
      (j) =>
        j.worldId !== frame.worldId ||
        !journeyValid(j) ||
        j.departure.worldVersion > frame.worldVersion ||
        instant(j.departedAt) > instant(frame.storyAt) ||
        (j.status === 'arrived' &&
          (j.arrival.worldVersion > frame.worldVersion ||
            instant(j.arrival.at) > instant(frame.storyAt))),
    )
  )
    return reject('invalid_ledger');
  if (existingJourneys.some((j) => j.id === intent.journeyId)) return reject('duplicate_journey');
  if (
    existingJourneys.some((j) => j.actorId === frame.actorId && j.beginActionId === intent.actionId)
  )
    return reject('duplicate_action');
  if (existingJourneys.some((j) => j.actorId === frame.actorId && j.status === 'in_transit'))
    return reject('active_journey');
  if (!ownPosition || ownPosition.status === 'unknown') return reject('missing_origin', 'missing');
  if (!ownPositionValid(ownPosition, frame)) return reject('invalid_origin');
  if (ownPosition.status === 'in_transit') return reject('origin_in_transit');
  if (ownPosition.status !== 'at' || !ownPosition.placeId) return reject('invalid_origin');
  const matches = routes.filter((route) => route.id === intent.routeId);
  if (!matches.length) return reject('missing_route', 'unsupported');
  const route = matches[0]!;
  if (matches.length !== 1 || !routeValid(route, frame.worldVersion))
    return reject('invalid_route');
  if (
    !boundary.placeIds.includes(route.fromPlaceId) ||
    !boundary.placeIds.includes(route.toPlaceId)
  )
    return reject('outside_boundary', 'unsupported');
  if (ownPosition.placeId !== route.fromPlaceId) return reject('origin_route_mismatch');
  const departedAt = iso(frame.storyAt);
  const plannedArrivalAt = new Date(
    instant(departedAt) + route.durationMinutes * 60_000,
  ).toISOString();
  if (!Number.isFinite(instant(plannedArrivalAt))) return reject('invalid_route');
  const plan: AgentTravelPlan = {
    status: 'planned',
    id: intent.journeyId,
    worldId: frame.worldId,
    actorId: frame.actorId,
    beginActionId: intent.actionId,
    preparedAtVersion: frame.worldVersion,
    origin: positionCopy(ownPosition),
    route: routeCopy(route),
    departedAt,
    plannedArrivalAt,
    departureLocalTime: awarenessLocalTime(departedAt),
    plannedArrivalLocalTime: awarenessLocalTime(plannedArrivalAt),
  };
  return { status: 'ready', plan: freeze(plan) };
}

/**
 * Receipt must already be authenticated against the actual travel effect by the kernel/UoW.
 * Structure alone cannot prove SQL authenticity. Persist journey/position/event/result atomically,
 * enforcing unique journey ID, begin action and one active journey per actor in the database.
 */
export function commitAgentDeparture(
  plan: AgentTravelPlan,
  receipt: AgentActionResult,
): { status: 'in_transit'; journey: AgentJourney } | AgentTravelRejection {
  if (plan.status !== 'planned' || !basisValid(plan)) return reject('invalid_plan');
  if (!departureValid(plan, receipt)) return reject('invalid_receipt');
  return {
    status: 'in_transit',
    journey: freeze({
      ...basisCopy(plan),
      status: 'in_transit',
      revision: 0,
      departure: departureCopy(receipt),
    }),
  };
}

/** No goal/episode/appointment status: withdrawing a purpose cannot strand a started trip. */
export function evaluateAgentArrival(input: {
  frame: TravelFrame;
  journey: AgentJourney;
  ownPosition: AuthoritativePosition | null;
}):
  | { status: 'waiting'; dueAt: string }
  | { status: 'ready'; continuation: AgentArrivalContinuation }
  | { status: 'already_arrived'; journey: AgentJourney }
  | AgentTravelRejection {
  const { frame, journey, ownPosition } = input;
  if (!frameValid(frame)) return reject('invalid_frame');
  if (
    !journeyValid(journey) ||
    journey.worldId !== frame.worldId ||
    journey.actorId !== frame.actorId ||
    journey.departure.worldVersion > frame.worldVersion ||
    instant(journey.departedAt) > instant(frame.storyAt)
  )
    return reject('invalid_journey');
  if (journey.status === 'arrived') {
    if (
      journey.arrival.worldVersion > frame.worldVersion ||
      instant(journey.arrival.at) > instant(frame.storyAt)
    )
      return reject('invalid_journey');
    return { status: 'already_arrived', journey: freeze(journeyCopy(journey)) };
  }
  if (
    !ownPosition ||
    !ownPositionValid(ownPosition, frame) ||
    ownPosition.status !== 'in_transit' ||
    ownPosition.placeId !== null ||
    ownPosition.sourceEventId !== journey.departure.eventId ||
    ownPosition.worldVersion !== journey.departure.worldVersion ||
    instant(ownPosition.occurredAt) !== instant(journey.departedAt)
  )
    return reject('position_mismatch');
  if (instant(frame.storyAt) < instant(journey.plannedArrivalAt))
    return { status: 'waiting', dueAt: iso(journey.plannedArrivalAt) };
  return {
    status: 'ready',
    continuation: freeze({
      commandId: agentArrivalCommandId(journey.id),
      frame: {
        worldId: frame.worldId,
        actorId: frame.actorId,
        worldVersion: frame.worldVersion,
        storyAt: iso(frame.storyAt),
      },
      journey: {
        ...basisCopy(journey),
        status: 'in_transit',
        revision: 0,
        departure: departureCopy(journey.departure),
      },
    }),
  };
}

/** Commit only after a fresh same-transaction evaluation and authenticated continuation receipt. */
export function commitAgentArrival(
  continuation: AgentArrivalContinuation,
  receipt: AgentArrivalReceipt,
): { status: 'arrived'; journey: AgentJourney } | AgentTravelRejection {
  const { frame, journey } = continuation;
  if (
    !frameValid(frame) ||
    !journeyValid(journey) ||
    journey.status !== 'in_transit' ||
    journey.worldId !== frame.worldId ||
    journey.actorId !== frame.actorId ||
    frame.worldVersion < journey.departure.worldVersion ||
    instant(frame.storyAt) < instant(journey.plannedArrivalAt) ||
    continuation.commandId !== agentArrivalCommandId(journey.id)
  )
    return reject('invalid_journey');
  if (
    !arrivalValid(journey, receipt) ||
    receipt.worldVersion !== frame.worldVersion + 1 ||
    instant(receipt.at) !== instant(frame.storyAt)
  )
    return reject('invalid_receipt');
  return {
    status: 'arrived',
    journey: freeze({
      ...basisCopy(journey),
      status: 'arrived',
      revision: 1,
      departure: departureCopy(journey.departure),
      arrival: arrivalCopy(receipt),
    }),
  };
}
