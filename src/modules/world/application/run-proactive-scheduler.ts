export type ProactiveWorld = { ownerId: string; worldId: string };
export type ProactiveWorldSource = {
  claimProactive(maxWorlds?: number): Promise<ProactiveWorld[]>;
};

export type ProactiveTickPolicy = { maxWorlds: number; maxElapsedMs: number };
export const DEFAULT_PROACTIVE_TICK_POLICY: Readonly<ProactiveTickPolicy> = Object.freeze({
  maxWorlds: 50,
  maxElapsedMs: 240_000,
});
export function proactiveTickPolicy(
  input: Partial<ProactiveTickPolicy> = {},
): Readonly<ProactiveTickPolicy> {
  const policy = { ...DEFAULT_PROACTIVE_TICK_POLICY, ...input };
  if (
    !Number.isSafeInteger(policy.maxWorlds) ||
    policy.maxWorlds < 1 ||
    policy.maxWorlds > 50 ||
    !Number.isSafeInteger(policy.maxElapsedMs) ||
    policy.maxElapsedMs < 1 ||
    policy.maxElapsedMs > 240_000
  )
    throw Error('INVALID_PROACTIVE_TICK_POLICY');
  return Object.freeze(policy);
}
export type ProactiveClaimTiming = { cooldownSeconds: number; leaseSeconds: number };
export const DEFAULT_PROACTIVE_CLAIM_TIMING: Readonly<ProactiveClaimTiming> = Object.freeze({
  cooldownSeconds: 60,
  leaseSeconds: 60,
});
/** Parameters alter code scheduling only; the original SQL owns world qualification and leases. */
export function proactiveClaimParameters(maxWorlds = 2, input: Partial<ProactiveClaimTiming> = {}) {
  const timing = { ...DEFAULT_PROACTIVE_CLAIM_TIMING, ...input };
  if (
    !Number.isSafeInteger(maxWorlds) ||
    maxWorlds < 1 ||
    maxWorlds > 2 ||
    !Number.isSafeInteger(timing.cooldownSeconds) ||
    timing.cooldownSeconds < 1 ||
    timing.cooldownSeconds > 86400 ||
    !Number.isSafeInteger(timing.leaseSeconds) ||
    timing.leaseSeconds < 1 ||
    timing.leaseSeconds > 600
  )
    throw Error('INVALID_PROACTIVE_CLAIM_POLICY');
  return [maxWorlds, timing.cooldownSeconds, timing.leaseSeconds] as const;
}
/** A bounded server tick; leases/cooldowns live in SQL so duplicate deliveries are safe. */
export async function runProactiveScheduler(
  source: ProactiveWorldSource,
  advance: (ownerId: string, worldId: string) => Promise<{ played: number }>,
  options: Partial<ProactiveTickPolicy> = {},
) {
  const policy = proactiveTickPolicy(options);
  const startedAt = Date.now();
  let claimedCount = 0;
  let advanced = 0;
  let messages = 0;
  let failed = 0;
  // Claim only work that can start now; never lease an entire backlog before execution.
  while (claimedCount < policy.maxWorlds && Date.now() - startedAt < policy.maxElapsedMs) {
    const remaining = Math.min(2, policy.maxWorlds - claimedCount);
    const claimed = await source.claimProactive(remaining);
    if (claimed.length > remaining) throw Error('PROACTIVE_CLAIM_LIMIT_EXCEEDED');
    if (!claimed.length) break;
    claimedCount += claimed.length;
    await Promise.all(
      claimed.map(async (world) => {
        try {
          const result = await advance(world.ownerId, world.worldId);
          advanced++;
          messages += result.played;
        } catch (error) {
          failed++;
          console.warn(
            JSON.stringify({
              scope: 'proactive-world-scheduler',
              code: (error as { code?: string })?.code ?? 'FAILED',
            }),
          );
        }
      }),
    );
  }
  return { claimed: claimedCount, advanced, messages, failed };
}
