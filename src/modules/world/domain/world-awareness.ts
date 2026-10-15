import type { WorldState } from './types.ts';
import type { ActorAgentState } from './agent-runtime.ts';
import type { SceneSession, Participant } from './experience-rules.ts';

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
  capabilityIds: readonly string[] = ['plan.record', 'appointment.propose'],
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
  context: { previousAgentState?: ActorAgentState; scene?: SceneSession } = {},
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
  if (!data) return delta;
  const actorIds = new Set(world.actors.map((actor) => actor.id));
  const placeIds = new Set(world.space?.places.map((place) => place.id) ?? []);
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
  if (
    runtime &&
    [
      'turn.resolved',
      'agent.state_committed',
      'group.turn_resolved',
      'scene.reaction_recorded',
    ].includes(event.type)
  ) {
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
  }
  return delta;
}

/** Model-facing view: no player ground truth or database record pointers. */
export type AgentWorldContext = {
  time: { storyAt: string; timeZone: 'UTC+08:00'; localDateTime: string };
  boundary: Pick<WorldBoundary, 'actorIds' | 'placeIds' | 'capabilityIds' | 'extensionPermission'>;
  selfPosition: {
    status: AuthoritativePosition['status'];
    placeId: string | null;
    occurredAt?: string;
    sourceId?: string;
  };
  knowledge: (Omit<
    ActorPositionKnowledge,
    'worldId' | 'observerActorId' | 'sourceEventId' | 'worldVersion'
  > & { sourceId: string })[];
};
