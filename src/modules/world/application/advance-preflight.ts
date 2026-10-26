/**
 * A cheap negative preflight for autonomous advance.
 *
 * The full advance path hydrates messages, appointments, media and notes before
 * it can discover that the clock is paused or the provider asked for a cooldown.
 * Those two states are authoritative and need no projection at all. This module
 * only ever answers "definitely nothing to do"; any unknown condition returns
 * null and the caller keeps the complete path.
 */
export type AdvancePreflightMode = 'off' | 'shadow' | 'on';
export type AdvancePreflightReason = 'paused' | 'model_cooldown';

/** Default is shadow: observe agreement first, never skip without an explicit opt-in. */
export function advancePreflightMode(value: string | undefined): AdvancePreflightMode {
  return value === 'on' || value === 'off' || value === 'shadow' ? value : 'shadow';
}

export function advancePreflightReason(input: {
  paused: boolean;
  modelCooldown: boolean;
}): AdvancePreflightReason | null {
  if (input.paused) return 'paused';
  if (input.modelCooldown) return 'model_cooldown';
  return null;
}

const logged = new Set<string>();
/** Shadow observation is useful once per world/reason, not on every poll. */
export function shouldLogAdvancePreflight(worldId: string, reason: AdvancePreflightReason) {
  const key = `${worldId}:${reason}`;
  if (logged.has(key)) return false;
  if (logged.size >= 1000) logged.clear();
  logged.add(key);
  return true;
}
