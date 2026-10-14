'use client';

import { useState } from 'react';
import { PublisherScriptLibraryDialog } from './publisher-script-library-dialog.tsx';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import { conditionChoices } from './publisher-condition-model.ts';
import {
  plotRecord,
  plotArray,
  plotText,
  plotStrings,
  plotChoices,
  plotConditionText,
  plotOutcomeChoices,
  plotOutcomeLabel,
  plotDeletionReferences,
  plotRowEditable,
  clonePlot,
  deletePlotRow,
  setPlotEventLead,
} from './publisher-plot-model.ts';
import s from './publisher-script-library.module.css';

type Props = {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange(content: Record<string, unknown>): void;
};
type Choice = { key: string; label: string };
type Prerequisite = Record<string, unknown>;
const prerequisiteNames: Record<string, string> = {
  history_fact: '一件已发生的事',
  after_presented_node: '另一事件已经展开',
  after_committed_node: '另一事件已有进展',
  after_resolved_node: '另一事件出现指定结果',
  at_place: '玩家到达某个地点',
  not_before: '故事时间到达',
};
function choiceName(choices: Choice[], key: unknown) {
  return choices.find((choice) => choice.key === key)?.label || '原关联内容待核对';
}
function selectChoice(
  choices: Choice[],
  value: string,
  disabled: boolean,
  onChange: (value: string) => void,
  label: string,
) {
  const missing = value && !choices.some((choice) => choice.key === value);
  return (
    <label className={s.field}>
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">请选择</option>
        {missing && <option value={value}>原关联内容待核对</option>}
        {choices.map((choice) => (
          <option value={choice.key} key={choice.key}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PublisherScriptLibraryEditor({ content, disabled, onChange }: Props) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const validList = content.candidates === undefined || Array.isArray(content.candidates);
  const events = plotArray(content.candidates);
  const places = plotChoices(content, 'places');
  const actors = plotChoices(content, 'actors');
  const facts = plotChoices(content, 'history');
  const conditions = conditionChoices(content);
  const stages = plotChoices(content, 'stages');

  function patch(index: number, field: string, value: unknown) {
    if (
      disabled ||
      !validList ||
      !plotRowEditable(content, 'candidates', plotText(plotRecord(events[index]).key))
    )
      return;
    const next = clonePlot(content);
    const row = plotRecord(plotArray(next.candidates)[index]);
    row[field] = value;
    if (field === 'editorialIntent' && row.script !== undefined) row.script = value;
    onChange(next);
  }
  function patchActors(index: number, actorKeys: string[]) {
    if (
      disabled ||
      !validList ||
      actorKeys.length > 12 ||
      !plotRowEditable(content, 'candidates', plotText(plotRecord(events[index]).key))
    )
      return;
    const next = clonePlot(content);
    const row = plotRecord(plotArray(next.candidates)[index]);
    row.actorKeys = actorKeys;
    const intent = plotRecord(row.intent);
    if (
      intent.kind === 'director_event' &&
      intent.actorKey &&
      !actorKeys.includes(plotText(intent.actorKey))
    )
      row.intent = { ...intent, actorKey: '' };
    onChange(next);
  }
  function patchPrerequisite(index: number, itemIndex: number, field: string, value: unknown) {
    const row = plotRecord(events[index]);
    if (!Array.isArray(row.prerequisites)) return;
    const next = row.prerequisites.map((entry) => clonePlot(entry));
    plotRecord(next[itemIndex])[field] = value;
    patch(index, 'prerequisites', next);
  }
  function addPrerequisite(index: number, kind: string) {
    const row = plotRecord(events[index]);
    if (row.prerequisites !== undefined && !Array.isArray(row.prerequisites)) return;
    const existing = plotArray(row.prerequisites);
    if (existing.length >= 16) return;
    const otherEvents = plotChoices(content, 'candidates').filter((entry) => entry.key !== row.key);
    const next: Prerequisite = { kind };
    if (kind === 'history_fact') next.factKey = facts[0]?.key ?? '';
    else if (kind === 'at_place') next.placeKey = places[0]?.key ?? '';
    else if (kind === 'not_before') next.at = '';
    else {
      next.nodeKey = otherEvents[0]?.key ?? '';
      if (kind === 'after_resolved_node') next.outcomes = ['committed'];
    }
    patch(index, 'prerequisites', [...existing, next]);
  }
  function add() {
    if (disabled || !validList || events.length >= 32) return;
    const next = clonePlot(content);
    const items = plotArray(next.candidates);
    const reserved = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string') reserved.add(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(content);
    let i = 1;
    while (reserved.has(`event_new_${i}`)) i++;
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
    <section className={s.editor} aria-label="事件库">
      <header className={s.header}>
        <h3>事件库 · {events.length} 件事</h3>
        <div className={s.actions}>
          <button
            type="button"
            disabled={disabled || !validList}
            onClick={() => setImporting(true)}
          >
            导入事件与地点
          </button>
          <button
            type="button"
            disabled={disabled || !validList || events.length >= 32}
            onClick={add}
          >
            ＋ 添加事件
          </button>
        </div>
      </header>
      <p className={s.hint}>
        每件事都是故事可能走向，不必排成固定顺序。导演会结合人物和当前经历判断何时展开。
      </p>
      {!validList && <p className={s.error}>原事件列表待核对，内容已保留，暂不能添加或修改。</p>}
      {events.map((raw, index) => {
        const event = plotRecord(raw);
        const key = plotText(event.key);
        const editable = validList && plotRowEditable(content, 'candidates', key);
        const blocked = disabled || !editable;
        const opening = content.openingEventKey === key;
        const others = plotChoices(content, 'candidates').filter((entry) => entry.key !== key);
        const intent = plotRecord(event.intent);
        const actorKeys = plotStrings(event.actorKeys);
        const malformedActors =
          event.actorKeys !== undefined &&
          (!Array.isArray(event.actorKeys) ||
            event.actorKeys.length > 12 ||
            event.actorKeys.some((value) => typeof value !== 'string'));
        const malformedPrerequisites =
          event.prerequisites !== undefined && !Array.isArray(event.prerequisites);
        const prerequisites = plotArray(event.prerequisites);
        const refs = editable ? plotDeletionReferences(content, 'candidates', key) : [];
        const timeline = plotRecord(event.timeline);
        const window = plotRecord(timeline.window);
        const alternatives = plotRecord(timeline.alternatives);
        const exclusions = plotArray(timeline.excludeIfResolved);
        const mutualExclusions = plotStrings(event.mutuallyExclusiveNodeKeys);
        const existingConditions = plotStrings(event.conditionKeys);
        const hasArrangement = !!(
          event.timeline ||
          mutualExclusions.length ||
          existingConditions.length ||
          (event.direction && plotRecord(event.direction).mode !== 'optional') ||
          (event.intent && intent.kind !== 'director_event')
        );
        return (
          <article
            className={s.eventCard}
            key={key || index}
            aria-label={plotText(event.title) || '新事件'}
          >
            <div className={s.eventHeading}>
              <h4>
                {opening ? '开场 · ' : `${index + 1}. `}
                {plotText(event.title) || '新事件'}
              </h4>
              {opening && <span className={s.tag}>玩家进入时展开</span>}
            </div>
            {!editable && <p className={s.error}>这件事的关联信息待核对，原内容已保留。</p>}
            <label className={s.field}>
              事件标题
              <input
                value={plotText(event.title)}
                disabled={blocked || (event.title !== undefined && typeof event.title !== 'string')}
                maxLength={120}
                onChange={(change) => patch(index, 'title', change.target.value)}
              />
            </label>
            <label className={s.field}>
              事件内容
              <textarea
                rows={8}
                maxLength={16384}
                value={plotText(event.script ?? event.editorialIntent)}
                disabled={
                  blocked ||
                  (event.editorialIntent !== undefined && typeof event.editorialIntent !== 'string')
                }
                placeholder="写下主角可能遇到的事、人物反应与后续影响，不必指定发生日期。"
                onChange={(change) => patch(index, 'editorialIntent', change.target.value)}
              />
            </label>
            <div className={s.scene}>
              <label className={s.field}>
                场景
                <textarea
                  rows={3}
                  maxLength={1600}
                  value={plotText(event.sceneText)}
                  disabled={
                    blocked ||
                    (event.sceneText !== undefined && typeof event.sceneText !== 'string')
                  }
                  onChange={(change) => patch(index, 'sceneText', change.target.value)}
                />
              </label>
              {plotStrings(event.scenePlaceKeys).length > 0 && (
                <div className={s.tags} aria-label="场景地点">
                  {plotStrings(event.scenePlaceKeys).map((placeKey) => (
                    <span className={s.tag} key={placeKey}>
                      {choiceName(places, placeKey)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <details className={s.optional}>
              <summary>
                发生前提（选填）
                {prerequisites.length || existingConditions.length
                  ? ` · ${prerequisites.length + existingConditions.length} 条`
                  : ''}
              </summary>
              <p className={s.hint}>
                全部前提满足后，这件事才可被导演考虑；满足前提不代表它一定发生。
              </p>
              {malformedPrerequisites && <p className={s.error}>原前提暂不能编辑，内容已保留。</p>}
              {prerequisites.map((rawPrerequisite, itemIndex) => {
                const prerequisite = plotRecord(rawPrerequisite);
                const kind = plotText(prerequisite.kind);
                const choices =
                  kind === 'history_fact' ? facts : kind === 'at_place' ? places : others;
                const field =
                  kind === 'history_fact'
                    ? 'factKey'
                    : kind === 'at_place'
                      ? 'placeKey'
                      : 'nodeKey';
                return (
                  <div className={s.prerequisite} key={itemIndex}>
                    <strong>{prerequisiteNames[kind] || '原前提待核对'}</strong>
                    {kind !== 'not_before' &&
                      prerequisiteNames[kind] &&
                      selectChoice(
                        choices,
                        plotText(prerequisite[field]),
                        blocked || malformedPrerequisites,
                        (value) => patchPrerequisite(index, itemIndex, field, value),
                        kind === 'history_fact'
                          ? '哪件事'
                          : kind === 'at_place'
                            ? '哪个地点'
                            : '哪件事件',
                      )}
                    {kind === 'not_before' && (
                      <label className={s.field}>
                        不早于（北京时间）
                        <input
                          type="datetime-local"
                          value={publicationLocalTime(plotText(prerequisite.at))}
                          disabled={blocked || malformedPrerequisites}
                          onChange={(change) =>
                            patchPrerequisite(
                              index,
                              itemIndex,
                              'at',
                              publicationUtcTime(change.target.value),
                            )
                          }
                        />
                      </label>
                    )}
                    {kind === 'after_resolved_node' && (
                      <fieldset disabled={blocked || malformedPrerequisites} className={s.choices}>
                        <legend>哪些结果可以开启这件事</legend>
                        {plotOutcomeChoices(content, prerequisite.nodeKey).map((outcome) => {
                          const values = plotStrings(prerequisite.outcomes);
                          return (
                            <label key={outcome.key} className={s.check}>
                              <input
                                type="checkbox"
                                checked={values.includes(outcome.key)}
                                onChange={(change) =>
                                  patchPrerequisite(
                                    index,
                                    itemIndex,
                                    'outcomes',
                                    change.target.checked
                                      ? [...values, outcome.key]
                                      : values.filter((value) => value !== outcome.key),
                                  )
                                }
                              />
                              {outcome.label}
                            </label>
                          );
                        })}
                      </fieldset>
                    )}
                    {!prerequisiteNames[kind] && (
                      <p className={s.hint}>{plotConditionText(content, prerequisite)}</p>
                    )}
                    <button
                      type="button"
                      disabled={blocked || malformedPrerequisites}
                      onClick={() =>
                        patch(
                          index,
                          'prerequisites',
                          prerequisites.filter((_, i) => i !== itemIndex),
                        )
                      }
                    >
                      移除这条前提
                    </button>
                  </div>
                );
              })}
              {(!!conditions.length || !!existingConditions.length) && (
                <fieldset
                  disabled={
                    blocked ||
                    (event.conditionKeys !== undefined && !Array.isArray(event.conditionKeys))
                  }
                  className={s.choices}
                >
                  <legend>已有的其他条件（选填）</legend>
                  {conditions.map((condition) => (
                    <label key={condition.key} className={s.check}>
                      <input
                        type="checkbox"
                        checked={existingConditions.includes(condition.key)}
                        onChange={(change) => {
                          const next = change.target.checked
                            ? [...existingConditions, condition.key]
                            : existingConditions.filter((value) => value !== condition.key);
                          patch(index, 'conditionKeys', next);
                        }}
                      />
                      {condition.label}
                    </label>
                  ))}
                  {existingConditions
                    .filter(
                      (conditionKey) =>
                        !conditions.some((condition) => condition.key === conditionKey),
                    )
                    .map((conditionKey) => (
                      <label key={conditionKey} className={s.check}>
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            patch(
                              index,
                              'conditionKeys',
                              existingConditions.filter((value) => value !== conditionKey),
                            )
                          }
                        />
                        原关联条件待核对
                      </label>
                    ))}
                </fieldset>
              )}
              {event.conditionKeys !== undefined && !Array.isArray(event.conditionKeys) && (
                <p className={s.error}>原关联条件暂不能编辑，内容已保留。</p>
              )}
              <div className={s.actions}>
                <button
                  type="button"
                  disabled={
                    blocked || malformedPrerequisites || prerequisites.length >= 16 || !facts.length
                  }
                  onClick={() => addPrerequisite(index, 'history_fact')}
                >
                  ＋ 已发生的事
                </button>
                <button
                  type="button"
                  disabled={
                    blocked ||
                    malformedPrerequisites ||
                    prerequisites.length >= 16 ||
                    !others.length
                  }
                  onClick={() => addPrerequisite(index, 'after_presented_node')}
                >
                  ＋ 事件已展开
                </button>
                <button
                  type="button"
                  disabled={
                    blocked ||
                    malformedPrerequisites ||
                    prerequisites.length >= 16 ||
                    !others.length
                  }
                  onClick={() => addPrerequisite(index, 'after_committed_node')}
                >
                  ＋ 事件有进展
                </button>
                <button
                  type="button"
                  disabled={
                    blocked ||
                    malformedPrerequisites ||
                    prerequisites.length >= 16 ||
                    !others.length
                  }
                  onClick={() => addPrerequisite(index, 'after_resolved_node')}
                >
                  ＋ 指定结果
                </button>
                <button
                  type="button"
                  disabled={
                    blocked ||
                    malformedPrerequisites ||
                    prerequisites.length >= 16 ||
                    !places.length
                  }
                  onClick={() => addPrerequisite(index, 'at_place')}
                >
                  ＋ 到达地点
                </button>
              </div>
              <details className={s.nestedOptional}>
                <summary>原稿有明确日期时</summary>
                <button
                  type="button"
                  disabled={blocked || malformedPrerequisites || prerequisites.length >= 16}
                  onClick={() => addPrerequisite(index, 'not_before')}
                >
                  ＋ 到达指定时间
                </button>
              </details>
            </details>
            <details className={s.optional}>
              <summary>
                涉及人物（选填）{actorKeys.length ? ` · ${actorKeys.length} 人` : ''}
              </summary>
              {malformedActors && <p className={s.error}>原人物关联暂不能编辑，内容已保留。</p>}
              <fieldset className={s.choices} disabled={blocked || malformedActors}>
                <legend>哪些人物可能参与</legend>
                {actors.map((actor) => (
                  <label key={actor.key} className={s.check}>
                    <input
                      type="checkbox"
                      checked={actorKeys.includes(actor.key)}
                      onChange={(change) =>
                        patchActors(
                          index,
                          change.target.checked
                            ? [...actorKeys, actor.key]
                            : actorKeys.filter((value) => value !== actor.key),
                        )
                      }
                    />
                    {actor.label}
                  </label>
                ))}
                {actorKeys
                  .filter((actorKey) => !actors.some((actor) => actor.key === actorKey))
                  .map((actorKey) => (
                    <label key={actorKey} className={s.check}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          patchActors(
                            index,
                            actorKeys.filter((value) => value !== actorKey),
                          )
                        }
                      />
                      原关联人物待核对
                    </label>
                  ))}
                {!actors.length && <p className={s.hint}>添加人物后可在这里选择。</p>}
              </fieldset>
              {intent.kind === 'director_event' &&
                selectChoice(
                  actors,
                  plotText(intent.actorKey),
                  blocked ||
                    malformedActors ||
                    Object.keys(intent).some((field) => !['kind', 'actorKey'].includes(field)),
                  (actorKey) => {
                    if (!blocked) onChange(setPlotEventLead(content, key, actorKey));
                  },
                  '由谁先开启互动（选填）',
                )}
            </details>
            <details className={s.optional}>
              <summary>其他安排（选填）{hasArrangement ? ' · 已有设置' : ''}</summary>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={opening}
                  disabled={blocked || intent.kind !== 'director_event'}
                  onChange={(change) => {
                    if (blocked) return;
                    const next = clonePlot(content);
                    if (change.target.checked) next.openingEventKey = key;
                    else delete next.openingEventKey;
                    onChange(next);
                  }}
                />
                作为开场事件
              </label>
              {intent.kind !== 'director_event' && (
                <p className={s.hint}>原稿中的来信、邀约或备注类型保持原样。</p>
              )}
              {event.direction !== undefined && (
                <p className={s.hint}>
                  推进方式：
                  {plotRecord(event.direction).mode === 'required'
                    ? '剧情需要推进'
                    : plotRecord(event.direction).mode === 'optional'
                      ? '由导演择机演绎'
                      : '原推进安排待核对'}
                </p>
              )}
              {plotText(timeline.stageKey) && (
                <p className={s.hint}>所属阶段：{choiceName(stages, timeline.stageKey)}</p>
              )}
              {timeline.window !== undefined && (
                <p className={s.hint}>
                  原稿限定时段：
                  {publicationLocalTime(plotText(window.notBefore)).replace('T', ' ') ||
                    '开始待核对'}{' '}
                  至{' '}
                  {publicationLocalTime(plotText(window.expiresAt)).replace('T', ' ') ||
                    '结束待核对'}
                </p>
              )}
              {plotText(timeline.timeNote) && (
                <p className={s.hint}>时间备注：{plotText(timeline.timeNote)}</p>
              )}
              {mutualExclusions.map((otherKey) => (
                <p className={s.hint} key={otherKey}>
                  与「{choiceName(others, otherKey)}」互斥
                </p>
              ))}
              {exclusions.map((rawExclusion, i) => {
                const exclusion = plotRecord(rawExclusion);
                return (
                  <p className={s.hint} key={i}>
                    「{choiceName(others, exclusion.nodeKey)}」出现
                    {plotStrings(exclusion.outcomes)
                      .map((outcome) => plotOutcomeLabel(content, exclusion.nodeKey, outcome))
                      .join(' / ') || '指定结果'}
                    后，不再考虑这件事。
                  </p>
                );
              })}
              {(['onDeclined', 'onSkipped', 'onExpired'] as const).map((name) =>
                plotStrings(alternatives[name]).length ? (
                  <p className={s.hint} key={name}>
                    {name === 'onDeclined' ? '被拒绝' : name === 'onSkipped' ? '被跳过' : '已过期'}
                    后可考虑：
                    {plotStrings(alternatives[name])
                      .map((item) => choiceName(others, item))
                      .join('、')}
                  </p>
                ) : null,
              )}
              {event.timeline !== undefined &&
                !timeline.stageKey &&
                !timeline.window &&
                !timeline.timeNote &&
                !exclusions.length &&
                !Object.values(alternatives).some((value) => plotStrings(value).length) && (
                  <p className={s.hint}>原有阶段安排已保留。</p>
                )}
              <p className={s.hint}>旧安排会随草稿保存，改动事件内容不会覆盖这些设置。</p>
              <button
                type="button"
                disabled={blocked || refs.length > 0}
                onClick={() => {
                  if (blocked || refs.length) return;
                  try {
                    const next = clonePlot(content);
                    if (opening) delete next.openingEventKey;
                    onChange(deletePlotRow(next, 'candidates', key));
                    setError('');
                  } catch {
                    setError('这件事被其他安排引用，请先调整关联再删除。');
                  }
                }}
              >
                删除事件
              </button>
              {refs.length > 0 && (
                <p className={s.hint}>这件事仍被其他内容关联，调整关联后可删除。</p>
              )}
            </details>
          </article>
        );
      })}
      {!events.length && validList && (
        <p className={s.hint}>还没有事件。可导入文稿，或添加第一件事。</p>
      )}
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
