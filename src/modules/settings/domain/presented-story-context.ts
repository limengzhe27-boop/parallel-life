export type PresentedStoryThread = {
  sourceMessageId: string;
  sourceEventId: string;
  openingText: string;
  at: string;
  sourceVersion: number;
};

/** Keep actual, already delivered messages. Authored future intentions are never NPC knowledge. */
export function presentedStoryThreads(
  rows: { opening: unknown }[],
  actorId: string,
  worldVersion: number,
  storyNow: string,
): PresentedStoryThread[] {
  const result: PresentedStoryThread[] = [];
  for (const row of rows) {
    const message = row.opening;
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
    const m = message as Record<string, unknown>;
    if (
      m.role !== 'assistant' ||
      m.actorId !== actorId ||
      typeof m.id !== 'string' ||
      !m.id ||
      typeof m.sourceEventId !== 'string' ||
      !m.sourceEventId ||
      typeof m.text !== 'string' ||
      !m.text.trim() ||
      m.text.length > 6000 ||
      typeof m.at !== 'string' ||
      !Number.isFinite(Date.parse(m.at)) ||
      Date.parse(m.at) > Date.parse(storyNow) ||
      !Number.isFinite(Date.parse(storyNow)) ||
      !Number.isInteger(m.sourceVersion) ||
      Number(m.sourceVersion) > worldVersion ||
      Number(m.sourceVersion) < 1 ||
      result.some((item) => item.sourceMessageId === m.id)
    )
      continue;
    result.push({
      sourceMessageId: m.id,
      sourceEventId: m.sourceEventId,
      openingText: m.text.slice(0, 1800),
      at: m.at,
      sourceVersion: Number(m.sourceVersion),
    });
    if (result.length === 2) break;
  }
  return result;
}
