/** UI navigation only; never a world fact or an authorization decision. */
export const phoneApps = ['messages', 'moments', 'photos', 'calendar', 'notes'] as const;
export type PhoneApp = (typeof phoneApps)[number];
export const phonePanels = ['schedule', 'timeline', 'director', 'management'] as const;
export type PhonePanel = (typeof phonePanels)[number];
export type PhoneRoute = { app: PhoneApp | null; target?: string; panel?: PhonePanel };
export const homeRoute: PhoneRoute = { app: null };

export function routeHash(worldId: string, route: PhoneRoute): string {
  const values = new URLSearchParams({ life: worldId });
  if (route.app) values.set('app', route.app);
  if (route.app && route.target) values.set('target', route.target);
  if (route.panel) values.set('panel', route.panel);
  return `#${values}`;
}

export function readRoute(hash: string, worldId: string): PhoneRoute {
  const values = new URLSearchParams(hash.replace(/^#/, ''));
  if (values.get('life') !== worldId) return homeRoute;
  const app = values.get('app');
  const panel = values.get('panel');
  const validApp = phoneApps.find((value) => value === app) ?? null;
  const validPanel = phonePanels.find((value) => value === panel);
  const target = values.get('target');
  return {
    app: validApp,
    ...(validApp && target && target.length <= 256 ? { target } : {}),
    ...(validPanel ? { panel: validPanel } : {}),
  };
}

export function parentRoute(route: PhoneRoute): PhoneRoute {
  if (route.panel) return { app: route.app, ...(route.target ? { target: route.target } : {}) };
  if (route.target) return { app: route.app };
  return homeRoute;
}

export function scrollKey(worldId: string, route: PhoneRoute): string {
  return JSON.stringify([worldId, route.app, route.target ?? null]);
}
