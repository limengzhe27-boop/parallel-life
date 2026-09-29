export type DueWorld = { ownerId: string; worldId: string };
export type DueWorldSource = { claimDue(): Promise<DueWorld[]> };

/** A claim is at-most-once per UTC day; a failed AI call stays unknown for manual review. */
export async function runDailyScheduler(
  source: DueWorldSource,
  advance: (ownerId: string, worldId: string) => Promise<{ played: number }>,
) {
  const claimed = await source.claimDue();
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
      // Keep operational metadata only; owner/world IDs, messages and secrets stay out of logs.
      console.warn(
        JSON.stringify({
          scope: 'daily-world-scheduler',
          code: (error as { code?: string })?.code ?? 'FAILED',
        }),
      );
    }
  }
  return { claimed: claimed.length, advanced, messages, failed };
}
