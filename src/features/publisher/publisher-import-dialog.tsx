'use client';

import { useEffect, useRef, useState } from 'react';
import { extractZipEntries, parseFeishuMarkdownBundle } from './publisher-importer.ts';
import {
  PublisherPreparationInputSchema,
  type PublisherPreparationRecord,
} from '../../contracts/publisher-preparation.ts';
import { PublisherClientError, type PublisherClient } from './publisher-client.ts';
import s from './publisher-import-dialog.module.css';
import { PublisherReviewView } from './publisher-review-view.ts';
import { PublisherSourceReview } from './publisher-source-review.tsx';

type Proposal = ReturnType<typeof parseFeishuMarkdownBundle>;
type Source = { filename: string; content: string };
export type PreparationClient = Pick<
  PublisherClient,
  'prepareManuscript' | 'getPreparation' | 'latestPreparation'
>;
// PostgreSQL JSON objects need not preserve the author's original property order.
export function manuscriptFingerprint(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(manuscriptFingerprint).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ':' +
            manuscriptFingerprint((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'undefined';
}
export function preparationMatches(
  record: PublisherPreparationRecord,
  workId: string,
  version: number,
  content: Record<string, unknown>,
  sources?: Source[],
  commandId?: string,
) {
  return (
    record.workId === workId &&
    record.draftVersion === version &&
    (!commandId || record.commandId === commandId) &&
    manuscriptFingerprint(record.material.currentContent) === manuscriptFingerprint(content) &&
    (!sources || manuscriptFingerprint(record.material.sources) === manuscriptFingerprint(sources))
  );
}
export function preparationChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => manuscriptFingerprint(before[key]) !== manuscriptFingerprint(after[key]),
  );
}
/** Human-readable row changes complement the full before/after details. */
export function preparationChangeSummary(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const changes: string[] = [];
  function rows(label: string, a: unknown, b: unknown) {
    if (!Array.isArray(b)) return;
    const previous = Array.isArray(a) ? a : [];
    const keyOf = (row: unknown, index: number) =>
      row && typeof row === 'object' && 'key' in row ? String(row.key) : String(index);
    const labelOf = (row: unknown, index: number) => {
      if (!row || typeof row !== 'object') return `第 ${index + 1} 项`;
      const r = row as Record<string, unknown>;
      return String(r.name ?? r.title ?? r.text ?? r.key ?? `第 ${index + 1} 项`).slice(0, 100);
    };
    b.forEach((row, index) => {
      const old = previous.find((value, i) => keyOf(value, i) === keyOf(row, index));
      if (!old) changes.push(`${label} · 新增：${labelOf(row, index)}`);
      else if (manuscriptFingerprint(old) !== manuscriptFingerprint(row))
        changes.push(`${label} · 修改：${labelOf(row, index)}`);
    });
    previous.forEach((row, index) => {
      if (!b.some((value, i) => keyOf(value, i) === keyOf(row, index)))
        changes.push(`${label} · 移除：${labelOf(row, index)}`);
    });
  }
  for (const [key, label] of Object.entries({
    actors: '人物',
    history: '已发生事实',
    candidates: '剧情候选',
    places: '地点',
    relationships: '人物关系',
    initialKnowledge: '人物知情范围',
    routes: '路线',
  }))
    rows(label, before[key], after[key]);
  const fields = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  rows('时间线阶段', fields(before.timeline).stages, fields(after.timeline).stages);
  rows('开场消息', fields(before.phone).messages, fields(after.phone).messages);
  return changes;
}
const groupNames: Record<string, string> = {
  work: '作品介绍',
  world: '世界设定',
  protagonist: '主角',
  actors: '人物',
  relationships: '人物关系',
  initialKnowledge: '人物知情范围',
  history: '已发生事实',
  timeline: '时间线',
  candidates: '剧情候选',
  places: '地点',
  routes: '路线',
  phone: '开场手机内容',
};

function groupLabel(key: string) {
  return Object.hasOwn(groupNames, key) ? groupNames[key] : key;
}

type PreparationIssue = NonNullable<PublisherPreparationRecord['result']>['issues'][number];
const issueFields: Record<string, string> = {
  ...groupNames,
  key: '编号',
  title: '名称',
  hook: '一句话简介',
  description: '作品简介',
  experienceNote: '体验说明',
  publicSetting: '公开世界设定',
  hiddenContext: '幕后世界设定',
  tone: '叙事氛围',
  startAt: '开场日期与时间',
  startPlaceKey: '开场地点',
  identity: '身份',
  situation: '当前处境',
  name: '姓名',
  publicCard: '公开资料',
  privatePersona: '人物内心设定',
  background: '人物背景',
  motivation: '人物动机',
  voice: '说话方式',
  boundaries: '人物边界',
  traits: '性格特点',
  appearance: '外貌',
  knownAtStart: '开场是否已认识',
  knownFactKeys: '已知事实',
  factKeys: '知情事实',
  actorKey: '关联人物',
  actorKeys: '参与人物',
  text: '正文',
  occurredAt: '发生时间',
  at: '时间',
  earliestAt: '最早发生时间',
  origin: '消息来源',
  visibility: '可见范围',
  stages: '阶段',
  initialStageKey: '开场阶段',
  stageKey: '所属阶段',
  afterStageKeys: '前置阶段',
  order: '阶段顺序',
  prerequisites: '发生条件',
  mutuallyExclusiveNodeKeys: '互斥剧情',
  intent: '事件运行方式',
  editorialIntent: '剧情说明',
  messages: '消息',
  invitations: '邀约',
  notes: '便签',
  album: '相册',
  placeKey: '关联地点',
  fromPlaceKey: '出发地点',
  toPlaceKey: '到达地点',
  minutes: '移动耗时',
  messageKey: '关联消息',
  historyFactKey: '照片来源事实',
  media: '素材',
  mediaKey: '关联素材',
  coverMediaKey: '封面素材',
  avatarMediaKey: '头像素材',
  sceneMediaKey: '场景素材',
};
const issueReasons: Record<string, string> = {
  too_big: '内容过多或过长，请精简后再检查。',
  invalid_format: '格式不正确，请核对后修改。',
  invalid_type: '内容格式不正确或尚未填写，请补充后再检查。',
  invalid_value: '请选择支持的内容或填写方式。',
  invalid_union: '内容结构不完整，请补齐后再检查。',
  unrecognized_keys: '包含暂不支持的字段，请核对后调整。',
  duplicate_key: '存在重复编号，请分别设置不同编号。',
  unknown_actor: '关联人物不存在，请重新选择人物。',
  unknown_place: '关联地点不存在，请补充地点或重新选择。',
  unknown_fact: '关联事实不存在，请补充事实或重新选择。',
  unknown_message: '关联消息不存在，请补充消息或重新选择。',
  unknown_media: '关联素材不存在，请重新选择素材。',
  future_in_history: '已发生事实的时间不能晚于世界开场。',
  future_opening_message: '开场消息不能晚于世界开场时间。',
  history_message_not_past: '过去的对话必须早于世界开场。',
  invitation_before_start: '邀约时间不能早于世界开场。',
  candidate_time_before_start: '剧情候选的发生时间不能早于世界开场。',
  sender_not_player_known: '发送者须为开场时玩家已认识的人物，请核对人物关系。',
  participant_not_player_known: '邀约参与者须为开场时玩家已认识的人物。',
  fact_not_actor_visible: '这项事实对该人物不可见，请核对事实的可见范围与人物知情设置。',
  fact_not_player_visible: '这项事实对玩家不可见，请核对事实的可见范围。',
  fact_not_player_known: '玩家尚不知道这项事实，请核对开场知情设置。',
  start_place_not_known: '开场地点须为玩家已知地点，请核对地点设置。',
  place_not_player_known: '该地点对玩家尚不可见，请核对地点设置。',
  invalid_node_reference: '关联剧情不存在或引用了自身，请核对剧情编号。',
  self_relationship: '关系的双方不能是同一人物。',
  self_route: '路线的起点和终点不能相同。',
  invitation_sender_mismatch: '邀约关联消息的发送者须为参与人物。',
  intent_actor_outside_node: '事件涉及的人物应包含在本条剧情参与人物中。',
  intent_place_outside_node: '事件地点应与本条剧情地点一致。',
  space_route_budget: '单段路线最多支持 120 分钟，请调整或拆分路线。',
  content_budget: '内容总量超出限制，请精简后再整理。',
};
function ownValue(content: unknown, path: (string | number)[]) {
  let value = content;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
export function preparationIssueMessages(
  issues: PreparationIssue[],
  content?: Record<string, unknown>,
) {
  const grouped = new Map<
    string,
    { path: PreparationIssue['path']; field: string; reason: string; details: PreparationIssue[] }
  >();
  for (const issue of issues) {
    const field =
      issue.path
        .map((part) =>
          typeof part === 'number'
            ? `第 ${part + 1} 项`
            : Object.hasOwn(issueFields, part)
              ? issueFields[part]
              : '其它字段',
        )
        .join(' · ') || '世界内容';
    const value = ownValue(content, issue.path);
    const emptyText = typeof value === 'string' && !value.trim();
    const reason =
      issue.code === 'too_small'
        ? issue.path.length === 1 && issue.path[0] === 'actors'
          ? '请补充至少 2 位人物。'
          : '内容尚不完整，请补充后再检查。'
        : issue.code === 'custom' && emptyText
          ? '内容尚不完整，请补充后再检查。'
          : Object.hasOwn(issueReasons, issue.code)
            ? issueReasons[issue.code]!
            : '这项设定仍需核对，请对照原稿与相关设定检查；可展开详细定位。';
    const key = JSON.stringify([issue.path, reason]);
    const entry = grouped.get(key);
    if (entry) entry.details.push(issue);
    else grouped.set(key, { path: issue.path, field, reason, details: [issue] });
  }
  return [...grouped.values()];
}
export function PublisherPreparationIssues({
  issues,
  content,
}: {
  issues: PreparationIssue[];
  content?: Record<string, unknown>;
}) {
  const messages = preparationIssueMessages(issues, content);
  if (!messages.length) return null;
  return (
    <div className={s.warnings}>
      <h4>仍需补齐或检查</h4>
      <ul>
        {messages.map((item, index) => (
          <li key={index}>
            {item.field}：{item.reason}
          </li>
        ))}
      </ul>
      <details>
        <summary>查看详细定位</summary>
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.path.join(' / ') || '（世界内容）'}（{issue.code}）
            </li>
          ))}
        </ul>
      </details>
      <p>填入后仍需保存并通过完整检查，再试演和发布。</p>
    </div>
  );
}

export function PublisherImportDialog({
  workId,
  version,
  content,
  disabled,
  preparationClient,
  onApply,
  onClose,
}: {
  workId: string;
  version: number;
  content: Record<string, unknown>;
  disabled: boolean;
  preparationClient?: PreparationClient;
  onApply: (content: Record<string, unknown>, summary: Proposal['summary']) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const [proposal, setProposal] = useState<Proposal>();
  const [record, setRecord] = useState<PublisherPreparationRecord>();
  const [operationId, setOperationId] = useState<string>();
  const [notFound, setNotFound] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [reading, setReading] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [reviewedOriginal, setReviewedOriginal] = useState(false);
  const [reviewedAdditions, setReviewedAdditions] = useState(false);
  const baseline = manuscriptFingerprint([workId, version, content]);
  const current = useRef({ baseline, disabled, onApply });
  current.current = { baseline, disabled, onApply };
  const stagedBaseline = useRef<string | undefined>(undefined);
  function clearResult() {
    setProposal(undefined);
    setRecord(undefined);
    setOperationId(undefined);
    setNotFound(false);
    setReviewedOriginal(false);
    setReviewedAdditions(false);
    stagedBaseline.current = undefined;
    setError('');
  }
  function stillCurrent(id: number, start: string) {
    return (
      id === sequence.current && start === current.current.baseline && !current.current.disabled
    );
  }
  function accept(
    result: PublisherPreparationRecord,
    expectedSources?: Source[],
    expectedId?: string,
  ) {
    if (!preparationMatches(result, workId, version, content, expectedSources, expectedId)) {
      setError('整理结果属于不同的作品、原稿或编辑版本，未填入当前草稿。请核对后重新整理。');
      return;
    }
    setNotFound(false);
    setRecord(result);
    setOperationId(result.commandId);
    setSources(result.material.sources);
    setReviewedOriginal(false);
    setReviewedAdditions(false);
    setProposal(undefined);
    stagedBaseline.current = baseline;
  }
  useEffect(() => {
    dialog.current?.showModal();
    const viewport = window.visualViewport;
    const fit = () => {
      const node = dialog.current;
      if (!node) return;
      node.style.setProperty(
        '--dialog-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
      const keyboard = !!viewport && viewport.height < window.innerHeight - 80;
      node.style.top = keyboard ? `${viewport.offsetTop + 12}px` : '';
      node.style.bottom = keyboard ? 'auto' : '';
      node.style.margin = keyboard ? '0 auto' : '';
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      sequence.current++;
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
    };
  }, []);
  useEffect(() => {
    const id = ++sequence.current;
    const start = baseline;
    clearResult();
    setSources([]);
    setText('');
    setReading(false);
    inFlight.current = false;
    setActivity('');
    if (!preparationClient || disabled) return;
    // Server scopes latest to this signed-in staff member. No manuscript enters browser storage.
    inFlight.current = true;
    setActivity('正在查询上次整理记录…');
    void preparationClient
      .latestPreparation(workId)
      .then(({ preparation }) => {
        if (stillCurrent(id, start) && preparation) accept(preparation);
      })
      .catch(() => {
        if (stillCurrent(id, start))
          setError('暂时无法查询上次整理记录。若刚才已经提交，请先查询结果，避免重复整理。');
      })
      .finally(() => {
        if (id === sequence.current) {
          inFlight.current = false;
          setActivity('');
        }
      });
    return () => {
      sequence.current++;
    };
    // Only these changes invalidate ownership of an in-flight result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, disabled, preparationClient]);

  async function readSources(read: () => Promise<Source[]>) {
    if (current.current.disabled || inFlight.current) return;
    const id = ++sequence.current,
      start = current.current.baseline;
    inFlight.current = true;
    setReading(true);
    clearResult();
    setSources([]);
    try {
      const files = await read();
      if (!files.length || !files.some((file) => file.content.trim()))
        throw Error('没有可读取的文稿，请选择 Markdown 或粘贴正文。');
      if (stillCurrent(id, start)) setSources(files);
    } catch (e) {
      if (stillCurrent(id, start))
        setError(e instanceof Error ? e.message : '没能读取文稿，请检查格式。');
    } finally {
      if (id === sequence.current) {
        inFlight.current = false;
        setReading(false);
      }
    }
  }
  async function readFiles(list: File[]) {
    if (!list.length || list.length > 32) throw Error('一次请选择 1—32 份文稿或压缩包。');
    const result: Source[] = [];
    for (const file of list) {
      if (/\.zip$/i.test(file.name)) {
        if (file.size > 5 * 1024 * 1024) throw Error('压缩包不能超过 5 MB。');
        result.push(
          ...(await extractZipEntries(await file.arrayBuffer())).map((entry) => ({
            ...entry,
            filename: `${file.name} > ${entry.filename}`,
          })),
        );
      } else {
        if (!/\.(md|markdown|txt)$/i.test(file.name))
          throw Error('请选择 Markdown、文本或 ZIP 文件。');
        if (file.size > 128 * 1024) throw Error('单份文稿不能超过 128 KB，请拆分整理。');
        result.push({
          filename: file.name,
          content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()),
        });
      }
      if (
        result.length > 32 ||
        result.reduce((sum, item) => sum + new TextEncoder().encode(item.content).length, 0) >
          128 * 1024
      )
        throw Error('一次最多导入 32 份、合计 128 KB 的文稿，请分批整理。');
    }
    return result;
  }
  async function startAI(replay = false) {
    if (
      replay &&
      (!operationId || !notFound || stagedBaseline.current !== current.current.baseline)
    )
      return;
    if (!preparationClient || current.current.disabled || inFlight.current || !sources.length)
      return;
    const input = PublisherPreparationInputSchema.safeParse({
      commandId: replay ? operationId : crypto.randomUUID(),
      expectedDraftVersion: version,
      currentContent: content,
      sources,
    });
    if (!input.success) {
      setError('文稿与当前草稿超出整理范围或格式不完整。请精简文稿、分批整理，或使用仅解析入口。');
      return;
    }
    const id = ++sequence.current,
      start = current.current.baseline;
    inFlight.current = true;
    clearResult();
    setOperationId(input.data.commandId);
    setSources(input.data.sources);
    setActivity('正在整理文稿，可能需要约两分钟。可以关闭，稍后重新打开查看结果。');
    stagedBaseline.current = start;
    try {
      const result = await preparationClient.prepareManuscript(workId, input.data);
      if (stillCurrent(id, start)) accept(result, input.data.sources, input.data.commandId);
    } catch (error) {
      if (stillCurrent(id, start)) {
        const definite = error instanceof PublisherClientError && error.code !== 'UNAVAILABLE';
        if (definite) {
          setOperationId(undefined);
          setNotFound(false);
          stagedBaseline.current = undefined;
        }
        setError(
          error instanceof PublisherClientError && error.code === 'RATE_LIMITED'
            ? '本小时整理次数已达上限（最多 10 次新请求），请稍后再试。当前草稿未修改。'
            : error instanceof PublisherClientError && error.code === 'INVALID_STATE'
              ? '已有整理任务在进行。请先查询已有结果，稍后再整理。'
              : definite
                ? error.message
                : '尚未确认整理结果，草稿未修改。请查询本次结果；不会自动再次调用模型。',
        );
      }
    } finally {
      if (id === sequence.current) {
        inFlight.current = false;
        setActivity('');
      }
    }
  }
  async function recover() {
    if (!preparationClient || current.current.disabled || inFlight.current) return;
    const id = ++sequence.current,
      start = current.current.baseline;
    inFlight.current = true;
    setError('');
    setActivity('正在查询已有整理结果，不会调用模型…');
    try {
      if (operationId) {
        const result = await preparationClient.getPreparation(workId, operationId);
        if (stillCurrent(id, start)) accept(result, sources, operationId);
      } else {
        const { preparation } = await preparationClient.latestPreparation(workId);
        if (stillCurrent(id, start)) {
          if (preparation) accept(preparation, sources.length ? sources : undefined);
          else setError('没有查到整理记录。若刚提交过，请稍后再查询；不会自动重新整理。');
        }
      }
    } catch (error) {
      if (stillCurrent(id, start)) {
        const missing =
          !!operationId && error instanceof PublisherClientError && error.code === 'NOT_FOUND';
        setNotFound(missing);
        setError(
          missing
            ? '服务端尚无本次操作记录。可稍后查询，或核对原稿后重发同一次请求；不会创建新的操作编号。'
            : '暂时未查到完整结果。保留当前原稿，稍后再查询；查询不会重新调用模型。',
        );
      }
    } finally {
      if (id === sequence.current) {
        inFlight.current = false;
        setActivity('');
      }
    }
  }
  function downloadSources() {
    const raw = sources
      .map((source) => `# ${source.filename}\n\n${source.content}`)
      .join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([raw], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '导入原稿.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function parseOnly() {
    if (current.current.disabled || inFlight.current || !sources.length) return;
    sequence.current++;
    clearResult();
    try {
      setProposal(parseFeishuMarkdownBundle(sources, content));
      stagedBaseline.current = baseline;
    } catch {
      setError('未能解析文稿，原稿和当前草稿均已保留。');
    }
  }
  const aiResult = record?.status === 'succeeded' ? record.result : null;
  const updatedContent = aiResult?.updatedContent ?? proposal?.updatedContent;
  const changed = updatedContent ? preparationChanges(content, updatedContent) : [];
  const canApply =
    !!updatedContent &&
    changed.length > 0 &&
    !proposal?.summary.blocked &&
    (!aiResult || (reviewedOriginal && reviewedAdditions)) &&
    !reading &&
    !activity &&
    !disabled &&
    stagedBaseline.current === baseline;
  function apply() {
    if (
      !canApply ||
      !updatedContent ||
      current.current.disabled ||
      inFlight.current ||
      stagedBaseline.current !== current.current.baseline
    ) {
      setError('请核对结果；作品、权限或编辑稿变化后需要重新整理。');
      return;
    }
    const summary: Proposal['summary'] = proposal?.summary ?? {
      actors: [],
      initialMessagesCount: 0,
      candidatesCount: 0,
      warnings: [],
      diagnostics: aiResult
        ? [
            {
              code: 'ai_summary',
              severity: 'warning',
              filename: '模型整理摘要（待核对）',
              message: aiResult.summary,
            },
            ...aiResult.notes.map((note) => ({
              code: note.kind,
              severity: 'warning' as const,
              filename: { extracted: '模型认为已提取', supplemented: 'AI 补充', review: '待核对' }[
                note.kind
              ],
              message: note.text,
            })),
            ...preparationIssueMessages(aiResult.issues, aiResult.updatedContent).map((issue) => ({
              code: issue.details[0]!.code,
              severity: 'warning' as const,
              filename: '待检查',
              path: issue.path.join('.'),
              message: `${issue.field}：${issue.reason}`,
            })),
          ]
        : [],
      blocked: false,
      unmapped: sources.map((source) => ({
        ...source,
        reason: 'AI 整理来源原稿（仅供编剧核对，不代表世界内事实）',
      })),
    };
    current.current.onApply(updatedContent, summary);
    onClose();
  }
  const unavailable = disabled || reading || !!activity;
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="publisher-import-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={s.header}>
        <div>
          <h2 id="publisher-import-title">导入与整理文稿</h2>
          <p>导入故事 → 查看整理稿 → 核对问题 → 填入草稿</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭文稿导入">
          关闭
        </button>
      </header>
      <div className={s.body}>
        <details className={s.sourceInput} open={!updatedContent}>
          <summary>
            {updatedContent ? `原稿与重新整理 · ${sources.length} 份文稿` : '第一步：导入你的故事'}
          </summary>
          <label className={s.field}>
            选择文稿或 ZIP 压缩包
            <input
              type="file"
              multiple
              accept=".md,.markdown,.txt,.zip"
              disabled={unavailable}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (files.length) void readSources(() => readFiles(files));
              }}
            />
          </label>
          <p className={s.help}>
            支持自由叙述、人物设定、世界观和任务节点，无需套用固定表格。ZIP 中的照片附件不导入。
          </p>
          <p>
            <a href="/templates/world-script.md" download>
              下载编剧填写示例
            </a>
          </p>
          <label className={s.field}>
            或粘贴文稿
            <textarea
              value={text}
              disabled={unavailable}
              rows={5}
              placeholder="粘贴你想讲述的世界与人物…"
              onChange={(event) => {
                sequence.current++;
                setText(event.target.value);
                setSources([]);
                clearResult();
              }}
            />
          </label>
          <button
            type="button"
            disabled={unavailable || !text.trim()}
            onClick={() =>
              void readSources(async () => [{ filename: '粘贴文稿.md', content: text }])
            }
          >
            读取粘贴内容
          </button>
          {reading && <p role="status">正在读取文稿…</p>}
          {!!sources.length && (
            <section className={s.preview} aria-label="原稿">
              <h3>已读取 {sources.length} 份原稿</h3>
              <button type="button" onClick={downloadSources}>
                下载原稿备份
              </button>
              {sources.map((source, index) => (
                <details key={index}>
                  <summary>{source.filename}</summary>
                  <pre>{source.content}</pre>
                </details>
              ))}
              <p className={s.help}>
                点击 AI
                整理，会把以上文稿和当前编辑稿发送给项目文字模型。每次最多调用两次，包含一次已知格式问题的纠正。AI
                补充内容需要你核对；作者设定与人物知情范围也请逐项检查。
              </p>
              <div className={s.actions}>
                <button
                  type="button"
                  className={s.primary}
                  disabled={unavailable || !preparationClient || record?.status === 'running'}
                  onClick={() => void startAI()}
                >
                  {operationId ? '重新整理（新请求）' : '让 AI 整理世界'}
                </button>
                <button type="button" disabled={unavailable} onClick={parseOnly}>
                  仅解析，不调用 AI
                </button>
              </div>
              {operationId && (
                <p className={s.help}>
                  重新整理会开始新的整理，最多包含两次文字模型调用。结果尚未确认时，请先查询原操作。
                </p>
              )}
            </section>
          )}
        </details>
        {preparationClient && (
          <button
            type="button"
            className={s.recover}
            disabled={unavailable}
            onClick={() => void recover()}
          >
            查询已有整理结果
          </button>
        )}
        {notFound && operationId && (
          <button type="button" disabled={unavailable} onClick={() => void startAI(true)}>
            核对后重发本次请求
          </button>
        )}
        {activity && <p role="status">{activity}</p>}
        {record?.status === 'running' && !activity && (
          <p role="status">文稿仍在整理中。请稍后查询结果，不会自动重试。</p>
        )}
        {record?.status === 'unknown' && (
          <p role="status">
            本次结果尚未确认，当前草稿未修改。请查询已有结果，或明确选择重新整理。
          </p>
        )}
        {record?.status === 'failed' && (
          <p role="alert">本次整理未成功，当前草稿未修改。可以保留原稿、仅解析，或重新整理。</p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {proposal && (
          <section className={s.preview} aria-label="文稿识别结果">
            <h3>纯解析结果</h3>
            <p>
              {proposal.summary.actors.length} 位人物 · {proposal.summary.initialMessagesCount}{' '}
              条开场消息 · {proposal.summary.candidatesCount} 个剧情候选
            </p>
            <p>
              同名人物和已有内容不会自动覆盖。缺少日期或运行条件的内容仍需补齐，候选剧情不是已发生的事情。
            </p>
            <ul>
              {proposal.summary.diagnostics.map((item, index) => (
                <li key={index}>
                  {item.filename}：{item.message}
                </li>
              ))}
            </ul>
            {proposal.summary.unmapped.map((item, index) => (
              <details key={index}>
                <summary>
                  {item.filename} · {item.reason}
                </summary>
                <pre>{item.content}</pre>
              </details>
            ))}
            {proposal.summary.blocked && (
              <p className={s.error}>存在阻断问题，请修正文稿后再解析。</p>
            )}
          </section>
        )}
        {updatedContent && (
          <p className={s.reviewIntro} role="status">
            整理稿已准备好。先看故事与人物，再核对下方提示。填入后仍可编辑，保存、试演和发布由你决定。
          </p>
        )}
        {updatedContent && <PublisherReviewView content={updatedContent} />}
        {aiResult && (
          <section className={s.preview} aria-label="需要处理的问题">
            <h3>需要处理的问题</h3>
            <PublisherPreparationIssues
              issues={aiResult.issues}
              content={aiResult.updatedContent}
            />
            {!aiResult.issues.length && <p>未发现结构问题；故事是否准确仍请对照原稿确认。</p>}
          </section>
        )}
        {updatedContent && (
          <PublisherSourceReview
            sources={sources}
            content={updatedContent}
            baselineContent={content}
          />
        )}
        {aiResult && (
          <section className={s.preview} aria-label="AI 整理结果">
            <details>
              <summary>查看 AI 的整理说明与补充内容</summary>
              <h3>模型整理说明（待核对）</h3>
              <p className={s.help}>
                以下是模型对本次整理的说明，不是来源核验结果。请以上方实际内容与原稿对照，核对整理结果。
              </p>
              <p>{aiResult.summary}</p>
              {(['extracted', 'supplemented', 'review'] as const).map((kind) => (
                <div key={kind}>
                  <h4>
                    {
                      {
                        extracted: '模型认为已提取',
                        supplemented: 'AI 补充的内容',
                        review: '需要编剧核对',
                      }[kind]
                    }
                  </h4>
                  <ul>
                    {aiResult.notes
                      .filter((note) => note.kind === kind)
                      .map((note, index) => (
                        <li key={index}>{note.text}</li>
                      ))}
                  </ul>
                </div>
              ))}
            </details>
            <h3>核对后填入</h3>
            <label className={s.reviewCheck}>
              <input
                type="checkbox"
                checked={reviewedOriginal}
                disabled={unavailable}
                onChange={(event) => setReviewedOriginal(event.target.checked)}
              />
              我已对照原稿，确认作者设定与人物知情范围
            </label>
            <label className={s.reviewCheck}>
              <input
                type="checkbox"
                checked={reviewedAdditions}
                disabled={unavailable}
                onChange={(event) => setReviewedAdditions(event.target.checked)}
              />
              我已核对 AI 补充、待检查项及下方变化
            </label>
          </section>
        )}
        {updatedContent && (
          <section className={s.preview} aria-label="草稿变化">
            <h3>将填入的变化</h3>
            <ul>
              {preparationChangeSummary(content, updatedContent).map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
            {!changed.length && <p>整理结果与当前草稿相同，无需填入。</p>}
            <details>
              <summary>高级：查看完整字段变化</summary>
              {changed.map((key) => (
                <details key={key}>
                  <summary>{groupLabel(key)}</summary>
                  <h4>当前内容</h4>
                  <pre>{JSON.stringify(content[key], null, 2) ?? '（无）'}</pre>
                  <h4>整理后</h4>
                  <pre>{JSON.stringify(updatedContent[key], null, 2) ?? '（移除）'}</pre>
                </details>
              ))}
            </details>
          </section>
        )}
      </div>
      <footer className={s.footer}>
        <button type="button" onClick={onClose}>
          关闭
        </button>
        <button type="button" disabled={!canApply} onClick={apply}>
          填入当前编辑稿
        </button>
      </footer>
    </dialog>
  );
}
