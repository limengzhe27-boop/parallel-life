'use client';
import { useEffect, useRef, useState } from 'react';
import {
  parseScriptLibraryMarkdown,
  reviseScriptLibraryPreview,
  SCRIPT_DOCUMENT_MAX_BYTES,
  type ScriptLibraryPreview,
} from './publisher-script-library.ts';
import {
  applyScriptLibraryPreview,
  scriptEventMatches,
  scriptLibraryFingerprint,
  type ScriptImportChoice,
} from './publisher-script-library-apply.ts';
import s from './publisher-script-library.module.css';
import { extractZipEntries } from './publisher-zip.ts';
type Props = {
  content: Record<string, unknown>;
  disabled: boolean;
  onClose(): void;
  onApply(content: Record<string, unknown>): void;
};
export function PublisherScriptLibraryDialog(props: Props) {
  const [text, setText] = useState(''),
    [preview, setPreview] = useState<ScriptLibraryPreview | null>(null),
    [choices, setChoices] = useState<Record<string, ScriptImportChoice>>({}),
    [merges, setMerges] = useState<Record<string, string>>({}),
    [assignments, setAssignments] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [reading, setReading] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  const baseline = useRef(''),
    readSequence = useRef(0),
    mounted = useRef(true),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
      readSequence.current++;
    };
  }, []);
  const stale = !!preview && baseline.current !== scriptLibraryFingerprint(props.content);
  const revised = preview ? reviseScriptLibraryPreview(preview, merges, assignments) : null;
  const result = revised ? applyScriptLibraryPreview(props.content, revised, choices) : null;
  function change(value: string) {
    readSequence.current++;
    setText(value);
    setPreview(null);
    setError('');
    setChoices({});
    setMerges({});
    setAssignments({});
    setReading(false);
  }
  function recognize() {
    if (props.disabled || reading) return;
    const places = Array.isArray(props.content.places)
      ? (props.content.places as { key: string; name: string }[])
      : [];
    baseline.current = scriptLibraryFingerprint(props.content);
    setPreview(parseScriptLibraryMarkdown(text, places));
    setChoices({});
    setMerges({});
    setAssignments({});
    setError('');
  }
  async function read(file?: File) {
    if (!file || props.disabled) return;
    const seq = ++readSequence.current;
    setReading(true);
    try {
      const zip = /\.zip$/i.test(file.name);
      if (file.size > (zip ? 50 * 1024 * 1024 : SCRIPT_DOCUMENT_MAX_BYTES))
        throw Error('文件超过本次识别容量，请分章节导入。');
      const buffer = await file.arrayBuffer();
      const value = zip
        ? (await extractZipEntries(buffer)).map((file) => file.content).join('\n\n')
        : new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (new TextEncoder().encode(value).length > SCRIPT_DOCUMENT_MAX_BYTES)
        throw Error('文稿正文合计超过本次识别容量，请解压后分章节导入；原输入保留。');
      if (mounted.current && seq === readSequence.current) {
        setText(value);
        setPreview(null);
        setChoices({});
        setError('');
      }
    } catch (e) {
      if (mounted.current && seq === readSequence.current)
        setError(e instanceof Error ? e.message : '文稿读取失败，请选择 UTF-8 Markdown 文件。');
    } finally {
      if (mounted.current && seq === readSequence.current) setReading(false);
    }
  }
  function confirm() {
    if (!result?.ok || latest.current.disabled || stale || reading) return;
    latest.current.onApply(result.content);
    latest.current.onClose();
  }
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="script-import-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <header className={s.header}>
        <h2 id="script-import-title">导入事件与地点</h2>
        <button type="button" onClick={props.onClose}>
          关闭
        </button>
      </header>
      <div className={s.body}>
        <p className={s.hint}>
          识别标题、地址汇总和场景，完整保留正文。不会调用 AI 或自动设置前提。
        </p>
        <label className={s.field}>
          选择 Markdown 或 ZIP 文稿
          <input
            type="file"
            accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"
            disabled={props.disabled || reading}
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className={s.field}>
          或粘贴文稿
          <textarea
            rows={9}
            value={text}
            disabled={props.disabled}
            onChange={(e) => change(e.target.value)}
            placeholder={
              '地址汇总：城市街边，医院走廊\n\n开场事件：……\n场景：城市街边与手机聊天界面\n正文……\n\n1.\n#### 事件标题\n场景：医院走廊\n事件正文……'
            }
          />
        </label>
        <button
          type="button"
          disabled={props.disabled || reading || !text.trim()}
          onClick={recognize}
        >
          {reading ? '正在读取…' : '识别并预览'}
        </button>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {revised && (
          <>
            <p role="status">
              识别到 {revised.events.filter((e) => !e.opening).length} 个事件
              {revised.events.some((e) => e.opening) ? '和一个开场事件' : ''}、
              {revised.places.length} 个地点。
            </p>
            <details>
              <summary>地点汇总与关联</summary>
              {preview!.places.map((p) => (
                <label key={p.key} className={s.place}>
                  {p.name}
                  <select
                    aria-label={`地点${p.name}合并到`}
                    value={merges[p.key] ?? ''}
                    onChange={(e) => setMerges({ ...merges, [p.key]: e.target.value })}
                  >
                    <option value="">独立保留</option>
                    {preview!.places
                      .filter((other) => other.key !== p.key)
                      .map((other) => (
                        <option key={other.key} value={other.key}>
                          并入 {other.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </details>
            {revised.events.map((event) => {
              const matches = scriptEventMatches(props.content, event.title);
              return (
                <details key={event.key} className={s.card}>
                  <summary>
                    {event.opening ? '开场 · ' : event.number ? `${event.number}. ` : ''}
                    {event.title}
                  </summary>
                  <p className={s.hint}>{event.sceneText || '原稿未单列场景'}</p>
                  <pre>{event.body}</pre>
                  {matches.length > 0 && (
                    <label className={s.field}>
                      已有对应事件
                      <select
                        value={
                          choices[event.key]?.replace
                            ? 'replace'
                            : choices[event.key]?.skip
                              ? 'skip'
                              : 'keep'
                        }
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [event.key]: {
                              ...choices[event.key],
                              replace: e.target.value === 'replace',
                              skip: e.target.value === 'skip',
                              targetKey: choices[event.key]?.targetKey ?? String(matches[0]!.key),
                            },
                          })
                        }
                      >
                        <option value="keep">保留已有正文</option>
                        <option value="replace">用本次原稿更新正文与场景</option>
                        <option value="skip">本次不导入这条</option>
                      </select>
                      {matches.length > 1 && (
                        <select
                          aria-label="选择对应的已有事件"
                          value={choices[event.key]?.targetKey ?? ''}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [event.key]: { ...choices[event.key], targetKey: e.target.value },
                            })
                          }
                        >
                          <option value="">请选择已有事件</option>
                          {matches.map((m) => (
                            <option key={String(m.key)} value={String(m.key)}>
                              {String(m.title)}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  )}
                </details>
              );
            })}
            {revised.unassigned.length > 0 && (
              <section>
                <h3>尚未归入事件的原文</h3>
                {preview!.unassigned.map((part) => (
                  <div className={s.card} key={part.key}>
                    <pre>{part.source.text}</pre>
                    <select
                      aria-label="将原文归入事件"
                      value={assignments[part.key] ?? ''}
                      onChange={(e) =>
                        setAssignments({ ...assignments, [part.key]: e.target.value })
                      }
                    >
                      <option value="">请选择归入的事件</option>
                      {preview!.events.map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </section>
            )}
            {revised.issues.map((issue, i) => (
              <p key={i} className={s.error}>
                {issue.reason}
              </p>
            ))}
            {result && !result.ok && !revised.issues.length && (
              <p className={s.hint}>{result.message}</p>
            )}
            {stale && <p className={s.error}>当前草稿已有变化，请重新识别后再填入。</p>}
            {result?.ok && (
              <p className={s.hint}>
                将新增 {result.addedEvents} 个事件、{result.addedPlaces} 个地点，更新{' '}
                {result.updatedEvents} 个已有事件。填入后请保存草稿。
              </p>
            )}
          </>
        )}
      </div>
      <footer className={s.footer}>
        <button type="button" onClick={props.onClose}>
          取消
        </button>
        <button
          type="button"
          disabled={props.disabled || reading || stale || !result?.ok}
          onClick={confirm}
        >
          填入编辑稿
        </button>
      </footer>
    </dialog>
  );
}
