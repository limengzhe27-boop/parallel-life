/** Authoring fields show the fictional world's UTC+08 calendar, independent of the editor's OS zone. */
export function publicationLocalTime(raw: string) {
  const n = Date.parse(raw);
  return Number.isFinite(n) ? new Date(n + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
}
export function publicationUtcTime(local: string) {
  if (!local) return '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw Error('INVALID_STORY_TIME');
  const n = Date.parse(local + ':00+08:00');
  if (!Number.isFinite(n) || publicationLocalTime(new Date(n).toISOString()) !== local)
    throw Error('INVALID_STORY_TIME');
  return new Date(n).toISOString();
}
