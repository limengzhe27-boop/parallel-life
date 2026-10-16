'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CHARACTER_PASTE_MAX_BYTES,
  applyCharacterPaste,
  characterPasteFingerprint,
  parseCharacterPaste,
  type CharacterPastePreview,
  type CharacterPasteIssue,
} from './publisher-character-paste.ts';
import s from './publisher-character-paste-dialog.module.css';

type Props = {
  workId: string;
  version: number;
  content: Record<string, unknown>;
  actorKey: string;
  referenceAt: string;
  disabled: boolean;
  onClose(): void;
  onApply(content: Record<string, unknown>, message: string): void;
};
export function PublisherCharacterPasteDialog(props: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CharacterPastePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [errors, setErrors] = useState<CharacterPasteIssue[]>([]);
  const [reading, setReading] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const activePreview = useRef(preview);
  activePreview.current = preview;
  const fileRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileRequest.current++;
    };
  }, []);
  const identity = `${props.workId}:${props.version}:${props.actorKey}`;
  const originalIdentity = useRef(identity);
  const stale =
    identity !== originalIdentity.current ||
    (!!preview && preview.baseline !== characterPasteFingerprint(props.content));
  function change(value: string) {
    fileRequest.current++;
    setReading(false);
    setText(value);
    setPreview(null);
    setErrors([]);
  }
  function recognize() {
    if (latest.current.disabled || reading || stale) return;
    const p = parseCharacterPaste(
      text,
      latest.current.content,
      latest.current.actorKey,
      latest.current.referenceAt,
    );
    setPreview(p);
    setSelected(p.fields.filter((f) => !f.existing).map((f) => f.id));
    setErrors(p.issues);
  }
  async function read(file: File | undefined) {
    if (!file || props.disabled) return;
    const request = ++fileRequest.current;
    const guard = identity;
    setReading(true);
    setPreview(null);
    setErrors([]);
    try {
      if (file.size > CHARACTER_PASTE_MAX_BYTES)
        throw Error('文件超过本次可识别的 1 MiB 上限，请分章节导入；输入框原文没有被替换。');
      const buffer = await file.arrayBuffer();
      let value: string;
      try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw Error(
          '文件不是有效的 UTF-8 文字，请重新以 UTF-8 保存 Markdown 后再选择；输入框原文没有被替换。',
        );
      }
      if (
        !mounted.current ||
        request !== fileRequest.current ||
        guard !== `${latest.current.workId}:${latest.current.version}:${latest.current.actorKey}`
      )
        return;
      setText(value);
    } catch (error) {
      if (mounted.current && request === fileRequest.current)
        setErrors([
          {
            reason:
              error instanceof Error ? error.message : '文件读取失败，请重新选择 UTF-8 Markdown。',
            source: { start: 0, end: 0, text: '' },
          },
        ]);
    } finally {
      if (mounted.current && request === fileRequest.current) setReading(false);
    }
  }
  function confirm() {
    const now = latest.current;
    if (
      !preview ||
      activePreview.current !== preview ||
      now.disabled ||
      reading ||
      originalIdentity.current !== `${now.workId}:${now.version}:${now.actorKey}`
    )
      return;
    const result = applyCharacterPaste(now.content, now.actorKey, preview, selected);
    if (!result.ok) {
      setErrors(result.issues);
      return;
    }
    now.onApply(
      result.content,
      result.unchanged
        ? '这份资料已在当前草稿中，没有重复追加。'
        : `已填入编辑稿，尚未保存。新增 ${result.addedMessages} 条聊天、${result.addedMoments} 条朋友圈；请保存草稿后再试演。`,
    );
  }
  const blocked = props.disabled || reading || stale;
  return (
    <div className={s.backdrop}>
      <section
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="character-paste-title"
      >
        <header className={s.header}>
          <h2 id="character-paste-title">粘贴导入角色资料</h2>
          <button type="button" onClick={props.onClose} aria-label="关闭角色资料导入">
            关闭
          </button>
        </header>
        <p>一份资料只填入当前人物。先核对姓名；分批导入时，没有提供的章节会保留原样。</p>
        <label className={s.label}>
          选择 UTF-8 Markdown 文件
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            disabled={blocked}
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className={s.label}>
          或直接粘贴资料
          <textarea
            rows={10}
            value={text}
            onChange={(e) => change(e.target.value)}
            placeholder={
              '# 人物：当前人物姓名\n\n## 人生背景\n在这里粘贴完整设定……\n\n## 历史聊天\n人物姓名：你到家了吗？\n主角：刚到。'
            }
            disabled={props.disabled || stale}
          />
        </label>
        <details>
          <summary>查看支持的文档格式</summary>
          <p className={s.hint}>
            使用单独一行的章节标题：玩家可见资料、人生背景、人格特质、动机与价值观、行为模式、关系模型、历史聊天、朋友圈。聊天用“——隔一段时间——”分段；朋友圈用“【一条动态】”分篇。无日期时安排在开场前；明确日期会保留并核对。
          </p>
        </details>
        <button type="button" onClick={recognize} disabled={blocked || !text.trim()}>
          {reading ? '正在读取文件…' : '识别并核对'}
        </button>
        {stale && (
          <p role="alert">当前作品、人物或草稿已变化。本次核对不能继续，请关闭后重新打开。</p>
        )}
        {errors.length > 0 && (
          <div className={s.errors} role="alert">
            <h3>请先核对以下内容，当前没有填入</h3>
            {errors.map((e, i) => (
              <article key={i}>
                <p>{e.reason}</p>
                {e.source.text && (
                  <details open>
                    <summary>需要核对的原文</summary>
                    <pre>{e.source.text}</pre>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
        {preview && (
          <div className={s.preview}>
            <h3>核对后填入 · {preview.actorName || '未命名人物'}</h3>
            <p>
              已有资料默认保留。勾选才替换对应内容；聊天和朋友圈追加，并自动避免重复。确认只修改当前编辑稿。
            </p>
            {preview.notices.map((v, i) => (
              <p key={i}>{v}</p>
            ))}
            {preview.fields.map((f) => (
              <article key={f.id} className={s.item}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(f.id)}
                    disabled={blocked || errors.length > 0}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked ? [...old, f.id] : old.filter((v) => v !== f.id),
                      )
                    }
                  />
                  {f.existing ? '替换' : '填入'}
                  {f.label}
                </label>
                {f.existing && (
                  <details>
                    <summary>目前的内容（默认保留）</summary>
                    <pre>{f.existing}</pre>
                  </details>
                )}
                <div className={s.comparison}>
                  <div>
                    <h4>原文</h4>
                    <pre>{f.source.text}</pre>
                  </div>
                  <div>
                    <h4>
                      将填入：{f.label} · {f.value.length} / {f.limit} 字符
                    </h4>
                    <p>
                      {f.value.length <= f.limit
                        ? `还可保存 ${f.limit - f.value.length} 字符`
                        : `超出 ${f.value.length - f.limit} 字符，不能填入；以下是完整原文`}
                    </p>
                    <pre>{f.value}</pre>
                  </div>
                </div>
              </article>
            ))}
            {preview.messages.length > 0 && (
              <section>
                <h4>追加到双方历史聊天 · {preview.messages.length} 条</h4>
                {preview.messages.map((m, i) => (
                  <article key={i} className={s.item}>
                    {m.interval && <p>隔一段时间 · 新的聊天时间段</p>}
                    <p>
                      {m.speaker === 'actor' ? preview.actorName : '主角'} ·{' '}
                      {m.day ? `${m.day}（明确日期，开场前）` : '开场前（未指定日期）'}
                    </p>
                    <details>
                      <summary>原文</summary>
                      <pre>{m.source.text}</pre>
                    </details>
                    <pre>{m.text}</pre>
                  </article>
                ))}
              </section>
            )}
            {preview.moments.length > 0 && (
              <section>
                <h4>追加到朋友圈 · {preview.moments.length} 条</h4>
                {preview.moments.map((m, i) => (
                  <article key={i} className={s.item}>
                    <p>{m.day ? `${m.day}（明确日期，开场前）` : '开场前（未指定日期）'}</p>
                    <details>
                      <summary>原文</summary>
                      <pre>{m.source.text}</pre>
                    </details>
                    <pre>{m.text}</pre>
                    {m.imageNotes.length > 0 && (
                      <div>
                        <strong>待配图</strong>
                        {m.imageNotes.map((n, j) => (
                          <pre key={j}>{n}</pre>
                        ))}
                        <p>只保留文字说明，没有上传或绑定图片。确认后可在朋友圈编辑区补图。</p>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}
            <p className={s.hint}>
              长篇设定的保存容量与角色每轮模型输入预算分别计算；保存完整不表示模型每轮读完全文。
            </p>
            <button type="button" onClick={confirm} disabled={blocked || errors.length > 0}>
              确认填入当前人物
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
