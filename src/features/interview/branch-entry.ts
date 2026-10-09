/**
 * Which branch entry the personal conversation may show.
 *
 * The entry used to appear before any conversation and before any material was
 * confirmed, so tapping it asked the model for directions with nothing to base
 * them on. The planner rejects that output and the old UI silently navigated
 * away, which looked like "the branch simply cannot be created". Keep this
 * decision pure and tested so it cannot regress.
 */
export type BranchEntryState =
  /** No assistant turn yet: nothing to build a life from. */
  | { kind: 'hidden' }
  /** A generated world exists; the conversation offers to reopen the phone. */
  | { kind: 'open-ready' }
  /** Records are waiting for the user's own confirmation before any direction work. */
  | { kind: 'confirm-records'; pending: number }
  /** Nothing to base a direction on yet; keep talking instead of calling the model. */
  | { kind: 'needs-material' }
  /** Enough confirmed material: the user may generate a branch and enter the phone. */
  | { kind: 'create'; directionCount: number };

export function branchEntryState(input: {
  /** The conversation has at least one assistant reply. */
  ready: boolean;
  /** A world was already generated for this owner. */
  hasReadyWorld: boolean;
  /** Profile facts the user explicitly confirmed. */
  confirmedCount: number;
  /** Suggested records waiting for a decision. */
  pendingCandidates: number;
  /** Directions already generated in a previous run. */
  directionCount: number;
  /** A concrete life the user described in their own words. */
  hasUserMaterial?: boolean;
}): BranchEntryState {
  if (!input.ready) return { kind: 'hidden' };
  if (input.confirmedCount > 0)
    return { kind: 'create', directionCount: Math.max(0, input.directionCount) };
  if (input.hasReadyWorld) return { kind: 'open-ready' };
  if (input.hasUserMaterial)
    return { kind: 'create', directionCount: Math.max(0, input.directionCount) };
  if (input.pendingCandidates > 0)
    return { kind: 'confirm-records', pending: input.pendingCandidates };
  return { kind: 'needs-material' };
}

/** A direction prompt must come from the person's own concrete wish or choice,
 * not an assistant's invented story, a bare photo, or a negated request. */
export function branchMaterialBrief(
  messages: readonly { role: string; text: string; photoAssetId?: string | null }[],
): string {
  const material = messages
    .filter((message) => message.role === 'user')
    .map((message) =>
      message.text
        .replace(/^\[照片:[^\]]+\]\s*/u, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((text) => {
      if (!text || /^我分享了一张(?:生活)?照片[。！!]?$/u.test(text)) return false;
      if (
        /(?:不要|不想|暂不|先不|别|取消).{0,12}(?:创建|生成|构思|建|分支|平行人生|体验)/u.test(text)
      )
        return false;
      if (/累|疲惫|休息|睡觉/u.test(text) && !/成为|开|办|搬|转行|经营|去.+生活|当/u.test(text))
        return false;
      if (text.length < 8) return false;
      return /我.*(?:想|希望|打算|准备|计划|决定|正在)|如果当时|如果我|假如|要是|当初|总是在想|而是/u.test(
        text,
      );
    })
    .slice(-3)
    .map((text) => text.slice(0, 120));
  return material.join('；').slice(0, 400);
}
