type AuthoredRoute = { fromPlaceKey: string; toPlaceKey: string; minutes: number };

/** Initial route IDs are frozen in genesis; discovered edges use a separate stable namespace. */
export function discoveredRouteIds(routes: readonly AuthoredRoute[]) {
  return [...routes]
    .sort(
      (a, b) =>
        a.fromPlaceKey.localeCompare(b.fromPlaceKey, 'en') ||
        a.toPlaceKey.localeCompare(b.toPlaceKey, 'en'),
    )
    .map((route, index) => ({ ...route, id: `publication_discovery_route_${index}` }));
}
