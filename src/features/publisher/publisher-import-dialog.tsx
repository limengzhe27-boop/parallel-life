'use client';

import { useEffect, useRef, useState } from 'react';
import { extractZipEntries, parseFeishuMarkdownBundle } from './publisher-importer.ts';
import s from './publisher-import-dialog.module.css';

type Proposal = ReturnType<typeof parseFeishuMarkdownBundle>;
type Source = { filename: string; content: string };
export function PublisherImportDialog({
  workId,
  version,
  content,
  disabled,
  onApply,
  onClose,
}: {
  workId: string;
  version: number;
  content: Record<string, unknown>;
  disabled: boolean;
  onApply: (content: Record<string, unknown>, summary: Proposal['summary']) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const [proposal, setProposal] = useState<Proposal>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const baseline = JSON.stringify([workId, version, content]);
  const current = useRef({ baseline, disabled, onApply });
  current.current = { baseline, disabled, onApply };
  const stagedBaseline = useRef<string | undefined>(undefined);
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
    sequence.current++;
    setProposal(undefined);
    setReading(false);
    setError('');
    stagedBaseline.current = undefined;
  }, [baseline]);
  async function prepare(read: () => Promise<Source[]>) {
    if (current.current.disabled) return;
    const id = ++sequence.current,
      start = current.current.baseline;
    setReading(true);
    setError('');
    setProposal(undefined);
    stagedBaseline.current = undefined;
    try {
      const files = await read();
      if (id !== sequence.current || start !== current.current.baseline || current.current.disabled)
        return;
      const result = parseFeishuMarkdownBundle(files, content);
      setProposal(result);
      stagedBaseline.current = start;
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : '没能读取文稿，请检查格式。');
    } finally {
      if (id === sequence.current) setReading(false);
    }
  }
  async function readFiles(list: File[]) {
    if (!list.length || list.length > 32) throw Error('一次请选择 1—32 份文稿或压缩包。');
    const result: Source[] = [];
    let total = 0;
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
      total = result.reduce((sum, item) => sum + new TextEncoder().encode(item.content).length, 0);
      if (result.length > 32 || total > 128 * 1024)
        throw Error('一次最多导入 32 份、合计 128 KB 的文稿，请分批整理。');
    }
    return result;
  }
  const canApply =
    !!proposal &&
    JSON.stringify(proposal.updatedContent) !== JSON.stringify(content) &&
    !proposal.summary.blocked &&
    !reading &&
    !disabled &&
    stagedBaseline.current === baseline;
  function downloadUnmapped() {
    if (!proposal?.summary.unmapped.length) return;
    const raw = proposal.summary.unmapped
      .map((item) => `# ${item.filename}\n\n${item.reason}\n\n${item.content}`)
      .join('\n\n---\n\n');
    const url = URL.createObjectURL(new Blob([raw], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '待整理文稿.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
          <h2 id="publisher-import-title">导入 Markdown 文稿</h2>
          <p>先查看识别结果，再填入当前编辑稿。导入不会自动保存或发布。</p>
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
            disabled={disabled || reading}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (files.length) void prepare(() => readFiles(files));
            }}
          />
        </label>
        <p className={s.help}>
          支持人物、世界观、任务节点等多份文稿；照片附件不导入。文稿不会发送给模型。请先选择一份作品，再导入。
        </p>
        <p>
          <a href="/templates/world-script.md" download>
            下载编剧填写示例
          </a>{' '}
          · 导入后仍需补全开场时间、地点与剧情运行条件。
        </p>
        <label className={s.field}>
          或粘贴 Markdown 内容
          <textarea
            value={text}
            disabled={disabled || reading}
            rows={6}
            onChange={(event) => {
              sequence.current++;
              setText(event.target.value);
              setProposal(undefined);
              stagedBaseline.current = undefined;
            }}
            placeholder="粘贴人物设定、世界观或任务节点…"
          />
        </label>
        <button
          type="button"
          disabled={disabled || reading || !text.trim()}
          onClick={() => void prepare(async () => [{ filename: '粘贴文稿.md', content: text }])}
        >
          识别粘贴内容
        </button>
        {reading && <p role="status">正在读取文稿…</p>}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {proposal && (
          <section aria-label="文稿识别结果" className={s.preview}>
            <h3>识别结果</h3>
            <p>
              {proposal.summary.actors.length} 位人物 · {proposal.summary.initialMessagesCount}{' '}
              条开场消息 · {proposal.summary.candidatesCount} 个剧情候选
            </p>
            <p>
              同名人物和已有内容不会自动覆盖；缺少日期或运行条件的内容保留为待整理。候选剧情不是已发生的事情。
            </p>
            {proposal.summary.world && <p>世界：{proposal.summary.world.title}</p>}
            <ul>
              {proposal.summary.actors.map((actor, index) => (
                <li key={actor.key + ':' + index}>
                  {actor.name} {actor.identity && `· ${actor.identity}`}
                  {'completeness' in actor && actor.completeness === 'partial' && ' · 待补全'}
                </li>
              ))}
            </ul>
            {!!proposal.summary.diagnostics.length && (
              <ul className={s.warnings}>
                {proposal.summary.diagnostics.map((item, index) => (
                  <li key={index}>
                    {item.filename}：{item.message}
                  </li>
                ))}
              </ul>
            )}
            {!!proposal.summary.unmapped.length && (
              <>
                <h3>原文与待整理内容</h3>
                <p>这些原文仅在本次导入预览中保留。关闭前可下载，在后台补全所需字段。</p>
                {proposal.summary.unmapped.map((item, index) => (
                  <details key={index}>
                    <summary>
                      {item.filename} · {item.reason}
                    </summary>
                    <pre>{item.content}</pre>
                  </details>
                ))}
                <button type="button" onClick={downloadUnmapped}>
                  下载待整理原文
                </button>
              </>
            )}
            {proposal.summary.blocked && (
              <p className={s.error}>本次导入有阻断问题，当前草稿未被修改。请修正文稿再识别。</p>
            )}
          </section>
        )}
      </div>
      <footer className={s.footer}>
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={() => {
            if (
              !proposal ||
              proposal.summary.blocked ||
              current.current.disabled ||
              stagedBaseline.current !== current.current.baseline
            ) {
              setError('当前作品或编辑稿已变化，请重新识别文稿。');
              return;
            }
            current.current.onApply(proposal.updatedContent, proposal.summary);
            onClose();
          }}
        >
          填入当前编辑稿
        </button>
      </footer>
    </dialog>
  );
}
