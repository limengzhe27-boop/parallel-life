/** Local reading position only. Zero-height/hidden chat panes are not readable. */
export type ChatReadingPosition = {
  scope: string;
  initialized: boolean;
  visible: boolean;
  top: number;
  nearBottom: boolean;
};
export type ChatReadingMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  documentVisible: boolean;
};
export const emptyChatReadingPosition = (scope: string): ChatReadingPosition => ({
  scope,
  initialized: false,
  visible: false,
  top: 0,
  nearBottom: true,
});
export function chatIsReadable(metrics: ChatReadingMetrics) {
  return metrics.documentVisible && metrics.clientHeight > 0;
}
export function chatIsAtLatest(metrics: ChatReadingMetrics) {
  return (
    chatIsReadable(metrics) && metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < 60
  );
}
function savedPosition(raw: string | undefined) {
  if (raw === undefined || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
/** First actual visibility initializes saved/bottom; later visibility restores the reader's intent. */
export function restoreVisibleChatPosition(
  previous: ChatReadingPosition,
  scope: string,
  metrics: ChatReadingMetrics,
  saved: string | undefined,
): { position: ChatReadingPosition; scrollTo: number | null } {
  const current = previous.scope === scope ? previous : emptyChatReadingPosition(scope);
  if (!chatIsReadable(metrics)) return { position: { ...current, visible: false }, scrollTo: null };
  const bottom = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const initialSaved = current.initialized ? null : savedPosition(saved);
  const scrollTo = !current.initialized
    ? Math.min(bottom, initialSaved ?? bottom)
    : !current.visible
      ? current.nearBottom
        ? bottom
        : Math.min(bottom, current.top)
      : current.nearBottom
        ? bottom
        : null;
  const top = scrollTo ?? metrics.scrollTop;
  return {
    position: { scope, initialized: true, visible: true, top, nearBottom: bottom - top < 60 },
    scrollTo,
  };
}
/** Hidden resize/scroll events cannot overwrite a previously observed reading position. */
export function captureVisibleChatPosition(
  previous: ChatReadingPosition,
  scope: string,
  metrics: ChatReadingMetrics,
): ChatReadingPosition {
  if (previous.scope !== scope || !previous.initialized || !chatIsReadable(metrics))
    return previous;
  return {
    ...previous,
    visible: true,
    top: metrics.scrollTop,
    nearBottom: chatIsAtLatest(metrics),
  };
}
