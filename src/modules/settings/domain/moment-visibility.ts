/** Rules use the world's story instant and committed dialogue, never browser state. */
export type MomentAudience = 'all' | 'three_days';
export type MomentUnlock = {
  kind: 'after_statement';
  actorKey: string;
  statement: string;
};
export type MomentSource = {
  at: string;
  image?: string;
  images?: readonly string[];
  visibility?: MomentUnlock;
};
export type CommittedStatement = {
  actorKey: string;
  role: 'assistant' | 'user';
  text: string;
  at: string;
  sourceEventId: string;
};

export function momentImages(moment: Pick<MomentSource, 'image' | 'images'>): string[] {
  const images = Array.isArray(moment.images) ? moment.images : moment.image ? [moment.image] : [];
  return [...new Set(images.filter((image) => typeof image === 'string' && image.trim()))];
}

/** An author-chosen confirmation must be a whole committed NPC message. */
export function momentUnlocked(
  unlock: MomentUnlock | undefined,
  statements: readonly CommittedStatement[],
  storyNow: string,
): boolean {
  if (!unlock) return true;
  const now = Date.parse(storyNow);
  if (!Number.isFinite(now) || !unlock.actorKey || !unlock.statement.trim()) return false;
  return statements.some(
    (message) =>
      message.role === 'assistant' &&
      message.actorKey === unlock.actorKey &&
      Boolean(message.sourceEventId) &&
      message.text.trim() === unlock.statement.trim() &&
      Number.isFinite(Date.parse(message.at)) &&
      Date.parse(message.at) <= now,
  );
}

export function momentVisible(
  moment: MomentSource,
  audience: MomentAudience,
  storyNow: string,
  statements: readonly CommittedStatement[],
): boolean {
  const now = Date.parse(storyNow);
  const at = Date.parse(moment.at);
  if (!Number.isFinite(now) || !Number.isFinite(at) || at > now) return false;
  if (audience === 'three_days' && at < now - 72 * 60 * 60 * 1000) return false;
  return momentUnlocked(moment.visibility, statements, storyNow);
}
