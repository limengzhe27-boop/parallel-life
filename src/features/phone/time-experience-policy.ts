import type { PhoneRoute } from './navigation.ts';
import { Id } from '../../contracts/api.ts';
import { parseGroupTarget } from './groups/state.ts';
import type { ClockActivityRequest } from '../../contracts/world-clock.ts';
/** Target observed delivery, reserving time for queueing/generation/projection; never a delivery SLA. */
export type PhoneRuntimePolicy = {
  checkEveryMs: number;
  deliveryTargetMs: number;
  preparationReserveMs: number;
  recheckAfterMs: number;
};
export const PHONE_RUNTIME_POLICY: Readonly<PhoneRuntimePolicy> = Object.freeze({
  checkEveryMs: 5_000,
  deliveryTargetMs: 55_000,
  preparationReserveMs: 20_000,
  recheckAfterMs: 15_000,
});
export const PHONE_IDLE_CHECK_MS =
  PHONE_RUNTIME_POLICY.deliveryTargetMs - PHONE_RUNTIME_POLICY.preparationReserveMs;
export type PhoneCheckHistory = {
  lastActivityAt: number;
  lastCheckAt: number;
  incomingIds: string[] | null;
};
/** Only metadata is persisted. Refresh/navigation must not restart the activity window. */
export function phoneCheckHistory(now: number, saved?: unknown): PhoneCheckHistory {
  const raw = saved as Partial<PhoneCheckHistory> | null;
  const timestamp = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now ? v : fallback;
  return {
    lastActivityAt: timestamp(raw?.lastActivityAt, now),
    lastCheckAt: timestamp(raw?.lastCheckAt, 0),
    incomingIds:
      Array.isArray(raw?.incomingIds) && raw.incomingIds.every((id) => typeof id === 'string')
        ? raw.incomingIds.slice(-256)
        : null,
  };
}
/** Called on persisted projections, not optimistic text, unread changes, or authored story timestamps. */
export function observePhoneIncoming(
  history: PhoneCheckHistory,
  ids: readonly string[],
  now: number,
): PhoneCheckHistory {
  const incomingIds = [...new Set(ids)].slice(-256);
  const previous = history.incomingIds;
  return {
    ...history,
    incomingIds,
    lastActivityAt:
      previous !== null && incomingIds.some((id) => !previous.includes(id))
        ? Math.max(history.lastActivityAt, now)
        : history.lastActivityAt,
  };
}
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
/** Online evaluation is bounded even during a conversation; this never authorizes a model call. */
export function idleCheckDue(
  now: number,
  lastMeaningfulActivity: number,
  lastCheck: number,
  policy: Readonly<PhoneRuntimePolicy> = PHONE_RUNTIME_POLICY,
) {
  return (
    (now - lastMeaningfulActivity >= policy.deliveryTargetMs - policy.preparationReserveMs ||
      now - lastCheck >= policy.deliveryTargetMs - policy.preparationReserveMs) &&
    now - lastCheck >= policy.recheckAfterMs
  );
}
