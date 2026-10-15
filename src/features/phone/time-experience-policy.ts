export const PHONE_IDLE_CHECK_MS = 75_000;
export const CONVERSATION_GRACE_MS = 30_000;
export function phoneTimeMode(
  now: number,
  lastConversation: number,
  busy: boolean,
  scene: boolean,
) {
  return busy || scene || now - lastConversation < CONVERSATION_GRACE_MS
    ? ('conversation' as const)
    : ('browsing' as const);
}
export function idleCheckDue(now: number, lastActivity: number, lastCheck: number) {
  return now - lastActivity >= PHONE_IDLE_CHECK_MS && now - lastCheck >= PHONE_IDLE_CHECK_MS;
}
