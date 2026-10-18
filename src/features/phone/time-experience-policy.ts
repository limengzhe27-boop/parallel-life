import type { PhoneRoute } from './navigation.ts';
import { Id } from '../../contracts/api.ts';
import { parseGroupTarget } from './groups/state.ts';
import type { ClockActivityRequest } from '../../contracts/world-clock.ts';
export const PHONE_IDLE_CHECK_MS = 75_000;
/** An open conversation includes reading/thinking; typing activity never ends it. */
export function phoneTimeMode(busy: boolean, route: PhoneRoute, locked = false) {
  if (locked && !busy) return 'browsing' as const;
  return busy ||
    route.panel === 'scene' ||
    (route.app === 'scenes' && !!route.target) ||
    (route.app === 'messages' && !!route.target)
    ? ('conversation' as const)
    : ('browsing' as const);
}
/** Business navigation supplies a claim only; the server reauthorizes its actual audience. */
export function phoneConversationFocus(
  route: PhoneRoute,
  locked = false,
): ClockActivityRequest['focus'] {
  if (locked) return null;
  if (!route.target) return null;
  if ((route.panel === 'scene' || route.app === 'scenes') && Id.safeParse(route.target).success)
    return { channel: 'scene', threadId: route.target };
  if (route.app !== 'messages') return null;
  const groupId = parseGroupTarget(route.target);
  if (groupId) return { channel: 'group', threadId: groupId };
  return Id.safeParse(route.target).success ? { channel: 'private', threadId: route.target } : null;
}
/** This grants a cheap evaluation opportunity, not permission to call a model or create drama. */
export function idleCheckDue(now: number, lastMeaningfulActivity: number, lastCheck: number) {
  return (
    now - lastMeaningfulActivity >= PHONE_IDLE_CHECK_MS && now - lastCheck >= PHONE_IDLE_CHECK_MS
  );
}
