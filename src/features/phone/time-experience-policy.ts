import type { PhoneRoute } from './navigation.ts';
export const PHONE_IDLE_CHECK_MS = 75_000;
/** An open conversation includes reading/thinking; typing activity never ends it. */
export function phoneTimeMode(busy: boolean, route: PhoneRoute) {
  return busy ||
    route.panel === 'scene' ||
    (route.app === 'scenes' && !!route.target) ||
    (route.app === 'messages' && !!route.target)
    ? ('conversation' as const)
    : ('browsing' as const);
}
/** This grants a cheap evaluation opportunity, not permission to call a model or create drama. */
export function idleCheckDue(now: number, lastMeaningfulActivity: number, lastCheck: number) {
  return (
    now - lastMeaningfulActivity >= PHONE_IDLE_CHECK_MS && now - lastCheck >= PHONE_IDLE_CHECK_MS
  );
}
