import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links, Search } from './common.tsx';
import { searchable, timeText } from './helpers.ts';
import s from './apps.module.css';
/** Reserved navigation target, separate from opaque IDs via explicit prefix. */
export const NEW_NOTE_TARGET = 'new-note';
export function NotesApp({ target, open }: PhoneAppContext) {
  const { data, actions, noteDrafts, setNoteDraft, clearNoteDraft, operations, run } =
    usePhoneApps();
  const [query, setQuery] = useState('');
  const note = data.notes.find((n) => n.id === target),
    isNew = target === NEW_NOTE_TARGET && !note;
  const key = target ?? '',
    draft = noteDrafts[key] ?? {
      title: note?.title ?? '',
      text: note?.text ?? '',
      expectedVersion: note?.version,
    };
  const operation = operations[`note:${key}`];
  if (target && !note && !isNew)
    return <Empty title="找不到这条便签" text="便签可能已移除，请返回列表或刷新。" />;
  if (target) {
    const changed = isNew
      ? !!(draft.title.trim() || draft.text.trim())
      : draft.title !== note!.title || draft.text !== note!.text;
    const signature = JSON.stringify(draft);
    const awaiting = operation?.status === 'accepted' && operation.signature === signature;
    const conflict =
      note &&
      draft.expectedVersion !== undefined &&
      draft.expectedVersion !== note.version &&
      changed;
    return (
      <form
        className={`${s.app} ${s.noteEditor}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!actions.saveNote || operation?.busy || awaiting || !changed || !draft.title.trim())
            return;
          const receipt = await run(`note:${key}`, signature, (commandId) =>
            actions.saveNote!({
              ...(note ? { id: note.id } : {}),
              title: draft.title.trim(),
              text: draft.text,
              expectedVersion: draft.expectedVersion,
              commandId,
            }),
          );
          if (receipt?.status === 'committed') {
            clearNoteDraft(key);
            open('notes');
          }
        }}
      >
        <div className={s.noteToolbar}>
          <span>{changed ? '未保存的草稿' : '已保存的便签'}</span>
          <button
            className={s.noteAction}
            type="submit"
            disabled={
              !actions.saveNote ||
              operation?.busy ||
              awaiting ||
              !changed ||
              !draft.title.trim() ||
              !!conflict
            }
          >
            {operation?.busy
              ? '保存中…'
              : operation?.errorCode === 'UNKNOWN' && operation.signature === signature
                ? '确认重试保存'
                : isNew && operation?.status === 'committed' && changed
                  ? '另存新便签'
                  : '完成'}
          </button>
        </div>
        {note && <time className={s.noteDate}>{timeText(note.updatedAt)}</time>}
        <label className={s.srOnly} htmlFor="note-title">
          便签标题
        </label>
        <input
          id="note-title"
          className={s.noteTitle}
          value={draft.title}
          maxLength={120}
          placeholder="标题"
          disabled={!!operation?.busy}
          onChange={(e) => setNoteDraft(key, { ...draft, title: e.target.value })}
        />
        <label className={s.srOnly} htmlFor="note-text">
          便签正文
        </label>
        <textarea
          id="note-text"
          className={s.noteBody}
          value={draft.text}
          maxLength={10000}
          placeholder="记下此刻的想法…"
          disabled={!!operation?.busy}
          onChange={(e) => setNoteDraft(key, { ...draft, text: e.target.value })}
        />
        <div className={s.inline}>
          {conflict && (
            <div role="alert" className={s.error}>
              <p>便签已有新版本。你的草稿还在，请核对最新内容后再保存。</p>
              <details>
                <summary>查看最新便签</summary>
                <h4>{note.title}</h4>
                <p>{note.text}</p>
              </details>
              <button
                type="button"
                onClick={() => setNoteDraft(key, { ...draft, expectedVersion: note.version })}
              >
                已核对，保留我的草稿
              </button>
            </div>
          )}
          <Feedback
            operation={operation}
            success={
              changed && operation?.signature !== signature
                ? '提交的版本已保存，当前修改尚未保存。'
                : '便签已保存'
            }
          />
          {!actions.saveNote && <small>便签保存尚未接入，草稿仅在当前页面保留。</small>}
          {isNew && operation?.status === 'committed' && (
            <button type="button" onClick={() => open('notes')}>
              返回便签列表
            </button>
          )}
          <Links links={note?.links} open={open} />
        </div>
      </form>
    );
  }
  const notes = [...data.notes]
    .filter((n) => searchable(query, n.title, n.text))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className={`${s.app} ${s.notes}`}>
      <div className={s.sectionHeading}>
        <h3>所有便签</h3>
        <button className={s.noteAction} onClick={() => open('notes', NEW_NOTE_TARGET)}>
          新建便签
        </button>
      </div>
      <Search value={query} onChange={setQuery} label="搜索便签" />
      {noteDrafts[NEW_NOTE_TARGET] && (
        <button className={s.draftRow} onClick={() => open('notes', NEW_NOTE_TARGET)}>
          继续未保存的新便签
        </button>
      )}
      <div className={s.noteList}>
        {notes.map((n) => (
          <button key={n.id} onClick={() => open('notes', n.id)}>
            <strong>{noteDrafts[n.id]?.title ?? n.title}</strong>
            <p>{noteDrafts[n.id] ? '未保存的草稿' : n.text}</p>
            <time>{timeText(n.updatedAt)}</time>
          </button>
        ))}
      </div>
      {!notes.length && (
        <Empty
          title={query ? '没有找到便签' : '记下这段人生的第一件小事'}
          text={query ? '试试其他关键词。' : '点击“新建便签”开始记录。'}
        />
      )}
    </div>
  );
}
