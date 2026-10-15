import type { WorldState } from './types.ts';
import type { ActorAgentState } from './agent-runtime.ts';
import type { SceneSession, Participant } from './experience-rules.ts';
import type { AgentJourney } from './agent-travel.ts';
import { NPC_AGENT_CAPABILITIES } from './agent-capabilities.ts';
import { worldDateTimeInput } from './display-time.ts';

export type AwarenessSubject = Participant;
export type WorldBoundary = {
  worldId: string;
  actorIds: string[];
  /** Already available map places only; not hidden author locations. */
  placeIds: string[];
  capabilityIds: string[];
  extensionPermission: 'none';
  createdFromVersion: number;
  sourceEventId: string | null;
};
export type AuthoritativePosition = {
  worldId: string;
  subject: AwarenessSubject;
  status: 'at' | 'in_transit' | 'unknown';
  placeId: string | null;
  sourceEventId: string;
  worldVersion: number;
  /** World time of the actual move/presence; never the projection wall-clock timestamp. */
  occurredAt: string;
};
export type ActorPositionKnowledge = {
  worldId: string;
  observerActorId: string;
  subject: AwarenessSubject;
  kind: 'at' | 'left' | 'absent' | 'report';
  placeId: string | null;
  sourceKind: 'direct' | 'player_report' | 'relayed' | 'inference';
  occurredAt: string | null;
  learnedAt: string;
  sourceEventId: string;
  worldVersion: number;
  /** Knowledge is a sourced observation, not a live location feed. */
  possiblyStale: true;
  evidence?: { inputReceiptId: string; quote: string };
};
export type DirectorPendingReason = {
  id: string;
  eventId: string;
  worldVersion: number;
  kind: 'player_decision' | 'plan_changed' | 'action_result' | 'new_condition' | 'cross_impact';
  ref:
    | { kind: 'event'; id: string }
    | { kind: 'decision' | 'plan' | 'action_result'; id: string; actorId: string };
};
export type DirectorObservedState = {
  worldId: string;
  observedThroughVersion: number;
  evaluatedThroughVersion: number;
  lastEvaluation: 'quiet' | 'acted' | null;
};
export type CommittedAwarenessEvent = {
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt?: string;
  type: string;
  data: unknown;
};
export type AwarenessDelta = {
  positions: AuthoritativePosition[];
  knowledge: ActorPositionKnowledge[];
  reasons: DirectorPendingReason[];
};
export function awarenessSubjectKey(subject: AwarenessSubject): string {
  return subject.kind === 'player' ? 'player' : `actor:${subject.actorId}`;
}
export function worldBoundary(
  world: WorldState,
  sourceEventId: string | null,
  capabilityIds: readonly string[] = NPC_AGENT_CAPABILITIES,
): WorldBoundary {
  return {
    worldId: world.id,
    actorIds: [...new Set(world.actors.map((actor) => actor.id))].sort(),
    placeIds: [...new Set(world.space?.places.map((place) => place.id) ?? [])].sort(),
    capabilityIds: [...new Set(capabilityIds)].sort(),
    extensionPermission: 'none',
    createdFromVersion: world.version,
    sourceEventId,
  };
}
/** All displayed story times use the phone's existing fixed UTC+08 policy. */
export function awarenessLocalTime(storyAt: string) {
  const time = Date.parse(storyAt);
  if (!Number.isFinite(time)) throw Error('INVALID_AWARENESS_TIME');
  return {
    storyAt: new Date(time).toISOString(),
    timeZone: 'UTC+08:00' as const,
    localDateTime: new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 19),
  };
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Deterministic projection of already committed, validated evidence. No speech parsing. */
export function committedAwarenessDelta(
  world: WorldState,
  event: CommittedAwarenessEvent,
  context: {
    previousAgentState?: ActorAgentState;
    scene?: SceneSession;
    /** Same-UoW authenticated original ledger row, never an NPC assertion. */
    journey?: AgentJourney;
  } = {},
): AwarenessDelta {
  const delta: AwarenessDelta = { positions: [], knowledge: [], reasons: [] };
  if (
    world.id !== event.worldId ||
    event.version > world.version ||
    event.version < 1 ||
    !Number.isSafeInteger(event.version) ||
    !instant(event.occurredAt)
  )
    throw Error('INVALID_AWARENESS_EVENT');
  const data = object(event.data);
  if (!data) {
    if (event.type === 'agent.arrival_committed') throw Error('INVALID_AWARENESS_ARRIVAL');
    return delta;
  }
  const actorIds = new Set(world.actors.map((actor) => actor.id));
  const placeIds = new Set(world.space?.places.map((place) => place.id) ?? []);
  const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
  const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const time = (value: unknown): number =>
    typeof value === 'string' && worldDateTimeInput(value) ? Date.parse(value) : NaN;
  // Compare JSON structure rather than property insertion order; no input object is mutated.
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b))
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => same(v, b[i]))
      );
    const left = object(a),
      right = object(b);
    return (
      !!left &&
      !!right &&
      Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
    );
  };
  const checkedJourney = (value: unknown): AgentJourney => {
    const j = object(value),
      origin = object(j?.origin),
      subject = object(origin?.subject),
      route = object(j?.route),
      source = object(route?.source),
      departure = object(j?.departure);
    if (!j || !origin || !subject || !route || !source || !departure)
      throw Error('INVALID_AWARENESS_JOURNEY');
    const validSource =
      source.snapshotVersion === 0 &&
      ((source.kind === 'system_policy' && source.policy === 'default_travel_v1') ||
        (source.kind === 'seed_genesis' && text(source.seedId)) ||
        (source.kind === 'official_genesis' &&
          text(source.presetId) &&
          positive(source.contentVersion)) ||
        (source.kind === 'world_event' &&
          text(source.eventId) &&
          positive(source.eventVersion) &&
          positive(j.preparedAtVersion) &&
          source.eventVersion <= j.preparedAtVersion));
    if (
      !text(j.id) ||
      !/^[a-zA-Z0-9_-]{1,56}$/.test(j.id) ||
      j.worldId !== world.id ||
      !text(j.actorId) ||
      !actorIds.has(j.actorId) ||
      !text(j.beginActionId) ||
      !positive(j.preparedAtVersion) ||
      origin.worldId !== world.id ||
      subject.kind !== 'actor' ||
      subject.actorId !== j.actorId ||
      origin.status !== 'at' ||
      !text(origin.sourceEventId) ||
      !positive(origin.worldVersion) ||
      origin.worldVersion > j.preparedAtVersion ||
      !Number.isFinite(time(origin.occurredAt)) ||
      !Number.isFinite(time(j.departedAt)) ||
      time(origin.occurredAt) > time(j.departedAt) ||
      !text(route.id) ||
      !text(route.modeLabel) ||
      !text(route.fromPlaceId) ||
      !text(route.toPlaceId) ||
      route.fromPlaceId === route.toPlaceId ||
      !placeIds.has(route.fromPlaceId) ||
      !placeIds.has(route.toPlaceId) ||
      origin.placeId !== route.fromPlaceId ||
      !positive(route.durationMinutes) ||
      route.durationMinutes > 120 ||
      !validSource ||
      !Number.isFinite(time(j.plannedArrivalAt)) ||
      time(j.plannedArrivalAt) !== time(j.departedAt) + route.durationMinutes * 60_000 ||
      departure.worldId !== world.id ||
      departure.actorId !== j.actorId ||
      departure.actionId !== j.beginActionId ||
      !text(departure.id) ||
      !text(departure.eventId) ||
      departure.eventId === origin.sourceEventId ||
      departure.outcome !== 'succeeded' ||
      departure.worldVersion !== j.preparedAtVersion + 1 ||
      time(departure.at) !== time(j.departedAt)
    )
      throw Error('INVALID_AWARENESS_JOURNEY');
    return value as AgentJourney;
  };
  const reason = (kind: DirectorPendingReason['kind'], ref: DirectorPendingReason['ref']) => {
    delta.reasons.push({
      id: `${event.id}:${kind}:${ref.id}`,
      eventId: event.id,
      worldVersion: event.version,
      kind,
      ref,
    });
  };
  const position = (subject: AwarenessSubject, placeId: string, at: string) => {
    delta.positions.push({
      worldId: world.id,
      subject,
      status: 'at',
      placeId,
      sourceEventId: event.id,
      worldVersion: event.version,
      occurredAt: new Date(at).toISOString(),
    });
  };
  if (event.type === 'travel.completed') {
    if (
      typeof data.fromPlaceId !== 'string' ||
      typeof data.toPlaceId !== 'string' ||
      !placeIds.has(data.fromPlaceId) ||
      !placeIds.has(data.toPlaceId) ||
      !instant(data.departedAt) ||
      !instant(data.arrivedAt) ||
      Date.parse(data.departedAt) > Date.parse(data.arrivedAt) ||
      event.storyAt !== data.arrivedAt
    )
      throw Error('INVALID_AWARENESS_TRAVEL');
    position({ kind: 'player' }, data.toPlaceId, data.arrivedAt);
    const observation = object(data.departureObservation);
    const visibility = object(observation?.visibility);
    if (observation) {
      const observers = visibility?.actorIds;
      if (
        observation.sourceEventId !== event.id ||
        observation.kind !== 'canonical' ||
        visibility?.kind !== 'actors' ||
        !Array.isArray(observers) ||
        !observers.length ||
        !data.leftSceneId ||
        observers.some((id) => typeof id !== 'string' || !actorIds.has(id))
      )
        throw Error('INVALID_AWARENESS_OBSERVERS');
      for (const observerActorId of new Set(observers as string[]))
        delta.knowledge.push({
          worldId: world.id,
          observerActorId,
          subject: { kind: 'player' },
          kind: 'left',
          placeId: data.fromPlaceId,
          sourceKind: 'direct',
          occurredAt: new Date(data.departedAt).toISOString(),
          learnedAt: new Date(data.departedAt).toISOString(),
          sourceEventId: event.id,
          worldVersion: event.version,
          possiblyStale: true,
        });
    }
    reason('new_condition', { kind: 'event', id: event.id });
  }
  if (event.type === 'agent.arrival_committed') {
    // Arrival is a server physical continuation, not another goal-bound NPC action.
    const journey = checkedJourney(context.journey),
      arrival = object(data.arrival);
    const expectedKeys = ['actorId', 'journeyId', 'departureEventId', 'route', 'arrival'];
    if (
      !arrival ||
      !text(event.id) ||
      Object.keys(data).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(data, key)) ||
      data.actorId !== journey.actorId ||
      data.journeyId !== journey.id ||
      data.departureEventId !== journey.departure.eventId ||
      !same(data.route, journey.route) ||
      event.id === journey.departure.eventId ||
      event.id === journey.origin.sourceEventId ||
      journey.departure.worldVersion >= event.version ||
      !Number.isFinite(time(event.storyAt)) ||
      time(event.storyAt) < time(journey.plannedArrivalAt) ||
      !same(arrival, {
        worldId: world.id,
        actorId: journey.actorId,
        id: arrival.id,
        commandId: event.commandId,
        eventId: event.id,
        worldVersion: event.version,
        at: arrival.at,
        journeyId: journey.id,
      }) ||
      !text(arrival.id) ||
      arrival.id === journey.departure.id ||
      event.commandId !== `arrival_${journey.id}` ||
      time(arrival.at) !== time(event.storyAt) ||
      !(
        (journey.status === 'in_transit' &&
          journey.revision === 0 &&
          !Object.hasOwn(journey, 'arrival')) ||
        (journey.status === 'arrived' && journey.revision === 1 && same(journey.arrival, arrival))
      )
    )
      throw Error('INVALID_AWARENESS_ARRIVAL');
    position(
      { kind: 'actor', actorId: journey.actorId },
      journey.route.toPlaceId,
      String(arrival.at),
    );
    // No observer packet exists in this protocol. Co-location alone grants no knowledge.
    reason('new_condition', { kind: 'event', id: event.id });
  }
  // Presence comes from the matching actual scene and its versioned intervals, never a contact roster.
  if (
    ['scene.opened', 'scene.entered', 'scene.action_resolved'].includes(event.type) &&
    context.scene
  ) {
    const scene = context.scene;
    if (
      scene.worldId === world.id &&
      scene.ownerId === world.ownerId &&
      data.sceneId === scene.id &&
      scene.sourceVersion <= event.version &&
      scene.placeId &&
      placeIds.has(scene.placeId) &&
      instant(event.storyAt)
    ) {
      for (const presence of scene.presence) {
        if (
          presence.joinedVersion > event.version ||
          (presence.leftVersion !== undefined && presence.leftVersion <= event.version)
        )
          continue;
        if (presence.participant.kind === 'actor' && !actorIds.has(presence.participant.actorId))
          continue;
        // A deterministic environment can introduce a view of independently
        // verified presence; viewing that scene is not a new physical move.
        const environment = object(data.environment);
        if (event.type !== 'scene.opened' || environment?.producer !== 'deterministic')
          position(presence.participant, scene.placeId, event.storyAt);
      }
      reason('new_condition', { kind: 'event', id: event.id });
    }
  }
  if (event.type === 'invitation.responded' && Array.isArray(data.agentProjections)) {
    for (const value of data.agentProjections) {
      const projection = object(value);
      const source = object(projection?.source);
      if (
        projection?.worldId !== world.id ||
        typeof projection.actorId !== 'string' ||
        !actorIds.has(projection.actorId) ||
        source?.worldVersion !== event.version ||
        source.recordId !== event.id ||
        !Array.isArray(projection.decisions)
      )
        throw Error('INVALID_AWARENESS_CALENDAR');
      for (const value of projection.decisions) {
        const decision = object(value);
        if (typeof decision?.id !== 'string' || decision.sourceId !== source.id)
          throw Error('INVALID_AWARENESS_CALENDAR');
        reason('player_decision', {
          kind: 'decision',
          id: decision.id,
          actorId: projection.actorId,
        });
      }
    }
  }
  const runtime = object(data.agentRuntime);
  const runtimeEvent = [
    'turn.resolved',
    'agent.state_committed',
    'group.turn_resolved',
    'scene.reaction_recorded',
  ].includes(event.type);
  if (runtime?.departures !== undefined && !runtimeEvent)
    throw Error('INVALID_AWARENESS_DEPARTURE');
  if (runtime && runtimeEvent) {
    const state = runtime.stateAfter as ActorAgentState | undefined;
    const proposal = object(runtime.proposal);
    const actorId = data.actorId;
    if (
      typeof actorId !== 'string' ||
      !actorIds.has(actorId) ||
      state?.worldId !== world.id ||
      state.actorId !== actorId ||
      state.projectedWorldVersion !== event.version ||
      !proposal
    )
      throw Error('INVALID_AWARENESS_RUNTIME');
    const previous = context.previousAgentState;
    if (previous && (previous.worldId !== world.id || previous.actorId !== actorId))
      throw Error('INVALID_AWARENESS_PREVIOUS_STATE');
    for (const next of state.plans) {
      const old = previous?.plans.find((plan) => plan.id === next.id);
      if (JSON.stringify(old) !== JSON.stringify(next))
        reason('plan_changed', { kind: 'plan', id: next.id, actorId });
    }
    if (runtime.episodeDecision !== undefined) {
      const decision = object(runtime.episodeDecision);
      if (
        !decision ||
        !same(decision, proposal.episodeDecision) ||
        !text(decision.requestId) ||
        !['engage', 'decline', 'defer', 'need_information', 'quiet'].includes(
          String(decision.choice),
        )
      )
        throw Error('INVALID_AWARENESS_EPISODE_DECISION');
      // A sourced participant response warrants later global coordination; it
      // is not a canonical incident, a player decision or a completed event.
      reason('cross_impact', { kind: 'event', id: event.id });
    }
    const proposedDecisionIds = new Set(
      Array.isArray(proposal.decisions) ? proposal.decisions.map((d) => object(d)?.id) : [],
    );
    for (const decision of state.decisions.filter((d) => proposedDecisionIds.has(d.id))) {
      if (!previous?.decisions.some((old) => old.id === decision.id))
        reason('player_decision', { kind: 'decision', id: decision.id, actorId });
    }
    if (runtime.positionKnowledge !== undefined) {
      if (!Array.isArray(runtime.positionKnowledge)) throw Error('INVALID_AWARENESS_REPORT');
      for (const value of runtime.positionKnowledge) {
        const k = value as ActorPositionKnowledge;
        if (
          k.worldId !== world.id ||
          k.observerActorId !== actorId ||
          k.sourceEventId !== event.id ||
          k.worldVersion !== event.version ||
          k.kind !== 'report' ||
          k.sourceKind !== 'player_report' ||
          k.occurredAt !== null ||
          !instant(k.learnedAt) ||
          (k.placeId !== null && !placeIds.has(k.placeId)) ||
          !k.evidence?.inputReceiptId ||
          !k.evidence.quote
        )
          throw Error('INVALID_AWARENESS_REPORT');
        delta.knowledge.push(k);
      }
    }
    if (!Array.isArray(runtime.results)) throw Error('INVALID_AWARENESS_RESULTS');
    for (const value of runtime.results) {
      const result = object(value);
      if (
        result?.worldId !== world.id ||
        result.actorId !== actorId ||
        result.eventId !== event.id ||
        result.worldVersion !== event.version ||
        typeof result.id !== 'string'
      )
        throw Error('INVALID_AWARENESS_RESULTS');
      reason('action_result', { kind: 'action_result', id: result.id, actorId });
    }
    if (runtime.departures !== undefined) {
      if (!Array.isArray(runtime.departures) || runtime.departures.length > 1)
        throw Error('INVALID_AWARENESS_DEPARTURE');
      for (const value of runtime.departures) {
        const journey = checkedJourney(value),
          receipt = journey.departure;
        const action = state.actions.filter((action) => action.id === journey.beginActionId);
        const proposed = Array.isArray(proposal.actions)
          ? proposal.actions.map(object).filter((action) => action?.id === journey.beginActionId)
          : [];
        const matching = runtime.results.map(object).filter((result) => result?.id === receipt.id);
        if (
          journey.status !== 'in_transit' ||
          journey.revision !== 0 ||
          Object.hasOwn(journey, 'arrival') ||
          journey.actorId !== actorId ||
          journey.preparedAtVersion !== event.version - 1 ||
          receipt.eventId !== event.id ||
          receipt.worldVersion !== event.version ||
          !Number.isFinite(time(event.storyAt)) ||
          time(journey.departedAt) !== time(event.storyAt) ||
          !world.space?.routes.some((route) => same(route, journey.route)) ||
          action.length !== 1 ||
          action[0]!.capability !== 'travel.begin' ||
          action[0]!.status !== 'succeeded' ||
          action[0]!.resultId !== receipt.id ||
          !same(action[0]!.parameters, { routeId: journey.route.id }) ||
          proposed.length !== 1 ||
          proposed[0]?.capability !== 'travel.begin' ||
          !same(proposed[0]?.parameters, { routeId: journey.route.id }) ||
          matching.length !== 1 ||
          !Object.entries(receipt).every(([key, value]) =>
            key === 'at' ? time(matching[0]?.at) === time(value) : matching[0]?.[key] === value,
          )
        )
          throw Error('INVALID_AWARENESS_DEPARTURE');
        delta.positions.push({
          worldId: world.id,
          subject: { kind: 'actor', actorId },
          status: 'in_transit',
          placeId: null,
          sourceEventId: event.id,
          worldVersion: event.version,
          occurredAt: new Date(journey.departedAt).toISOString(),
        });
        reason('new_condition', { kind: 'event', id: event.id });
      }
    }
  }
  return delta;
}

/** Model-facing view: no player ground truth or database record pointers. */
export type AgentWorldContext = {
  time: { storyAt: string; timeZone: 'UTC+08:00'; localDateTime: string };
  boundary: Pick<WorldBoundary, 'actorIds' | 'placeIds' | 'capabilityIds' | 'extensionPermission'>;
  /** Existing map choices from this NPC's sourced actual origin; not other actors' locations. */
  travelRoutes?: {
    id: string;
    fromPlaceId: string;
    toPlaceId: string;
    toPlaceName: string;
    durationMinutes: number;
    modeLabel: string;
  }[];
  selfPosition: {
    status: AuthoritativePosition['status'];
    placeId: string | null;
    occurredAt?: string;
    sourceId?: string;
  };
  knowledge: (Omit<
    ActorPositionKnowledge,
    'worldId' | 'observerActorId' | 'sourceEventId' | 'worldVersion' | 'evidence'
  > & { sourceId: string; reportedQuote?: string })[];
};
