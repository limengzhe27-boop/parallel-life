'use client';
import { useState } from 'react';
import {
  addCondition,
  updateCondition,
  linkCondition,
  deleteCondition,
  conditionChoices,
  conditionChoiceLabel,
} from './publisher-condition-model.ts';
import {
  plotArray,
  plotRecord,
  plotText,
  plotChoices,
  plotConditionText,
  plotOutcomeChoices,
} from './publisher-plot-model.ts';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import s from './publisher-condition-editor.module.css';

type Props = {
  content: Record<string, unknown>;
  disabled: boolean;
  selectedKey?: string;
  onSelect: (key: string) => void;
  onChange: (content: Record<string, unknown>) => void;
};
const kinds = {
  history_fact: '已确立的事实',
  after_resolved_node: '某件事出现指定结果',
  at_place: '玩家所在地点',
  not_before: '故事时间到达',
  after_committed_node: '来信已发出或邀约已接受',
};
export function PublisherConditionEditor({
  content,
  disabled,
  selectedKey,
  onSelect,
  onChange,
}: Props) {
  const [error, setError] = useState('');
  const choices = conditionChoices(content);
  const selected = choices.find((c) => c.key === selectedKey) ?? choices[0];
  const row = selected
    ? plotArray(content.conditions)
        .map(plotRecord)
        .find((r) => r.key === selected.key)
    : undefined;
  const terms = plotArray(row?.prerequisites);
  const run = (change: () => Record<string, unknown>) => {
    if (disabled) return;
    try {
      onChange(change());
      setError('');
    } catch {
      setError('暂不能修改，请先解除关联或核对这条条件。原有内容已保留。');
    }
  };
  const patch = (change: Record<string, unknown>) => {
    if (selected) run(() => updateCondition(content, selected.key, change));
  };
  const patchTerm = (i: number, change: Record<string, unknown>) =>
    patch({
      prerequisites: terms.map((t, index) => (index === i ? { ...plotRecord(t), ...change } : t)),
    });
  const select = (
    label: string,
    value: unknown,
    options: { key: string; label: string }[],
    change: (value: string) => void,
  ) => (
    <label className={s.field}>
      {label}
      <select disabled={disabled} value={plotText(value)} onChange={(e) => change(e.target.value)}>
        <option value="">请选择</option>
        {!!value && !options.some((o) => o.key === value) && (
          <option value={plotText(value)}>原关联待核对</option>
        )}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {conditionChoiceLabel(o, options)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section id="publisher-conditions" className={s.root} aria-label="独立条件">
      <div className={s.heading}>
        <div>
          <h3>条件节点</h3>
          <p>把一个判断连接到多件事；条件成立后，相关事件才可以发生。</p>
        </div>
        <button
          type="button"
          disabled={disabled || choices.length >= 32}
          onClick={() =>
            run(() => {
              const next = addCondition(content);
              onSelect(next.key);
              return next.content;
            })
          }
        >
          新增条件
        </button>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {!row || !selected ? (
        <p className={s.empty}>尚未添加独立条件。事件里原有的简单条件仍然有效。</p>
      ) : (
        <div className={s.body}>
          <nav className={s.list} aria-label="选择条件">
            {choices.map((c) => (
              <button
                type="button"
                key={c.key}
                aria-pressed={c.key === selected.key}
                onClick={() => onSelect(c.key)}
              >
                {conditionChoiceLabel(c, choices)}
              </button>
            ))}
          </nav>
          <div className={s.editor}>
            <label className={s.field}>
              条件名称
              <input
                disabled={disabled}
                maxLength={120}
                value={plotText(row.title)}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="例如：可以当面对质了"
              />
            </label>
            {select(
              '怎样才算满足',
              row.match,
              [
                { key: 'all', label: '以下条件全部满足' },
                { key: 'any', label: '以下条件任意一项满足' },
              ],
              (match) => patch({ match }),
            )}
            {terms.map((raw, i) => {
              const term = plotRecord(raw),
                kind = plotText(term.kind);
              return (
                <div className={s.term} key={i}>
                  <div className={s.heading}>
                    <strong>{kinds[kind as keyof typeof kinds] ?? '原条件待核对'}</strong>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        patch({ prerequisites: terms.filter((_, index) => index !== i) })
                      }
                    >
                      移除
                    </button>
                  </div>
                  {kind === 'history_fact' &&
                    select(
                      '已发生的事实',
                      term.factKey,
                      plotChoices(content, 'history'),
                      (factKey) => patchTerm(i, { factKey }),
                    )}
                  {(kind === 'after_resolved_node' || kind === 'after_committed_node') &&
                    select(
                      '关联事件',
                      term.nodeKey,
                      plotChoices(content, 'candidates'),
                      (nodeKey) => patchTerm(i, { nodeKey }),
                    )}
                  {kind === 'after_resolved_node' && (
                    <fieldset>
                      <legend>允许的结果（任意一种）</legend>
                      {plotOutcomeChoices(content, term.nodeKey).map((o) => (
                        <label className={s.check} key={o.key}>
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={plotArray(term.outcomes).includes(o.key)}
                            onChange={(e) =>
                              patchTerm(i, {
                                outcomes: e.target.checked
                                  ? [...plotArray(term.outcomes), o.key]
                                  : plotArray(term.outcomes).filter((v) => v !== o.key),
                              })
                            }
                          />
                          {o.label}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {kind === 'at_place' &&
                    select(
                      '玩家所在地点',
                      term.placeKey,
                      plotChoices(content, 'places'),
                      (placeKey) => patchTerm(i, { placeKey }),
                    )}
                  {kind === 'not_before' && (
                    <label className={s.field}>
                      指定故事时间（北京时间）
                      <input
                        type="datetime-local"
                        disabled={disabled}
                        value={publicationLocalTime(plotText(term.at))}
                        onChange={(e) => patchTerm(i, { at: publicationUtcTime(e.target.value) })}
                      />
                    </label>
                  )}
                  <p>{plotConditionText(content, term)}</p>
                </div>
              );
            })}
            {!terms.length && <p>添加至少一个判断，再连接要影响的事件。</p>}
            <div className={s.add}>
              {Object.entries(kinds)
                .filter(([kind]) => kind !== 'after_committed_node')
                .map(([kind, label]) => (
                  <button
                    type="button"
                    key={kind}
                    disabled={
                      disabled ||
                      terms.length >= 16 ||
                      (row.prerequisites !== undefined && !Array.isArray(row.prerequisites))
                    }
                    onClick={() =>
                      patch({
                        prerequisites: [
                          ...terms,
                          kind === 'history_fact'
                            ? { kind, factKey: '' }
                            : kind === 'at_place'
                              ? { kind, placeKey: '' }
                              : kind === 'not_before'
                                ? { kind, at: '' }
                                : { kind, nodeKey: '', outcomes: [] },
                        ],
                      })
                    }
                  >
                    ＋ {label}
                  </button>
                ))}
            </div>
            <fieldset>
              <legend>连接到哪些事件</legend>
              <p>勾选后自动连线。一个事件连接多个条件节点时，需要全部满足。</p>
              {plotChoices(content, 'candidates').map((node) => (
                <label className={s.check} key={node.key}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={plotArray(
                      plotArray(content.candidates)
                        .map(plotRecord)
                        .find((n) => n.key === node.key)?.conditionKeys,
                    ).includes(selected.key)}
                    onChange={(e) =>
                      run(() => linkCondition(content, selected.key, node.key, e.target.checked))
                    }
                  />
                  {conditionChoiceLabel(node, plotChoices(content, 'candidates'))}
                </label>
              ))}
              {!plotChoices(content, 'candidates').length && <p>添加事件后可以在这里连接。</p>}
            </fieldset>
            <button
              type="button"
              disabled={disabled}
              onClick={() => run(() => deleteCondition(content, selected.key))}
            >
              删除此条件
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
