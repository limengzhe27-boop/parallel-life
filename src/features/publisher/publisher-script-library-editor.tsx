'use client';
import { useState } from 'react';
import { PublisherScriptLibraryDialog } from './publisher-script-library-dialog.tsx';
import {
  plotRecord,
  plotArray,
  plotText,
  plotStrings,
  clonePlot,
  deletePlotRow,
} from './publisher-plot-model.ts';
import s from './publisher-script-library.module.css';
type Props = {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange(content: Record<string, unknown>): void;
};
export function PublisherScriptLibraryEditor({ content, disabled, onChange }: Props) {
  const [importing, setImporting] = useState(false),
    [error, setError] = useState('');
  const events = plotArray(content.candidates),
    places = plotArray(content.places).map(plotRecord);
  function patch(index: number, field: string, value: unknown) {
    if (disabled) return;
    const next = clonePlot(content),
      items = plotArray(next.candidates);
    const row = plotRecord(items[index]);
    row[field] = value;
    if (field === 'editorialIntent' && row.script !== undefined) row.script = value;
    onChange(next);
  }
  function add() {
    if (disabled || events.length >= 32) return;
    const next = clonePlot(content);
    const items = plotArray(next.candidates);
    let i = 1;
    while (items.some((e) => plotRecord(e).key === `event_new_${i}`)) i++;
    next.candidates = [
      ...items,
      {
        key: `event_new_${i}`,
        kind: 'candidate',
        title: '',
        editorialIntent: '',
        actorKeys: [],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
        direction: { mode: 'optional' },
      },
    ];
    onChange(next);
  }
  return (
    <section className={s.editor} aria-label="剧情与地点库">
      <header className={s.header}>
        <h3>事件库 · {events.length} 件事</h3>
        <div className={s.actions}>
          <button type="button" disabled={disabled} onClick={() => setImporting(true)}>
            导入事件与地点
          </button>
          <button type="button" disabled={disabled || events.length >= 32} onClick={add}>
            ＋ 添加事件
          </button>
        </div>
      </header>
      <p className={s.hint}>
        写下主角可能遇到的事。导演根据人物、当前经历和正文选择如何展开；编号只用于整理。
      </p>
      <details className={s.card}>
        <summary>地点库 · {places.length} 个地点</summary>
        <div className={s.tags}>
          {places.map((p) => (
            <span className={s.tag} key={plotText(p.key)}>
              {plotText(p.name)}
            </span>
          ))}
        </div>
        <p className={s.hint}>来自地址汇总与场景。列入地点库不代表玩家已经到达。</p>
      </details>
      {events.map((raw, i) => {
        const e = plotRecord(raw),
          key = plotText(e.key),
          opening = content.openingEventKey === key;
        return (
          <details className={s.card} key={key || i} open={!plotText(e.title)}>
            <summary>
              {opening
                ? '开场 · '
                : `${events.slice(0, i + 1).filter((item) => plotRecord(item).key !== content.openingEventKey).length}. `}
              {plotText(e.title) || '新事件'}
            </summary>
            <label className={s.field}>
              事件标题
              <input
                value={plotText(e.title)}
                disabled={disabled}
                maxLength={120}
                onChange={(ev) => patch(i, 'title', ev.target.value)}
              />
            </label>
            {plotText(e.sceneText) && <p className={s.hint}>场景：{plotText(e.sceneText)}</p>}
            <div className={s.tags}>
              {plotStrings(e.scenePlaceKeys).map((k) => (
                <span className={s.tag} key={k}>
                  {plotText(places.find((p) => p.key === k)?.name)}
                </span>
              ))}
            </div>
            <label className={s.field}>
              事件内容
              <textarea
                rows={8}
                maxLength={16384}
                value={plotText(e.script ?? e.editorialIntent)}
                disabled={disabled}
                placeholder="可以直接写处境、可能的前提、人物反应和后续影响，不需要填写具体日期。"
                onChange={(ev) => patch(i, 'editorialIntent', ev.target.value)}
              />
            </label>
            <div className={s.actions}>
              {plotRecord(e.intent).kind === 'director_event' && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    const next = clonePlot(content);
                    if (opening) delete next.openingEventKey;
                    else next.openingEventKey = key;
                    onChange(next);
                  }}
                >
                  {opening ? '取消开场指定' : '设为开场事件'}
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  try {
                    const next = clonePlot(content);
                    if (opening) delete next.openingEventKey;
                    onChange(deletePlotRow(next, 'candidates', key));
                    setError('');
                  } catch {
                    setError('这条事件被其他安排引用，请先解除引用再删除。');
                  }
                }}
              >
                删除事件
              </button>
            </div>
          </details>
        );
      })}
      {!events.length && <p className={s.hint}>粘贴一份事件文稿，或添加第一件事。</p>}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {importing && (
        <PublisherScriptLibraryDialog
          content={content}
          disabled={disabled}
          onClose={() => setImporting(false)}
          onApply={onChange}
        />
      )}
    </section>
  );
}
