export type ProactiveWorld = { ownerId: string; worldId: string };
export type ProactiveWorldSource = { claimProactive(): Promise<ProactiveWorld[]> };

/** A bounded server tick; leases/cooldowns live in SQL so duplicate deliveries are safe. */
export async function runProactiveScheduler(
  source: ProactiveWorldSource,
  advance: (ownerId: string, worldId: string) => Promise<{ played: number }>,
) {
  const startedAt = Date.now();
  let claimedCount = 0;
  let advanced = 0;
  let messages = 0;
  let failed = 0;
  // Claim only work that can start now; never lease an entire backlog before execution.
  while (claimedCount < 50 && Date.now() - startedAt < 240_000) {
    const claimed = await source.claimProactive();
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
