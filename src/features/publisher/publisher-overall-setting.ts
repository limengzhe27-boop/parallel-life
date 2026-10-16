import { publicationStorageIssues } from '../../modules/settings/domain/publication-content.ts';

type Content = Record<string, unknown>;
export const OVERALL_SETTING_NAMESPACE = 'parallel_life.authoring_overall';
export type OverallSettingProblem = 'invalid_extension' | 'ambiguous_extension';
export type OverallSetting = {
  text: string;
  source: 'authored' | 'existing' | 'empty';
  problem?: OverallSettingProblem;
};
export type OverallSettingResult =
  | { ok: true; content: Content }
  | {
      ok: false;
      reason:
        | OverallSettingProblem
        | 'extension_limit'
        | 'extension_budget'
        | 'extensions_budget'
        | 'content_budget'
        | 'invalid_content';
    };
const record = (v: unknown): Content =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Content) : {};
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
function extension(content: Content): { row?: Content; problem?: OverallSettingProblem } {
  if (content.extensions !== undefined && !Array.isArray(content.extensions))
    return { problem: 'invalid_extension' };
  const rows = ((content.extensions as unknown[] | undefined) ?? []).filter(
    (v) => record(v).namespace === OVERALL_SETTING_NAMESPACE,
  );
  if (rows.length > 1) return { problem: 'ambiguous_extension' };
  if (!rows.length) return {};
  const row = record(rows[0]),
    data = record(row.data);
  if (
    row.version !== 1 ||
    row.purpose !== 'editorial' ||
    typeof row.description !== 'string' ||
    typeof data.text !== 'string' ||
    Object.keys(data).length !== 1 ||
    Object.keys(row).some(
      (k) => !['namespace', 'version', 'purpose', 'description', 'data'].includes(k),
    )
  )
    return { problem: 'invalid_extension' };
  return { row };
}
/** Author-only manuscript. Legacy fallback is a labelled recap, never claimed as original prose. */
export function readOverallSetting(content: Content): OverallSetting {
  const found = extension(content);
  if (found.problem) return { text: '', source: 'empty', problem: found.problem };
  if (found.row) return { text: record(found.row.data).text as string, source: 'authored' };
  const work = record(content.work),
    world = record(content.world),
    player = record(content.protagonist);
  const sections: [string, unknown][] = [
    ['一句话介绍', work.hook ?? world.hook],
    ['作品介绍', work.description ?? world.description],
    ['玩家可知的背景', world.publicSetting],
    ['幕后背景（不公开）', world.hiddenContext],
    ['主角身份', player.identity ?? world.protagonistIdentity],
    ['开场处境', player.situation ?? world.protagonistSituation],
    ['故事氛围', world.tone],
    ['体验说明', work.experienceNote ?? world.experienceNote],
  ];
  const text = sections
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([label, v]) => `${label}\n${v}`)
    .join('\n\n');
  return { text, source: text ? 'existing' : 'empty' };
}
/** Lossless proposal for a private draft update; never changes publication-facing fields. */
export function updateOverallSetting(content: Content, text: string): OverallSettingResult {
  // Stored drafts have already passed this check; fail closed for malformed external callers.
  const existingIssues = publicationStorageIssues(content);
  if (existingIssues.some((i) => i.code !== 'content_budget'))
    return { ok: false, reason: 'invalid_content' };
  const found = extension(content);
  if (found.problem) return { ok: false, reason: found.problem };
  const previous = (content.extensions as unknown[] | undefined) ?? [];
  if (!found.row && previous.length >= 8) return { ok: false, reason: 'extension_limit' };
  const data = { text };
  if (bytes(data) > 8192) return { ok: false, reason: 'extension_budget' };
  const row = found.row
    ? { ...found.row, data }
    : {
        namespace: OVERALL_SETTING_NAMESPACE,
        version: 1,
        purpose: 'editorial',
        description: '作者总体设定原稿',
        data,
      };
  const extensions = found.row
    ? previous.map((v) => (v === found.row ? row : v))
    : [...previous, row];
  if (extensions.length > 8) return { ok: false, reason: 'extension_limit' };
  let total = 0;
  for (const item of extensions) {
    const entry = record(item);
    if (!Object.hasOwn(entry, 'data')) return { ok: false, reason: 'invalid_extension' };
    const size = bytes(entry.data);
    if (size > 8192) return { ok: false, reason: 'extension_budget' };
    total += size;
  }
  if (total > 16384) return { ok: false, reason: 'extensions_budget' };
  const next = { ...content, extensions };
  const issues = publicationStorageIssues(next);
  if (issues.length)
    return {
      ok: false,
      reason: issues.some((i) => i.code === 'content_budget')
        ? 'content_budget'
        : 'invalid_content',
    };
  return { ok: true, content: next };
}
