/** Pure UI bookkeeping; never a server read receipt or an authentication boundary. */
export function arrivingIds(previous: ReadonlySet<string>, current: readonly string[]): string[] {
  return [...new Set(current)].filter((id) => !previous.has(id));
}
export function isUnlockSwipe(startY: number, endY: number): boolean {
  return Number.isFinite(startY) && Number.isFinite(endY) && startY - endY >= 48;
}
