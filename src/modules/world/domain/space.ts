import type { WorldState } from './types.ts';
import { DomainError } from './errors.ts';
import { projectStoryTime, type WorldClock } from './clock.ts';
import { isoInstant, validateEventId } from './validation.ts';
export type SpaceSource =
  | { kind: 'official_genesis'; presetId: string; contentVersion: number; snapshotVersion: 0 }
  | {
      kind: 'world_event';
      presetId: string;
      contentVersion: number;
      snapshotVersion: 0;
      eventId: string;
      eventVersion: number;
    };
export type SpacePlace = {
  id: string;
  name: string;
  description: string;
  source: SpaceSource;
  contactActorIds: string[];
  appointmentIds: string[];
};
export type SpaceRoute = {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
  durationMinutes: number;
  modeLabel: string;
  source: SpaceSource;
};
export type WorldSpaceState = {
  places: SpacePlace[];
  routes: SpaceRoute[];
  currentPlaceId: string;
  positionSource: SpaceSource | { kind: 'travel'; eventId: string; eventVersion: number };
};
export type SpaceOpening = {
  initialPlaceId: string;
  places: {
    key: string;
    name: string;
    description: string;
    actorKeys: string[];
    invitationKeys: string[];
  }[];
  routes: { key: string; from: string; to: string; minutes: number; modeLabel: string }[];
};
export function authoredSpace(
  opening: SpaceOpening,
  source: SpaceSource,
  actors: Map<string, string>,
  appointments: Map<string, string>,
): WorldSpaceState {
  const result: WorldSpaceState = {
    places: opening.places.map((p) => ({
      id: p.key,
      name: p.name,
      description: p.description,
      source,
      contactActorIds: p.actorKeys.map((k) => {
        const id = actors.get(k);
        if (!id) throw new DomainError('INVALID_PROPOSAL');
        return id;
      }),
      appointmentIds: p.invitationKeys.map((k) => {
        const id = appointments.get(k);
        if (!id) throw new DomainError('INVALID_PROPOSAL');
        return id;
      }),
    })),
    routes: opening.routes.map((r) => ({
      id: r.key,
      fromPlaceId: r.from,
      toPlaceId: r.to,
      durationMinutes: r.minutes,
      modeLabel: r.modeLabel,
      source,
    })),
    currentPlaceId: opening.initialPlaceId,
    positionSource: source,
  };
  validateSpace(result);
  return result;
}
export function validateSpace(space: WorldSpaceState): void {
  const keys = new Set(space.places.map((p) => p.id));
  const key = (s: string) => /^[a-z0-9_]{1,64}$/.test(s);
  if (
    !keys.has(space.currentPlaceId) ||
    keys.size !== space.places.length ||
    space.places.length > 16 ||
    space.routes.length > 64
  )
    throw new DomainError('INVALID_PROPOSAL');
  for (const p of space.places) {
    if (
      !key(p.id) ||
      !p.name.trim() ||
      p.name.length > 80 ||
      !p.description.trim() ||
      p.description.length > 1000
    )
      throw new DomainError('INVALID_PROPOSAL');
    for (const id of p.contactActorIds) validateEventId(id);
  }
  if (new Set(space.routes.map((r) => r.id)).size !== space.routes.length)
    throw new DomainError('INVALID_PROPOSAL');
  for (const r of space.routes)
    if (
      !key(r.id) ||
      !keys.has(r.fromPlaceId) ||
      !keys.has(r.toPlaceId) ||
      r.fromPlaceId === r.toPlaceId ||
      !Number.isInteger(r.durationMinutes) ||
      r.durationMinutes < 1 ||
      r.durationMinutes > 120 ||
      !r.modeLabel.trim()
    )
      throw new DomainError('INVALID_PROPOSAL');
}
export type TravelEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'travel.completed';
  data: {
    routeId: string;
    fromPlaceId: string;
    toPlaceId: string;
    durationMinutes: number;
    departedAt: string;
    arrivedAt: string;
    leftSceneId: string | null;
    departureObservation?: WorldState['facts'][number];
  };
};
export type SpaceEstablishedEvent = {
  schemaVersion: 1;
  id: string;
  worldId: string;
  commandId: string;
  version: number;
  occurredAt: string;
  storyAt: string;
  type: 'space.established';
  data: { space: WorldSpaceState };
};
export function travelTimes(
  world: WorldState,
  clock: WorldClock,
  routeId: string,
  realNow: string,
) {
  if (clock.paused) throw new DomainError('INVALID_COMMAND', '人生已暂停，恢复后再前往');
  if (!world.space) throw new DomainError('INVALID_COMMAND', '这段人生还没有可靠的地点资料');
  validateSpace(world.space);
  const route = world.space.routes.find((r) => r.id === routeId);
  if (!route || route.fromPlaceId !== world.space.currentPlaceId)
    throw new DomainError('INVALID_COMMAND', '路线已变化，请刷新地点');
  const departedAt = new Date(
    Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, realNow))),
  ).toISOString();
  return {
    route,
    departedAt,
    arrivedAt: new Date(Date.parse(departedAt) + route.durationMinutes * 60000).toISOString(),
  };
}
export function applySpaceEvent(
  world: WorldState,
  e: TravelEvent | SpaceEstablishedEvent,
): WorldState {
  if (e.worldId !== world.id || e.version !== world.version + 1)
    throw new DomainError('VERSION_CONFLICT');
  validateEventId(e.id);
  validateEventId(e.commandId);
  isoInstant(e.storyAt);
  isoInstant(e.occurredAt);
  if (Date.parse(e.storyAt) < Date.parse(world.time)) throw new DomainError('INVALID_COMMAND');
  if (e.type === 'space.established') {
    if (world.space || world.version !== 0) throw new DomainError('INVALID_COMMAND');
    validateSpace(e.data.space);
    if (
      e.data.space.positionSource.kind !== 'world_event' ||
      e.data.space.positionSource.eventId !== e.id ||
      e.data.space.positionSource.eventVersion !== e.version
    )
      throw new DomainError('INVALID_PROPOSAL');
    return { ...world, version: e.version, time: e.storyAt, space: structuredClone(e.data.space) };
  }
  if (!world.space) throw new DomainError('INVALID_COMMAND');
  const route = world.space.routes.find((r) => r.id === e.data.routeId);
  if (
    !route ||
    route.fromPlaceId !== world.space.currentPlaceId ||
    route.fromPlaceId !== e.data.fromPlaceId ||
    route.toPlaceId !== e.data.toPlaceId ||
    route.durationMinutes !== e.data.durationMinutes ||
    e.storyAt !== e.data.arrivedAt ||
    Date.parse(e.data.departedAt) < Date.parse(world.time) ||
    Date.parse(e.data.arrivedAt) - Date.parse(e.data.departedAt) !== route.durationMinutes * 60000
  )
    throw new DomainError('INVALID_PROPOSAL');
  const observed = e.data.departureObservation;
  if (
    observed &&
    (observed.sourceEventId !== e.id ||
      observed.kind !== 'canonical' ||
      observed.visibility.kind !== 'actors' ||
      !observed.visibility.actorIds.length ||
      observed.visibility.actorIds.some((id) => !world.actors.some((a) => a.id === id)) ||
      !e.data.leftSceneId)
  )
    throw new DomainError('INVALID_PROPOSAL');
  return {
    ...world,
    version: e.version,
    time: e.storyAt,
    facts: e.data.departureObservation
      ? [...world.facts, e.data.departureObservation]
      : world.facts,
    space: {
      ...world.space,
      currentPlaceId: route.toPlaceId,
      positionSource: { kind: 'travel', eventId: e.id, eventVersion: e.version },
    },
  };
}
