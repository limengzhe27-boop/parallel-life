import type { SpaceRoute, WorldSpaceState } from './space.ts';

/** A product convention, not a geographic distance estimate or an authored route. */
export const DEFAULT_TRAVEL_MINUTES = 10;
function routeKey(from: string, to: string) {
  let hash = 0xcbf29ce484222325n;
  for (const character of JSON.stringify([from, to])) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `default_travel_${hash.toString(16).padStart(16, '0')}`;
}
export function defaultTravelRoute(
  space: WorldSpaceState,
  fromPlaceId: string,
  toPlaceId: string,
): SpaceRoute | null {
  if (
    fromPlaceId === toPlaceId ||
    !space.places.some((p) => p.id === fromPlaceId) ||
    !space.places.some((p) => p.id === toPlaceId) ||
    space.routes.some((r) => r.fromPlaceId === fromPlaceId && r.toPlaceId === toPlaceId)
  )
    return null;
  const id = routeKey(fromPlaceId, toPlaceId);
  if (space.routes.some((r) => r.id === id)) return null;
  return {
    id,
    fromPlaceId,
    toPlaceId,
    durationMinutes: DEFAULT_TRAVEL_MINUTES,
    modeLabel: '前往',
    source: { kind: 'system_policy', policy: 'default_travel_v1', snapshotVersion: 0 },
  };
}
/** Read-only routes from the current place; no persistent quadratic route list. */
export function defaultTravelRoutes(space: WorldSpaceState): SpaceRoute[] {
  return space.places.flatMap((place) => {
    const route = defaultTravelRoute(space, space.currentPlaceId, place.id);
    return route ? [route] : [];
  });
}
export function resolveTravelRoute(space: WorldSpaceState, routeId: string) {
  return (
    space.routes.find((route) => route.id === routeId) ??
    defaultTravelRoutes(space).find((route) => route.id === routeId)
  );
}
export function sameDefaultTravelRoute(actual: SpaceRoute, supplied: SpaceRoute): boolean {
  return (
    supplied.id === actual.id &&
    supplied.fromPlaceId === actual.fromPlaceId &&
    supplied.toPlaceId === actual.toPlaceId &&
    supplied.durationMinutes === actual.durationMinutes &&
    supplied.modeLabel === actual.modeLabel &&
    supplied.source?.kind === 'system_policy' &&
    supplied.source.policy === 'default_travel_v1' &&
    supplied.source.snapshotVersion === 0 &&
    Object.keys(supplied).every((key) =>
      ['id', 'fromPlaceId', 'toPlaceId', 'durationMinutes', 'modeLabel', 'source'].includes(key),
    ) &&
    Object.keys(supplied.source).every((key) => ['kind', 'policy', 'snapshotVersion'].includes(key))
  );
}
