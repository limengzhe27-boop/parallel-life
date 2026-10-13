'use client';
import { publicationLocalTime, publicationUtcTime } from './publisher-story-time.ts';
import type { ReactNode } from 'react';
import {
  addPlotRow,
  deletePlotRow,
  patchPlotField,
  removePlotField,
  setPlotInitialStage,
  plotRecord,
  plotText,
  plotArray,
  plotStrings,
  plotValue,
  plotRows,
  plotChoices,
  plotCollectionEditable,
  plotRowEditable,
  plotDeletionReferences,
  plotIssues,
  plotOutcomes,
  type PlotRecord,
  type PlotSection,
  type PlotPath,
  type PlotChoice,
} from './publisher-plot-model.ts';
import s from './publisher-plot-editor.module.css';
export type PublisherPlotEditorProps = {
  content: Record<string, unknown>;
  disabled: boolean;
  onChange: (next: Record<string, unknown>) => void;
};
const sections = {
  history: {
    title: '1. 已经发生的事',
    help: '只写世界开场前已确立的事情，时间不晚于起点。未来可能发生的事放在可能发生的剧情。',
    add: '新增事实',
    limit: 64,
  },
  stages: {
    title: '2. 剧情阶段',
    help: '按故事的先后组织阶段，不必逐个填写日期，也不代表玩家必须逐项完成。',
    add: '新增阶段',
    limit: 16,
  },
  candidates: {
    title: '3. 可能发生的剧情',
    help: '先写人物、内容和出现条件。日期限制可不填；条件满足后仍是可能发生，不是已经发生。',
    add: '新增事件',
    limit: 32,
  },
};
const conditionNames = {
  history_fact: '某事实已成立',
  after_committed_node: '上一事件已落实',
  after_resolved_node: '上一事件被拒绝、跳过或有其他结果',
  at_place: '玩家在某地点',
  not_before: '世界时间已到达',
};
const intentNames = {
  editorial_only: '仅备注',
  offer_message: '角色来信',
  offer_invitation: '发出邀约',
};
const timeLabel = (raw: unknown) => publicationLocalTime(plotText(raw)).replace('T', ' ');
function choiceLabel(option: PlotChoice, options: PlotChoice[]) {
  const label = option.label === option.key ? '待命名条目' : option.label;
  const same = options.filter((o) => o.label === option.label);
  return same.length > 1
    ? `${label}（第${same.findIndex((o) => o.key === option.key) + 1}项）`
    : label;
}
function issueText(issue: string) {
  const [path, ...reason] = issue.split('：');
  const parts = (path ?? '').split('.');
  const section =
    (
      {
        history: '已发生的事',
        candidates: '可能发生的剧情',
        timeline: '剧情阶段',
        initialKnowledge: '人物知情',
      } as Record<string, string>
    )[parts[0] ?? ''] ?? '剧情设置';
  const index = parts.find((p) => /^\d+$/u.test(p));
  const field = (
    {
      occurredAt: '发生时间',
      at: '时间',
      earliestAt: '邀约时间',
      stageKey: '所属阶段',
      order: '阶段顺序',
      text: '正文',
      title: '标题',
      actorKey: '人物',
      actorKeys: '参与人物',
      visibility: '可见范围',
    } as Record<string, string>
  )[parts.at(-1) ?? ''];
  return `${section}${index === undefined ? '' : `第${Number(index) + 1}项`}${field ? ` · ${field}` : ''}：${reason.join('：') || '请核对内容'}`;
}
function refsControl(
  label: string,
  raw: unknown,
  options: PlotChoice[],
  disabled: boolean,
  onChange: (v: string[]) => void,
) {
  const values = plotStrings(raw),
    malformed =
      raw !== undefined && (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string'));
  const missing = values.filter((k) => !options.some((o) => o.key === k));
  const choices = [...options, ...missing.map((key) => ({ key, label: '未找到原引用' }))];
  return (
    <fieldset className={s.choices} disabled={disabled || malformed}>
      <legend>{label}</legend>
      {malformed ? (
        <p className={s.error}>原引用格式待核对，内容保留，请核对导入稿。</p>
      ) : choices.length ? (
        choices.map((o) => (
          <label className={s.check} key={o.key}>
            <input
              type="checkbox"
              checked={values.includes(o.key)}
              onChange={(e) => {
                if (!disabled && !malformed)
                  onChange(
                    e.target.checked ? [...values, o.key] : values.filter((k) => k !== o.key),
                  );
              }}
            />
            {choiceLabel(o, options)}
          </label>
        ))
      ) : (
        <p className={s.hint}>请先新增对应条目。</p>
      )}
    </fieldset>
  );
}
function selectControl(
  label: string,
  value: string,
  options: PlotChoice[],
  disabled: boolean,
  onChange: (v: string) => void,
  id: string,
) {
  const missing = value && !options.some((o) => o.key === value);
  return (
    <label className={s.field} htmlFor={id}>
      {label}
      <select
        id={id}
        className={s.input}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (!disabled) onChange(e.target.value);
        }}
      >
        <option value="">请选择（可暂留空）</option>
        {missing && <option value={value}>未找到原引用（{value}）</option>}
        {options.map((o) => (
          <option value={o.key} key={o.key}>
            {choiceLabel(o, options)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PublisherPlotEditor({ content, disabled, onChange }: PublisherPlotEditorProps) {
  const actors = plotChoices(content, 'actors'),
    places = plotChoices(content, 'places'),
    facts = plotChoices(content, 'history'),
    stages = plotChoices(content, 'stages'),
    nodes = plotChoices(content, 'candidates');
  const issues = plotIssues(content),
    start = plotText(plotRecord(content.world).startAt);
  function emit(next: () => PlotRecord) {
    if (!disabled) onChange(next());
  }
  function rowForm(section: PlotSection, raw: unknown, index: number): ReactNode {
    const row = plotRecord(raw),
      key = plotText(row.key),
      editable = plotRowEditable(content, section, key),
      blocked = disabled || !editable;
    const refs = editable ? plotDeletionReferences(content, section, key) : [];
    const otherNodes = nodes.filter((n) => n.key !== key),
      otherStages = stages.filter((n) => n.key !== key);
    const id = (path: PlotPath) => `plot_${section}_${key}_${index}_${path.join('_')}`;
    function branchBlocked(path: PlotPath) {
      for (let n = 1; n < path.length; n++) {
        const value = plotValue(row, path.slice(0, n));
        if (
          value !== undefined &&
          (typeof value !== 'object' ||
            value === null ||
            (typeof path[n] === 'number' ? !Array.isArray(value) : Array.isArray(value)))
        )
          return true;
      }
      return blocked;
    }
    const patch = (path: PlotPath, value: unknown) => {
      if (!branchBlocked(path)) emit(() => patchPlotField(content, section, key, path, value));
    };
    function field(
      label: string,
      path: PlotPath,
      help = '',
      multiline = false,
      maxLength?: number,
    ) {
      const value = plotValue(row, path),
        lock = branchBlocked(path),
        props = {
          id: id(path),
          className: s.input,
          value: plotText(value),
          disabled: lock,
          maxLength,
          onChange: (e: { target: { value: string } }) => patch(path, e.target.value),
        };
      const timeField = ['occurredAt', 'notBefore', 'expiresAt', 'earliestAt', 'at'].includes(
        String(path[path.length - 1]),
      );
      const control = (
        <label className={`${s.field} ${multiline ? s.wide : ''}`} htmlFor={id(path)}>
          {label}
          {timeField ? (
            <input
              {...props}
              type="datetime-local"
              value={publicationLocalTime(plotText(value))}
              onChange={(e) => patch(path, publicationUtcTime(e.target.value))}
            />
          ) : multiline ? (
            <textarea {...props} />
          ) : (
            <input {...props} />
          )}{' '}
          {timeField ? (
            <span className={s.hint}>
              按世界当地日期和时间填写（北京时间），无需填写时间代码。
              {typeof value === 'string' && value && !publicationLocalTime(value)
                ? ' 原稿时间格式待修正，未修改前保持原值。'
                : ''}
            </span>
          ) : (
            help && <span className={s.hint}>{help}</span>
          )}
          {value !== undefined && typeof value !== 'string' && (
            <span className={s.error}>原字段不是文字，未编辑前保持原值。</span>
          )}
          {lock && !blocked && <span className={s.error}>原上层字段格式待核对，未替换原稿。</span>}
        </label>
      );
      if (!timeField || ['notBefore', 'expiresAt'].includes(String(path.at(-1)))) return control;
      const needsTime = !timeLabel(value);
      return (
        <details className={`${s.advanced} ${s.wide}`} open={needsTime}>
          <summary className={s.summary}>
            {label} · {needsTime ? '待补齐' : timeLabel(value)}
          </summary>
          <div className={s.advancedBody}>
            {needsTime && (
              <p className={s.error}>
                这项时间会影响试演，可使用页面上方“安排缺省时间”，再核对结果。
              </p>
            )}
            {control}
          </div>
        </details>
      );
    }
    function refsField(label: string, path: PlotPath, options: PlotChoice[]) {
      return (
        <div className={s.wide}>
          {refsControl(label, plotValue(row, path), options, branchBlocked(path), (values) =>
            patch(path, values),
          )}
        </div>
      );
    }
    function selectField(label: string, path: PlotPath, options: PlotChoice[]) {
      const visibility = path.join('.') === 'visibility.kind';
      const original = plotRecord(row.visibility);
      const unknown =
        visibility && Object.keys(original).some((k) => !['kind', 'actorKeys'].includes(k));
      return (
        <>
          {selectControl(
            label,
            plotText(plotValue(row, path)),
            options,
            branchBlocked(path) || unknown,
            (value) => {
              if (visibility) {
                if (!unknown && !branchBlocked(path))
                  patch(
                    ['visibility'],
                    value === 'actors'
                      ? { kind: value, actorKeys: plotStrings(original.actorKeys) }
                      : { kind: value },
                  );
              } else if (path.length === 1 && path[0] === 'placeKey' && value === '') {
                if (!blocked) emit(() => removePlotField(content, section, key, path));
              } else patch(path, value);
            },
            id(path),
          )}
          {unknown && (
            <span className={s.error}>原可见范围含未知字段，保留原稿，暂不切换范围。</span>
          )}
        </>
      );
    }
    function windowFields(path: PlotPath) {
      const rawWindow = plotValue(row, path);
      return (
        <details
          className={`${s.advanced} ${s.wide}`}
          open={
            rawWindow !== undefined &&
            (!timeLabel(plotRecord(rawWindow).notBefore) ||
              !timeLabel(plotRecord(rawWindow).expiresAt))
          }
        >
          <summary className={s.summary}>
            限定日期（选填） ·{' '}
            {rawWindow === undefined
              ? '未设置'
              : `${timeLabel(plotRecord(rawWindow).notBefore) || '开始待补'} 至 ${timeLabel(plotRecord(rawWindow).expiresAt) || '结束待补'}`}
          </summary>
          <div className={s.advancedBody}>
            <p className={s.hint}>
              不限制日期时可留空，按阶段和前置条件推进。若所属阶段已有日期限制，事件沿用该限制。设置后开始包含、到期不包含。
            </p>
            {field('不早于', [...path, 'notBefore'], '例如2026-10-12T09:00:00Z')}
            {field('到期时间', [...path, 'expiresAt'], '开始必须早于到期')}
            {rawWindow !== undefined && (
              <button
                type="button"
                className={s.button}
                disabled={blocked}
                onClick={() => {
                  if (!blocked) emit(() => removePlotField(content, section, key, path));
                }}
              >
                移除这个时段设置
              </button>
            )}
          </div>
        </details>
      );
    }
    function arrayActions(path: PlotPath, item: unknown, label: string, max: number) {
      const value = plotValue(row, path),
        array = plotArray(value),
        bad = value !== undefined && !Array.isArray(value);
      return (
        <button
          key={label}
          type="button"
          className={s.button}
          disabled={branchBlocked(path) || bad || array.length >= max}
          onClick={() => {
            if (!branchBlocked(path) && !bad && array.length < max) patch(path, [...array, item]);
          }}
        >
          {label}
        </button>
      );
    }
    function removeArrayItem(path: PlotPath, i: number, label: string) {
      return (
        <button
          type="button"
          className={s.button}
          disabled={branchBlocked(path)}
          onClick={() => {
            if (!branchBlocked(path))
              patch(
                path,
                plotArray(plotValue(row, path)).filter((_, j) => i !== j),
              );
          }}
        >
          {label}
        </button>
      );
    }
    const intent = plotRecord(row.intent),
      intentKind = plotText(intent.kind);
    const allowedIntentKeys =
      intentKind === 'offer_message'
        ? ['kind', 'actorKey', 'text']
        : intentKind === 'offer_invitation'
          ? ['kind', 'actorKeys', 'placeKey', 'title', 'earliestAt']
          : ['kind'];
    const unsafeIntent =
      row.intent !== undefined &&
      (typeof row.intent !== 'object' ||
        row.intent === null ||
        Array.isArray(row.intent) ||
        Object.keys(intent).some((k) => !allowedIntentKeys.includes(k)) ||
        !Object.hasOwn(intentNames, intentKind));
    const requiredTimes =
      section === 'history'
        ? [row.occurredAt]
        : section === 'candidates'
          ? [
              ...(intentKind === 'offer_invitation' ? [intent.earliestAt] : []),
              ...plotArray(row.prerequisites)
                .map(plotRecord)
                .filter((p) => p.kind === 'not_before')
                .map((p) => p.at),
            ]
          : [];
    const missingTime = requiredTimes.some((v) => !timeLabel(v));
    return (
      <details
        className={s.item}
        key={`${key || 'raw'}_${index}`}
        open={index === 0 || missingTime}
      >
        <summary className={s.summary}>
          {plotText(row.title) || plotText(row.text) || '待填写'}{' '}
          {missingTime && <small className={s.error}>时间待补齐</small>}
        </summary>
        <fieldset className={s.form} disabled={blocked}>
          <legend className={s.hint}>
            {section === 'history'
              ? '编辑已发生的事'
              : section === 'stages'
                ? '编辑阶段'
                : '编辑可能发生的剧情'}
          </legend>
          {!editable && (
            <p className={`${s.error} ${s.wide}`}>
              稳定标识缺失、重复或格式异常。原条目保留，请核对导入稿。
            </p>
          )}
          {section === 'history' && (
            <>
              {field(
                '已发生的事情',
                ['text'],
                '例如双方上周已经讨论过开店；不是今天一定签合同。',
                true,
                1000,
              )}
              {field(
                '发生时间（北京时间）',
                ['occurredAt'],
                `不得晚于世界起点 ${start || '尚未填写'}；例如2026-10-11T09:00:00Z`,
              )}
              {selectField('发生地点（选填）', ['placeKey'], places)}
              {refsField('参与人物（不等于这些人物都已知）', ['actorKeys'], actors)}
              {selectField(
                '谁可看见这条事实',
                ['visibility', 'kind'],
                [
                  { key: 'player', label: '仅玩家' },
                  { key: 'world', label: '世界内公开' },
                  { key: 'actors', label: '仅指定人物' },
                ],
              )}
              {plotRecord(row.visibility).kind === 'actors' &&
                refsField('可见人物', ['visibility', 'actorKeys'], actors)}
              <p className={`${s.hint} ${s.wide}`}>
                可见范围与开场知情分别配置。人物实际已知事实请到人物页勾选；本页不自动扩大任何人的知情。
              </p>
            </>
          )}
          {section === 'stages' && (
            <>
              {field('阶段名称', ['title'], '例如开业准备', false, 120)}
              {refsField('在哪些阶段之后', ['afterStageKeys'], otherStages)}
              <details className={`${s.advanced} ${s.wide}`} open={typeof row.order !== 'number'}>
                <summary className={s.summary}>
                  阶段排序设置
                  {typeof row.order === 'number' ? ` · 第${row.order + 1}位` : ' · 待设置'}
                </summary>
                <div className={s.advancedBody}>
                  <label className={s.field} htmlFor={id(['order'])}>
                    阶段顺序（0–31）
                    <input
                      id={id(['order'])}
                      className={s.input}
                      type="number"
                      min={0}
                      max={31}
                      value={typeof row.order === 'number' ? row.order : ''}
                      disabled={blocked}
                      onChange={(e) => {
                        if (!blocked)
                          patch(['order'], e.target.value === '' ? '' : Number(e.target.value));
                      }}
                    />
                    <span className={s.hint}>前置阶段要比本阶段靠前，不靠标题猜顺序。</span>
                  </label>
                </div>
              </details>
              {windowFields(['window'])}
            </>
          )}
          {section === 'candidates' && (
            <>
              {field('事件标题', ['title'], '例如朋友邀请你看店', false, 120)}
              {(content.timeline !== undefined || row.timeline !== undefined) &&
                selectField('属于哪个阶段', ['timeline', 'stageKey'], stages)}
              {selectField('触发时玩家必须所在的地点（可不限制）', ['placeKey'], places)}
              <p className={s.hint}>
                手机来信和邀约通常不限制玩家位置；下面的邀约地点才是见面目的地。
              </p>
              {field(
                '这一段想带出什么',
                ['editorialIntent'],
                '写双方顾虑、这个节点为何出现；不把所有角色台词固定死。',
                true,
                1600,
              )}
              {refsField('参与人物', ['actorKeys'], actors)}
              <div className={s.group}>
                <h4>这个节点具体做什么</h4>
                <p className={s.hint}>
                  切换按钮会替换当前类型的专属设置，请先核对原输入。仅备注不执行；先配置和保存，能否运行以检查结果为准。
                </p>
                <p>
                  当前：
                  {Object.hasOwn(intentNames, intentKind)
                    ? intentNames[intentKind as keyof typeof intentNames]
                    : '尚未配置'}
                </p>
                {unsafeIntent ? (
                  <p className={s.error}>原意图有未知字段或格式待核对，保留原稿，暂不切换类型。</p>
                ) : (
                  <div className={s.actions}>
                    {Object.entries(intentNames).map(([kind, label]) => (
                      <button
                        type="button"
                        className={s.button}
                        key={kind}
                        disabled={blocked || kind === intentKind}
                        onClick={() => {
                          if (!blocked && !unsafeIntent && kind !== intentKind)
                            patch(
                              ['intent'],
                              kind === 'editorial_only'
                                ? { kind }
                                : kind === 'offer_message'
                                  ? { kind, actorKey: '', text: '' }
                                  : {
                                      kind,
                                      actorKeys: [],
                                      placeKey: '',
                                      title: '',
                                      earliestAt: '',
                                    },
                            );
                        }}
                      >
                        改为{label}
                      </button>
                    ))}
                  </div>
                )}
                {intentKind === 'offer_message' && (
                  <>
                    {selectField(
                      '由谁来信',
                      ['intent', 'actorKey'],
                      actors.filter((a) => plotStrings(row.actorKeys).includes(a.key)),
                    )}
                    {field(
                      '来信内容',
                      ['intent', 'text'],
                      '最多500字；人物必须属于本节点参与人物。',
                      true,
                      500,
                    )}
                  </>
                )}
                {intentKind === 'offer_invitation' && (
                  <>
                    {refsField(
                      '邀约人物',
                      ['intent', 'actorKeys'],
                      actors.filter((a) => plotStrings(row.actorKeys).includes(a.key)),
                    )}
                    {selectField('邀约地点', ['intent', 'placeKey'], places)}
                    {field('邀约标题', ['intent', 'title'], '', false, 120)}
                    {field(
                      '邀约最早时间（北京时间）',
                      ['intent', 'earliestAt'],
                      '例如2026-10-12T10:00:00Z',
                    )}
                    <p className={s.notice}>
                      当前接线目标为单人物邀约，多人物邀约仍未支持；不要把保存成功当执行成功。
                    </p>
                  </>
                )}
              </div>
              <div className={s.group}>
                <h4>出现前要满足什么</h4>
                <p className={s.hint}>这些是必要前置，拒绝、跳过与过期不是“已提交”。</p>
                {plotArray(row.prerequisites).map((p, i) => {
                  const condition = plotRecord(p),
                    kind = plotText(condition.kind),
                    path: PlotPath = ['prerequisites', i];
                  return (
                    <div className={s.group} key={i}>
                      <strong>
                        {conditionNames[kind as keyof typeof conditionNames] || '原条件待核对'}
                      </strong>
                      {kind === 'history_fact' &&
                        selectField('前置事实', [...path, 'factKey'], facts)}
                      {(kind === 'after_committed_node' || kind === 'after_resolved_node') &&
                        selectField('前置节点', [...path, 'nodeKey'], otherNodes)}
                      {kind === 'after_resolved_node' &&
                        refsField('允许的结果', [...path, 'outcomes'], plotOutcomes)}
                      {kind === 'at_place' &&
                        selectField('玩家所在地点', [...path, 'placeKey'], places)}
                      {kind === 'not_before' &&
                        field(
                          '前置时间（北京时间）',
                          [...path, 'at'],
                          '不得早于世界起点，也不能超过节点到期时间。',
                        )}
                      {removeArrayItem(['prerequisites'], i, '移除这条前置条件')}
                    </div>
                  );
                })}
                {row.prerequisites !== undefined && !Array.isArray(row.prerequisites) && (
                  <p className={s.error}>原前置条件不是列表，未替换原稿。</p>
                )}
                <div className={s.actions}>
                  {Object.entries(conditionNames)
                    .filter(([kind]) => kind !== 'not_before')
                    .map(([kind, label]) =>
                      arrayActions(
                        ['prerequisites'],
                        kind === 'history_fact'
                          ? { kind, factKey: '' }
                          : kind === 'at_place'
                            ? { kind, placeKey: '' }
                            : kind === 'not_before'
                              ? { kind, at: '' }
                              : kind === 'after_resolved_node'
                                ? { kind, nodeKey: '', outcomes: [] }
                                : { kind, nodeKey: '' },
                        `添加：${label}`,
                        16,
                      ),
                    )}
                </div>
                <details className={s.advanced}>
                  <summary className={s.summary}>指定日期后才出现（选填）</summary>
                  <div className={s.advancedBody}>
                    {arrayActions(
                      ['prerequisites'],
                      { kind: 'not_before', at: '' },
                      '添加：世界时间已到达',
                      16,
                    )}
                  </div>
                </details>
              </div>
              <details className={`${s.advanced} ${s.wide}`}>
                <summary className={s.summary}>
                  时间说明（选填）
                  {plotRecord(row.timeline).timeNote !== undefined ? ' · 已填写' : ''}
                </summary>
                <div className={s.advancedBody}>
                  {field(
                    '时间说明（选填）',
                    ['timeline', 'timeNote'],
                    '例如拒绝后隔一天再问；这里只是作者说明，不替代实际时间条件。',
                    true,
                    300,
                  )}
                  {plotRecord(row.timeline).timeNote !== undefined && (
                    <button
                      type="button"
                      className={s.button}
                      disabled={blocked}
                      onClick={() => {
                        if (!blocked)
                          emit(() =>
                            removePlotField(content, section, key, ['timeline', 'timeNote']),
                          );
                      }}
                    >
                      移除时间说明
                    </button>
                  )}
                </div>
              </details>
              {windowFields(['timeline', 'window'])}
              <details className={`${s.advanced} ${s.wide}`}>
                <summary className={s.summary}>
                  分路与排除（选填）
                  {plotStrings(row.mutuallyExclusiveNodeKeys).length ||
                  plotArray(plotRecord(row.timeline).excludeIfResolved).length ||
                  Object.values(plotRecord(plotRecord(row.timeline).alternatives)).some(
                    (v) => plotArray(v).length,
                  )
                    ? ' · 已有设置'
                    : ''}
                </summary>
                <div className={s.advancedBody}>
                  {refsField('与哪些节点互斥', ['mutuallyExclusiveNodeKeys'], otherNodes)}
                  <div className={s.group}>
                    <p className={s.hint}>
                      先创建阶段，再选择所属阶段。已有节点不会在新增阶段时自动改写。
                    </p>
                    <h4>哪些结果出现后不再考虑此节点</h4>
                    {plotArray(plotRecord(row.timeline).excludeIfResolved).map((_, i) => (
                      <div className={s.group} key={i}>
                        {selectField(
                          '排除关联节点',
                          ['timeline', 'excludeIfResolved', i, 'nodeKey'],
                          otherNodes,
                        )}
                        {refsField(
                          '出现这些结果后排除',
                          ['timeline', 'excludeIfResolved', i, 'outcomes'],
                          plotOutcomes,
                        )}
                        {removeArrayItem(['timeline', 'excludeIfResolved'], i, '移除这条结果排除')}
                      </div>
                    ))}
                    {arrayActions(
                      ['timeline', 'excludeIfResolved'],
                      { nodeKey: '', outcomes: [] },
                      '新增结果排除',
                      16,
                    )}
                    <h4>被拒绝、跳过或过期后的替代</h4>
                    <p className={s.hint}>
                      替代节点仍须满足自己的前置和时段，不强行推动用户，也不是已发生事实。
                    </p>
                    {refsField(
                      '被拒绝后可考虑',
                      ['timeline', 'alternatives', 'onDeclined'],
                      otherNodes,
                    )}
                    {refsField(
                      '被跳过后可考虑',
                      ['timeline', 'alternatives', 'onSkipped'],
                      otherNodes,
                    )}
                    {refsField(
                      '已过期后可考虑',
                      ['timeline', 'alternatives', 'onExpired'],
                      otherNodes,
                    )}
                  </div>
                </div>
              </details>
            </>
          )}
          <details className={`${s.advanced} ${s.wide}`}>
            <summary className={s.summary}>技术详情</summary>
            <div className={s.advancedBody}>
              <p className={s.hint}>内部标识：{key || '缺失'}。修改文字不改变关联。</p>
              {refs.length > 0 && (
                <ul className={s.references}>
                  {refs.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
          <div className={`${s.wide} ${s.actions}`}>
            <button
              type="button"
              className={s.button}
              disabled={blocked || refs.length > 0}
              onClick={() => {
                if (!blocked && !refs.length) emit(() => deletePlotRow(content, section, key));
              }}
            >
              删除{section === 'history' ? '事实' : section === 'stages' ? '阶段' : '事件'}
            </button>
            {refs.length > 0 && (
              <span className={s.hint}>仍有关联内容，需先调整后才能删除。详情可展开查看。</span>
            )}
          </div>
        </fieldset>
      </details>
    );
  }
  return (
    <div className={s.editor} aria-label="剧情编辑器">
      <p className={s.notice}>
        先写故事，再安排先后条件。阶段和可能发生的剧情不必逐条填写日期。先配置和保存，能否运行以检查结果为准；可能发生的剧情不是已发生事实。
      </p>
      {disabled && <p className={s.hint}>当前只读或正在处理操作，修改入口暂不可用。</p>}
      <details className={s.card}>
        <summary className={s.summary}>不会填写？看一个简短例子</summary>
        <p>
          开场前：“双方上周讨论过开店”是已发生事实。开场后：“朋友可能邀请你看店”是可选事件。先录事实，再建“开业准备”阶段，最后写邀约节点；拒绝后可考虑另一个来信节点。这只是说明，不会写入你的原稿。
        </p>
        <p className={s.hint}>
          先在世界设定核对起点，在人物页录入人物，在地点中准备现有地点，再用下拉框引用。
        </p>
      </details>
      {issues.length > 0 && (
        <div className={s.card} role="status">
          <h3>需要补齐的内容</h3>
          <p className={s.hint}>可以保留为未完整草稿；发布条件由真实后台检查，未在这里判定就绪。</p>
          <ul className={s.references}>
            {issues.map((issue, i) => (
              <li key={i}>{issueText(issue)}</li>
            ))}
          </ul>
          <details className={s.advanced}>
            <summary className={s.summary}>技术详情</summary>
            <ul className={s.references}>
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {(Object.keys(sections) as PlotSection[]).map((section) => {
        const config = sections[section],
          rows = plotRows(content, section),
          allowed = plotCollectionEditable(content, section);
        return (
          <section className={s.card} key={section} aria-label={config.title}>
            <header className={s.header}>
              <div>
                <h3>{config.title}</h3>
                <p className={s.hint}>{config.help}</p>
              </div>
              <button
                type="button"
                className={s.button}
                disabled={disabled || !allowed || rows.length >= config.limit}
                onClick={() => {
                  if (!disabled && allowed && rows.length < config.limit)
                    emit(() => addPlotRow(content, section));
                }}
              >
                {config.add}
              </button>
            </header>
            {!allowed ? (
              <p className={s.error}>原列表格式待核对，内容保留，未替换为空列表。</p>
            ) : rows.length === 0 ? (
              <p className={s.hint}>还没有条目，可以新增后逐项填写，暂不完整也不会自动执行。</p>
            ) : null}
            {section === 'stages' &&
              rows.length > 0 &&
              selectControl(
                '开场所在阶段',
                plotText(plotRecord(content.timeline).initialStageKey),
                stages,
                disabled || !allowed,
                (key) => emit(() => setPlotInitialStage(content, key)),
                'plot_initial_stage',
              )}
            {rows.map((raw, i) => rowForm(section, raw, i))}
          </section>
        );
      })}
    </div>
  );
}
