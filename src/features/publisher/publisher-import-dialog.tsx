'use client';

import { useEffect, useRef, useState } from 'react';
import { extractZipEntries, parseFeishuMarkdownBundle } from './publisher-importer.ts';
import {
  PublisherPreparationInputSchema,
  type PublisherPreparationRecord,
} from '../../contracts/publisher-preparation.ts';
import { PublisherClientError, type PublisherClient } from './publisher-client.ts';
import s from './publisher-import-dialog.module.css';

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
              filename: '整理摘要',
              message: aiResult.summary,
            },
            ...aiResult.notes.map((note) => ({
              code: note.kind,
              severity: 'warning' as const,
              filename: { extracted: '原稿提取', supplemented: 'AI 补充', review: '待核对' }[
                note.kind
              ],
              message: note.text,
            })),
            ...aiResult.issues.map((issue) => ({
              code: issue.code,
              severity: 'warning' as const,
              filename: '待检查',
              path: issue.path.join('.'),
              message: `${groupLabel(String(issue.path[0] ?? '世界内容'))}：请在完整检查中核对（${issue.code}）`,
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
          <p>原稿 → AI 整理 → 编剧核对 → 填入草稿。不会自动保存、试演或发布。</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭文稿导入">
          关闭
        </button>
      </header>
      <div className={s.body}>
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
          onClick={() => void readSources(async () => [{ filename: '粘贴文稿.md', content: text }])}
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
              点击 AI 整理，会把以上文稿和当前编辑稿发送给项目文字模型。AI
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
                重新整理会发起一次新的模型请求。结果尚未确认时，建议先查询原操作。
              </p>
            )}
          </section>
        )}
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
        {aiResult && (
          <section className={s.preview} aria-label="AI 整理结果">
            <h3>核对整理结果</h3>
            <p>{aiResult.summary}</p>
            {(['extracted', 'supplemented', 'review'] as const).map((kind) => (
              <div key={kind}>
                <h4>
                  {
                    {
                      extracted: '原稿中提取的设定',
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
            {!!aiResult.issues.length && (
              <div className={s.warnings}>
                <h4>仍需补齐或检查</h4>
                <ul>
                  {aiResult.issues.map((issue, index) => (
                    <li key={index}>
                      {groupLabel(String(issue.path[0] ?? '世界内容'))}：
                      {issue.path
                        .map((part) => (typeof part === 'number' ? `第 ${part + 1} 项` : part))
                        .join(' / ')}
                      （{issue.code}）
                    </li>
                  ))}
                </ul>
                <p>填入后仍需保存并通过完整检查，再试演和发布。</p>
              </div>
            )}
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
            {changed.map((key) => (
              <details key={key}>
                <summary>{groupLabel(key)}</summary>
                <h4>当前内容</h4>
                <pre>{JSON.stringify(content[key], null, 2) ?? '（无）'}</pre>
                <h4>整理后</h4>
                <pre>{JSON.stringify(updatedContent[key], null, 2) ?? '（移除）'}</pre>
              </details>
            ))}
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
