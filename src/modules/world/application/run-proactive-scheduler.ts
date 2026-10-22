export type ProactiveWorld = { ownerId: string; worldId: string };
export type ProactiveWorldSource = { claimProactive(): Promise<ProactiveWorld[]> };

/** A bounded server tick; leases/cooldowns live in SQL so duplicate deliveries are safe. */
export async function runProactiveScheduler(
  source: ProactiveWorldSource,
  advance: (ownerId: string, worldId: string) => Promise<{ played: number }>,
) {
  const claimed = await source.claimProactive();
  let advanced = 0;
  let messages = 0;
  let failed = 0;
  for (const world of claimed) {
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
  }
  return { claimed: claimed.length, advanced, messages, failed };
}
