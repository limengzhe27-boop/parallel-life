/**
 * Preview mode: a deployment that explicitly promises it will not persist data or
 * call a model. It must be a single decision point, so a route, a page and the
 * health probe can never disagree about whether the backend is live.
 */
export function isPreviewOnly(env: Record<string, string | undefined> = process.env): boolean {
  return env.APP_PREVIEW_ONLY === '1';
}
