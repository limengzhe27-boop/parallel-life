import {
  clonePlot,
  plotArray,
  plotRecord,
  plotText,
  plotRowEditable,
  patchPlotField,
  PlotEditError,
} from './publisher-plot-model.ts';

type Content = Record<string, unknown>;
export function conditionChoiceLabel(
  option: { key: string; label: string },
  options: { key: string; label: string }[],
) {
  const label = option.label === option.key ? '待命名条目' : option.label;
  const same = options.filter((o) => o.label === option.label);
  return same.length > 1
    ? `${label}（第${same.findIndex((o) => o.key === option.key) + 1}项）`
    : label;
}
export function conditionChoices(content: Content) {
  const rows = plotArray(content.conditions).map(plotRecord);
  return rows.flatMap((row) => {
    const key = plotText(row.key);
    return /^[a-z][a-z0-9_]{0,31}$/.test(key) && rows.filter((r) => r.key === key).length === 1
      ? [{ key, label: plotText(row.title) || '未命名条件' }]
      : [];
  });
}
export function addCondition(content: Content): { content: Content; key: string } {
  if (content.conditions !== undefined && !Array.isArray(content.conditions))
    throw new PlotEditError('MALFORMED_COLLECTION');
  if (plotArray(content.conditions).length >= 32) throw new PlotEditError('ROW_LIMIT');
  const reserved = new Set<string>();
  const collect = (v: unknown) => {
    if (typeof v === 'string') reserved.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(content);
  let i = 1;
  while (reserved.has(`condition_${i}`)) i++;
  const key = `condition_${i}`;
  return {
    key,
    content: {
      ...clonePlot(content),
      conditions: [
        ...plotArray(content.conditions),
        { key, title: '新的条件', match: 'all', prerequisites: [] },
      ],
    },
  };
}
export function updateCondition(content: Content, key: string, changes: Content): Content {
  if (!conditionChoices(content).some((c) => c.key === key))
    throw new PlotEditError('AMBIGUOUS_KEY');
  if (Object.keys(changes).some((k) => !['title', 'match', 'prerequisites'].includes(k)))
    throw new PlotEditError('INVALID_PATH');
  return {
    ...clonePlot(content),
    conditions: plotArray(content.conditions).map((r) =>
      plotRecord(r).key === key
        ? { ...clonePlot(plotRecord(r)), ...clonePlot(changes) }
        : clonePlot(r),
    ),
  };
}
export function linkCondition(
  content: Content,
  key: string,
  nodeKey: string,
  linked: boolean,
): Content {
  if (
    !conditionChoices(content).some((c) => c.key === key) ||
    !plotRowEditable(content, 'candidates', nodeKey)
  )
    throw new PlotEditError('AMBIGUOUS_KEY');
  const node = plotArray(content.candidates)
    .map(plotRecord)
    .find((n) => n.key === nodeKey)!;
  if (
    node.conditionKeys !== undefined &&
    (!Array.isArray(node.conditionKeys) || node.conditionKeys.some((k) => typeof k !== 'string'))
  )
    throw new PlotEditError('MALFORMED_BRANCH');
  const keys = (node.conditionKeys ?? []) as string[];
  const next = linked
    ? keys.includes(key)
      ? keys
      : [...keys, key]
    : keys.filter((k) => k !== key);
  if (next.length > 16) throw new PlotEditError('ROW_LIMIT');
  return patchPlotField(content, 'candidates', nodeKey, ['conditionKeys'], next);
}
export function deleteCondition(content: Content, key: string): Content {
  if (!conditionChoices(content).some((c) => c.key === key))
    throw new PlotEditError('AMBIGUOUS_KEY');
  if (
    plotArray(content.candidates).some((n) => plotArray(plotRecord(n).conditionKeys).includes(key))
  )
    throw new PlotEditError('REFERENCED');
  return {
    ...clonePlot(content),
    conditions: plotArray(content.conditions).filter((r) => plotRecord(r).key !== key),
  };
}
