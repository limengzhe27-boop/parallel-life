import type { PhoneApp, PhonePanel } from './navigation.ts';

type HomeEntry =
  | { kind: 'app'; app: PhoneApp; label: string }
  | { kind: 'panel'; panel: PhonePanel; label: string };

/** Presentation only: all entries use the existing app and panel routes. */
export const homeAppRows = [
  [
    { kind: 'app', app: 'calendar', label: '日历' },
    { kind: 'app', app: 'photos', label: '相册' },
    { kind: 'app', app: 'notes', label: '备忘录' },
  ],
  [
    { kind: 'app', app: 'records', label: '记录' },
    { kind: 'panel', panel: 'timeline', label: '身份' },
  ],
] as const satisfies readonly (readonly HomeEntry[])[];
export const homeDockApps = ['messages', 'scenes', 'map'] as const satisfies readonly PhoneApp[];
