import type { AgentArrivalReceipt } from './agent-travel.ts';
import type { SpaceRoute } from './space.ts';
import type { WorldState } from './types.ts';
import { DomainError } from './errors.ts';
import { isoInstant, validateEventId } from './validation.ts';

/** A trusted continuation of an actual departure; not a model action or fulfillment claim. */
export type AgentArrivalCommittedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'agent.arrival_committed';
  data: {
    actorId: string;
    journeyId: string;
    departureEventId: string;
    route: SpaceRoute;
    arrival: AgentArrivalReceipt;
  };
};

export function applyAgentArrivalEvent(
  world: WorldState,
  event: AgentArrivalCommittedEvent,
): WorldState {
  if (event.worldId !== world.id || event.version !== world.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  for (const id of [event.id, event.commandId]) validateEventId(id);
  isoInstant(event.storyAt);
  isoInstant(event.occurredAt);
  const { arrival, actorId, journeyId, route } = event.data;
  if (
    event.schemaVersion !== 1 ||
    Date.parse(event.storyAt) < Date.parse(world.time) ||
    !world.actors.some((a) => a.id === actorId) ||
    !world.space?.places.some((p) => p.id === route.toPlaceId) ||
    arrival.worldId !== world.id ||
    arrival.actorId !== actorId ||
    arrival.journeyId !== journeyId ||
    arrival.eventId !== event.id ||
    arrival.commandId !== event.commandId ||
    arrival.worldVersion !== event.version ||
    arrival.at !== event.storyAt ||
    !event.data.departureEventId
  )
    throw new DomainError('INVALID_PROPOSAL');
  // Positions and journey completion are projected from the original pinned ledger in the same UoW.
  // The player's location, choices, appointments and goals are unchanged.
  return { ...structuredClone(world), version: event.version, time: event.storyAt };
}
