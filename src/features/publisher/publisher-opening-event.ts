import {
  addPlotRow,
  clonePlot,
  plotChoices,
  plotRecord,
  plotRows,
  plotRowEditable,
  plotText,
  patchPlotField,
  PlotEditError,
  type PlotRecord,
} from './publisher-plot-model.ts';
export function openingEventChoices(content: PlotRecord) {
  return plotChoices(content, 'candidates').filter((choice) =>
    plotRows(content, 'candidates').some((raw) => {
      const row = plotRecord(raw);
      return row.key === choice.key && plotRecord(row.intent).kind === 'director_event';
    }),
  );
}
export function selectedOpeningEvent(content: PlotRecord): PlotRecord | null {
  const key = plotText(content.openingEventKey);
  if (!key || !plotRowEditable(content, 'candidates', key)) return null;
  const row = plotRecord(
    plotRows(content, 'candidates').find((raw) => plotRecord(raw).key === key),
  );
  return plotRecord(row.intent).kind === 'director_event' ? row : null;
}
export function chooseOpeningEvent(content: PlotRecord, key: string): PlotRecord {
  if (content.openingEventKey !== undefined && typeof content.openingEventKey !== 'string')
    throw new PlotEditError('MALFORMED_BRANCH');
  if (!openingEventChoices(content).some((option) => option.key === key))
    throw new PlotEditError('INVALID_OPENING_EVENT');
  const next = clonePlot(content);
  next.openingEventKey = key;
  return next;
}
export function clearOpeningEvent(content: PlotRecord): PlotRecord {
  if (content.openingEventKey !== undefined && typeof content.openingEventKey !== 'string')
    throw new PlotEditError('MALFORMED_BRANCH');
  const next = clonePlot(content);
  delete next.openingEventKey;
  return next;
}
export function addOpeningEvent(content: PlotRecord): PlotRecord {
  if (content.openingEventKey !== undefined)
    throw new PlotEditError('OPENING_EVENT_ALREADY_SELECTED');
  const next = addPlotRow(content, 'candidates');
  const row = plotRecord(plotRows(next, 'candidates').at(-1));
  row.title = '开场事件';
  next.openingEventKey = row.key;
  return next;
}
export function patchOpeningEvent(
  content: PlotRecord,
  field: 'title' | 'editorialIntent',
  value: string,
): PlotRecord {
  const row = selectedOpeningEvent(content);
  if (!row) throw new PlotEditError('INVALID_OPENING_EVENT');
  if (row[field] !== undefined && typeof row[field] !== 'string')
    throw new PlotEditError('MALFORMED_BRANCH');
  return patchPlotField(content, 'candidates', plotText(row.key), [field], value);
}
