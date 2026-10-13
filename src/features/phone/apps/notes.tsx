import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links, Search } from './common.tsx';
import { searchable, timeText } from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
import { isSystemRecordTarget } from './notes-records.tsx';
import r from './notes-records.module.css';
/** Reserved navigation target, separate from opaque IDs via explicit prefix. */
export const NEW_NOTE_TARGET = 'new-note';
export function NotesApp({ target, open }: PhoneAppContext) {
  const {
    data,
    actions,
    noteDrafts,
    setNoteDraft,
    clearNoteDraft,
    operations,
    run,
    setDraft,
    drafts,
  } = usePhoneApps();

  const query = drafts['notes:search'] ?? '';
  const setQuery = (value: string) => setDraft('notes:search', value);

  const note = data.notes.find((n) => n.id === target);
  const isNew = target === NEW_NOTE_TARGET && !note;
  const isPrivateNote = (n: (typeof data.notes)[number]) => n.origin === undefined;

  const key = target ?? '';
  const draft = noteDrafts[key] ?? {
    title: note?.title ?? '',
    text: note?.text ?? '',
    expectedVersion: note?.version,
  };
  const operation = operations[`note:${key}`];

  // 1. 如果带有系统记录的 target（如旧链接跳转过来），直接路由到 records App
  if (isSystemRecordTarget(target)) {
    return (
      <div className={`${s.app} ${r.notesPage}`}>
        <nav className={r.recordNavigation} aria-label="备忘录导航">
          <button
            type="button"
            className={r.recordBack}
            aria-label="查看人生记录"
            onClick={() => open('records', target)}
          >
            <span aria-hidden="true">‹</span> 这条记录属于「人生记录」，点击前往查看 →
          </button>
        </nav>
      </div>
    );
  }

  // 2. 找不到便签
  if (target && !note && !isNew) {
    return <Empty title="找不到这条便签" text="便签可能已移除，请返回列表或刷新。" />;
  }

  // 3. 开场设定便签（只读，提示去人生记录）
  if (note && !isPrivateNote(note)) {
    return (
      <article className={s.app}>
        <button type="button" onClick={() => open('notes')}>
          ‹ 返回便签
        </button>
        <h2>{note.title}</h2>
        <p>这段人生的开场记录 · 来自已确认的设定</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{note.text}</p>
        <div style={{ marginTop: '16px' }}>
          <button
            type="button"
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              fontSize: '13px',
            }}
            onClick={() => open('records')}
          >
            前往「人生记录」查看完整设定与进展 →
          </button>
        </div>
      </article>
    );
  }

  // 4. 编辑便签（私人便签专属）
  if (target) {
    const changed = isNew
      ? !!(draft.title.trim() || draft.text.trim())
      : draft.title !== note!.title || draft.text !== note!.text;
    const lengthError =
      draft.title.trim().length > 80
        ? '标题最多80字，请缩短后保存。'
        : draft.text.length > 2000
          ? '正文最多2000字，草稿已保留，请缩短后保存。'
          : undefined;
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
          if (!changed) {
            open('notes');
            return;
          }
          if (!actions.saveNote || operation?.busy || awaiting || lengthError) return;
          const resolvedTitle =
            draft.title.trim() ||
            draft.text.trim().split('\n')[0]?.trim().slice(0, 25) ||
            '无标题便签';
          const receipt = await run(`note:${key}`, signature, (commandId) =>
            actions.saveNote!({
              ...(note ? { id: note.id } : {}),
              title: resolvedTitle,
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
        {/* 顶部 iOS 原生备忘录金黄色导航栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #f1f5f9',
            background: '#ffffff',
            minHeight: '44px',
            margin: '-12px -12px 12px -12px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              playTapSound();
              open('notes');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              background: 'none',
              border: 'none',
              color: '#d97706',
              fontSize: '15px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span>
            <span>便签</span>
          </button>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {note && actions.deleteNote && (
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px',
                }}
                title="删除"
                onClick={async () => {
                  playTapSound();
                  if (confirm('确定要删除这条便签吗？')) {
                    await actions.deleteNote!(note.id);
                    clearNoteDraft(key);
                    open('notes');
                  }
                }}
              >
                🗑️
              </button>
            )}

            <button
              className={s.noteAction}
              type="submit"
              disabled={
                !actions.saveNote || operation?.busy || awaiting || !!conflict || !!lengthError
              }
              style={{
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
                borderRadius: '14px',
                padding: '4px 12px',
                fontWeight: 600,
              }}
            >
              {operation?.busy
                ? '保存中…'
                : operation?.errorCode === 'UNKNOWN' && operation.signature === signature
                  ? '重试保存'
                  : '完成'}
            </button>
          </div>
        </div>

        {/* 备忘录快捷小工具栏：待办清单、时间戳 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '8px',
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onClick={() => {
              playTapSound();
              const prefix = draft.text && !draft.text.endsWith('\n') ? '\n' : '';
              setNoteDraft(key, { ...draft, text: draft.text + prefix + '- [ ] ' });
            }}
          >
            ☑️ 插入待办清单
          </button>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '8px',
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onClick={() => {
              playTapSound();
              const nowStr = timeText(data.referenceTime ?? '').slice(11);
              if (!nowStr) return;
              const prefix = draft.text && !draft.text.endsWith('\n') ? '\n' : '';
              setNoteDraft(key, { ...draft, text: draft.text + prefix + `[${nowStr}] ` });
            }}
          >
            🕒 插入时间
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
          maxLength={80}
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
          maxLength={2000}
          placeholder="记下此刻的想法…"
          disabled={!!operation?.busy}
          onChange={(e) => setNoteDraft(key, { ...draft, text: e.target.value })}
        />

        <div className={s.inline}>
          {lengthError && (
            <p role="alert" className={s.error}>
              {lengthError}
            </p>
          )}
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
                : actions.noteSync === 'local'
                  ? '已保存在这台设备'
                  : '便签已保存'
            }
          />
          {actions.noteSync === 'local' && (
            <small>便签同步尚未接入：内容只保存在当前浏览器，换设备或清除数据会丢失。</small>
          )}
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

  // 5. 备忘录主列表：只保留纯私密便签
  const notes = [...data.notes]
    .filter(isPrivateNote)
    .filter((n) =>
      searchable(query, noteDrafts[n.id]?.title ?? n.title, noteDrafts[n.id]?.text ?? n.text),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className={`${s.app} ${r.notesPage}`}>
      <header className={r.notesHeader}>
        <h2>备忘录</h2>
        <button
          className={r.newNote}
          type="button"
          onClick={() => {
            playTapSound();
            open('notes', NEW_NOTE_TARGET);
          }}
        >
          新建便签
        </button>
      </header>

      {/* 顶部单张卡片：关于这段人生与系统记录（引导至人生记录 App） */}
      <div
        style={{
          margin: '0 0 14px',
          padding: '12px 14px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => open('records')}
      >
        <div>
          <strong style={{ fontSize: '14px', color: '#1e293b', display: 'block' }}>
            关于这段人生 · 事实与进展
          </strong>
          <span style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', display: 'block' }}>
            起点身份、世界设定、眼下事项与阶段记录
          </span>
        </div>
        <span style={{ fontSize: '14px', color: '#3b82f6', fontWeight: 600 }}>查看 ›</span>
      </div>

      <Search value={query} onChange={setQuery} label="搜索便签" />

      <h3 className={r.privateHeading}>我的便签</h3>
      {noteDrafts[NEW_NOTE_TARGET] &&
        (!query.trim() ||
          searchable(
            query,
            noteDrafts[NEW_NOTE_TARGET].title,
            noteDrafts[NEW_NOTE_TARGET].text,
          )) && (
          <button
            type="button"
            className={s.draftRow}
            onClick={() => open('notes', NEW_NOTE_TARGET)}
          >
            继续未保存的新便签
          </button>
        )}

      <div className={`${s.noteList} ${r.privateList}`}>
        {notes.map((n) => (
          <div key={n.id} className={r.privateRow}>
            <button className={s.noteRow} onClick={() => open('notes', n.id)}>
              <strong>{noteDrafts[n.id]?.title ?? n.title}</strong>
              <p>{noteDrafts[n.id] ? '未保存的草稿' : n.text}</p>
              <time>{timeText(n.updatedAt)}</time>
            </button>
            {actions.deleteNote && (
              <button
                type="button"
                className={r.deleteNote}
                aria-label={`删除便签 ${n.title}`}
                onClick={async () => {
                  if (confirm(`确定要删除便签“${n.title}”吗？`)) {
                    await actions.deleteNote!(n.id);
                  }
                }}
              >
                ×
              </button>
            )}
          </div>
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
