import { PublishedWorldContentSchema } from '../../contracts/published-world-content.ts';

export type PlotRecord = Record<string, unknown>;
export type PlotSection = 'history' | 'stages' | 'candidates';
export type PlotPath = readonly (string | number)[];
export type PlotChoice = { key: string; label: string };
const isRecord = (v: unknown): v is PlotRecord => !!v && typeof v === 'object' && !Array.isArray(v);
export const plotRecord = (v: unknown): PlotRecord => (isRecord(v) ? v : {});
export const plotText = (v: unknown) => (typeof v === 'string' ? v : '');
export const plotArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const plotStrings = (v: unknown): string[] =>
  plotArray(v).filter((s): s is string => typeof s === 'string');
export class PlotEditError extends Error {
  readonly code: string;
  readonly references: string[];
  constructor(code: string, references: string[] = []) {
    super(code);
    this.code = code;
    this.references = references;
  }
}
/** JSON draft copying preserves untouched text and unknown keys, without assigning to __proto__. */
export function clonePlot<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clonePlot) as T;
  if (!isRecord(v)) return v;
  const next: PlotRecord = {};
  for (const [key, value] of Object.entries(v))
    Object.defineProperty(next, key, {
      value: clonePlot(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return next as T;
}
const basePath = (section: PlotSection): (string | number)[] =>
  section === 'stages' ? ['timeline', 'stages'] : [section];
export function plotValue(content: unknown, path: PlotPath): unknown {
  let value = content;
  for (const part of path)
    value = isRecord(value) || Array.isArray(value) ? (value as PlotRecord)[part] : undefined;
  return value;
}
export function plotRows(content: PlotRecord, section: PlotSection) {
  return plotArray(plotValue(content, basePath(section)));
}
export function plotCollectionEditable(content: PlotRecord, section: PlotSection) {
  if (section === 'stages' && content.timeline !== undefined && !isRecord(content.timeline))
    return false;
  const value = plotValue(content, basePath(section));
  return value === undefined || Array.isArray(value);
}
export function plotChoices(
  content: PlotRecord,
  kind: 'actors' | 'places' | PlotSection,
): PlotChoice[] {
  const items =
    kind === 'actors' || kind === 'places' ? plotArray(content[kind]) : plotRows(content, kind);
  const counts = new Map<string, number>();
  for (const raw of items) {
    const key = plotText(plotRecord(raw).key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return items.flatMap((raw) => {
    const row = plotRecord(raw),
      key = plotText(row.key);
    return /^[a-z][a-z0-9_]{0,31}$/.test(key) && counts.get(key) === 1
      ? [{ key, label: plotText(row.name) || plotText(row.title) || plotText(row.text) || key }]
      : [];
  });
}
export function plotRowEditable(content: PlotRecord, section: PlotSection, key: string) {
  return (
    plotCollectionEditable(content, section) &&
    /^[a-z][a-z0-9_]{0,31}$/.test(key) &&
    plotRows(content, section).filter((v) => plotRecord(v).key === key).length === 1
  );
}
function writePath(target: PlotRecord, path: PlotPath, value: unknown, remove = false) {
  if (
    !path.length ||
    path.some((p) => typeof p === 'string' && ['__proto__', 'constructor', 'prototype'].includes(p))
  )
    throw new PlotEditError('INVALID_PATH');
  let node: PlotRecord | unknown[] = target;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i]!,
      next = path[i + 1]!;
    const old = (node as PlotRecord)[part];
    if (old === undefined) (node as PlotRecord)[part] = typeof next === 'number' ? [] : {};
    else if (!isRecord(old) && !Array.isArray(old)) throw new PlotEditError('MALFORMED_BRANCH');
    node = (node as PlotRecord)[part] as PlotRecord;
  }
  const last = path[path.length - 1]!;
  if (remove) delete (node as PlotRecord)[last];
  else (node as PlotRecord)[last] = clonePlot(value);
}
function rowIndex(content: PlotRecord, section: PlotSection, key: string) {
  if (!plotRowEditable(content, section, key)) throw new PlotEditError('AMBIGUOUS_KEY');
  return plotRows(content, section).findIndex((v) => plotRecord(v).key === key);
}
export function patchPlotField(
  content: PlotRecord,
  section: PlotSection,
  key: string,
  path: PlotPath,
  value: unknown,
): PlotRecord {
  if (!path.length || path[0] === 'key' || path[0] === 'kind')
    throw new PlotEditError('STABLE_KEY');
  const index = rowIndex(content, section, key),
    next = clonePlot(content);
  const row = plotRecord(plotRows(next, section)[index]);
  if (section === 'candidates' && path[0] === 'timeline' && row.timeline === undefined)
    row.timeline = {
      stageKey: '',
      excludeIfResolved: [],
      alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
    };
  writePath(row, path, value);
  return next;
}
export function removePlotField(
  content: PlotRecord,
  section: PlotSection,
  key: string,
  path: PlotPath,
): PlotRecord {
  if (!['window', 'timeNote', 'placeKey'].includes(String(path[path.length - 1])))
    throw new PlotEditError('INVALID_REMOVE');
  const index = rowIndex(content, section, key),
    next = clonePlot(content);
  if (plotValue(plotRows(next, section)[index], path) === undefined) return next;
  writePath(plotRecord(plotRows(next, section)[index]), path, undefined, true);
  return next;
}
export function setPlotInitialStage(content: PlotRecord, key: string): PlotRecord {
  if (
    !plotCollectionEditable(content, 'stages') ||
    (key !== '' && !plotChoices(content, 'stages').some((s) => s.key === key))
  )
    throw new PlotEditError('INVALID_STAGE');
  const next = clonePlot(content);
  if (!isRecord(next.timeline)) throw new PlotEditError('MISSING_TIMELINE');
  next.timeline.initialStageKey = key;
  return next;
}
const limits = { history: 64, stages: 16, candidates: 32 };
export function addPlotRow(content: PlotRecord, section: PlotSection): PlotRecord {
  if (!plotCollectionEditable(content, section)) throw new PlotEditError('MALFORMED_COLLECTION');
  const rows = plotRows(content, section);
  if (rows.length >= limits[section]) throw new PlotEditError('ROW_LIMIT');
  const prefix = { history: 'fact', stages: 'stage', candidates: 'node' }[section];
  const reserved = new Set<string>();
  const collect = (v: unknown): void => {
    if (typeof v === 'string') reserved.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(content);
  let n = 1;
  while (reserved.has(`${prefix}_${n}`)) n++;
  const key = `${prefix}_${n}`,
    next = clonePlot(content);
  const row =
    section === 'history'
      ? {
          key,
          kind: 'established_fact',
          text: '',
          occurredAt: '',
          actorKeys: [],
          visibility: { kind: 'player' },
        }
      : section === 'stages'
        ? {
            key,
            title: '',
            order: Math.min(
              31,
              Math.max(-1, ...rows.map((r) => Number(plotRecord(r).order) || 0)) + 1,
            ),
            afterStageKeys: [],
          }
        : {
            key,
            kind: 'candidate',
            title: '',
            editorialIntent: '',
            actorKeys: [],
            prerequisites: [],
            mutuallyExclusiveNodeKeys: [],
            intent: { kind: 'editorial_only' },
          };
  if (section === 'stages' && next.timeline === undefined)
    next.timeline = { initialStageKey: key, stages: [row] };
  else writePath(next, basePath(section), [...rows, row]);
  return next;
}
/** Read every reference location, including future extensions. Never cascade-delete references. */
export function plotDeletionReferences(
  content: PlotRecord,
  section: PlotSection,
  key: string,
): string[] {
  const index = rowIndex(content, section, key),
    skip = [...basePath(section), index].join('.'),
    refs: string[] = [];
  const names =
    section === 'history'
      ? ['factKey', 'factKeys', 'knownFactKeys', 'historyFactKey']
      : section === 'stages'
        ? ['stageKey', 'initialStageKey', 'afterStageKeys']
        : ['nodeKey', 'mutuallyExclusiveNodeKeys', 'onDeclined', 'onSkipped', 'onExpired'];
  const ancestors = new Set<object>();
  function walk(v: unknown, path: (string | number)[]) {
    if (!v || typeof v !== 'object' || path.join('.') === skip || ancestors.has(v)) return;
    ancestors.add(v);
    for (const [name, value] of Object.entries(v)) {
      const next = [...path, name];
      if (names.includes(name) && (value === key || (Array.isArray(value) && value.includes(key))))
        refs.push(next.join('.'));
      walk(value, next);
    }
    ancestors.delete(v);
  }
  walk(content, []);
  return refs;
}
export function deletePlotRow(content: PlotRecord, section: PlotSection, key: string): PlotRecord {
  const refs = plotDeletionReferences(content, section, key);
  if (refs.length) throw new PlotEditError('REFERENCED', refs);
  const index = rowIndex(content, section, key),
    next = clonePlot(content);
  writePath(
    next,
    basePath(section),
    plotRows(content, section).filter((_, i) => i !== index),
  );
  return next;
}
export const plotOutcomes = [
  { key: 'committed', label: '已提交' },
  { key: 'declined', label: '已拒绝' },
  { key: 'skipped', label: '已跳过' },
  { key: 'expired', label: '已过期' },
];
export function plotIssues(content: PlotRecord): string[] {
  const result = PublishedWorldContentSchema.safeParse(content);
  if (result.success) return [];
  const local: string[] = [];
  const start = Date.parse(plotText(plotRecord(content.world).startAt));
  plotRows(content, 'history').forEach((raw, i) => {
    if (Date.parse(plotText(plotRecord(raw).occurredAt)) > start)
      local.push(`history.${i}.occurredAt：事实时间晚于世界起点`);
  });
  const messages: Record<string, string> = {
    future_in_history: '事实时间晚于世界起点',
    unknown_stage: '阶段引用不存在',
    reverse_stage_dependency: '前置阶段应排在当前阶段之前',
    stage_dependency_cycle: '阶段前置形成循环',
    candidate_dependency_cycle: '事件前置形成循环',
    contradictory_node_condition: '前置条件与排除条件矛盾',
    invalid_story_window: '窗口开始必须早于到期',
    start_outside_stage_window: '世界起点不在初阶段窗口内',
    fact_not_actor_visible: '已知事实超出人物可见范围',
    unknown_fact: '事实引用不存在',
    candidate_stage_missing: '请选择事件所属阶段',
    timeline_missing: '请先建立剧情阶段',
    not_before_at_or_after_deadline: '前置时间已经超过节点窗口',
    intent_actor_outside_node: '来信或邀约人物必须属于参与人物',
    reverse_alternative_stage: '替代节点不能回到更早阶段',
    node_window_outside_stage: '事件窗口超出所属阶段窗口',
  };
  return [
    ...new Set([
      ...local,
      ...result.error.issues
        .filter((i) =>
          ['history', 'timeline', 'candidates', 'initialKnowledge'].includes(String(i.path[0])),
        )
        .map(
          (i) =>
            `${i.path.join('.')}：${messages[i.message] ?? '字段尚未完整或不符合内容合同，请核对'}`,
        ),
    ]),
  ].slice(0, 12);
}
