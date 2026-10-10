/** UI navigation only; never a world fact or an authorization decision. */
export const phoneApps = [
  'messages',
  'moments',
  'photos',
  'calendar',
  'notes',
  'scenes',
  'map',
] as const;
export const desktopApps = ['messages', 'calendar', 'photos', 'notes', 'scenes', 'map'] as const;
export type PhoneApp = (typeof phoneApps)[number];
export const phonePanels = ['schedule', 'timeline', 'time', 'scene', 'management'] as const;
export type PhonePanel = (typeof phonePanels)[number];
export type PhoneRoute = { app: PhoneApp | null; target?: string; panel?: PhonePanel };
export const homeRoute: PhoneRoute = { app: null };

export function routeHash(worldId: string, route: PhoneRoute): string {
  // Retired settings links open existing notes; they do not edit world state.
  if (route.panel === 'management') route = { app: 'notes' };
  const values = new URLSearchParams({ life: worldId });
  if (route.app) values.set('app', route.app);
  if ((route.app || route.panel === 'scene') && route.target) values.set('target', route.target);
  if (route.panel) values.set('panel', route.panel);
  return `#${values}`;
}

export function readRoute(hash: string, worldId: string): PhoneRoute {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  if (values.get('life') !== worldId) return homeRoute;
  const app = values.get('app');
  const panel = values.get('panel') === 'director' ? 'time' : values.get('panel');
  if (panel === 'management') return { app: 'notes' };
  const validApp = phoneApps.find((value) => value === app) ?? null;
  const validPanel = phonePanels.find((value) => value === panel);
  const target = values.get('target');
  return {
    app: validApp,
    ...((validApp || validPanel === 'scene') && target && target.length <= 256 ? { target } : {}),
    ...(validPanel ? { panel: validPanel } : {}),
  };
}

/** Retired controls may still exist in saved URLs; only active pages reach the phone shell. */
export function activePhoneRoute(route: PhoneRoute): PhoneRoute {
  if (route.panel === 'time') return homeRoute;
  if (route.panel === 'schedule') return { app: 'calendar' };
  return route;
}

export function parentRoute(route: PhoneRoute): PhoneRoute {
  if (route.panel === 'scene') return { app: 'scenes' };
  if (route.panel) return { app: route.app, ...(route.target ? { target: route.target } : {}) };
  if (route.target) return { app: route.app };
  return homeRoute;
}

export function scrollKey(worldId: string, route: PhoneRoute): string {
  return JSON.stringify([worldId, route.app, route.target ?? null]);
}
