import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneContact } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty, Feedback, Links, Search } from './common.tsx';
import { searchable, timeText } from './helpers.ts';
import s from './apps.module.css';
/** Reserved navigation target, separate from opaque IDs via explicit prefix. */
export const NEW_NOTE_TARGET = 'new-note';
export function NotesApp({ target, open }: PhoneAppContext) {
  const { data, actions, noteDrafts, setNoteDraft, clearNoteDraft, operations, run, setDraft } =
    usePhoneApps();
  const [query, setQuery] = useState('');
  const [sharingNote, setSharingNote] = useState<{ title: string; text: string } | null>(null);
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {data.contacts.length > 0 && (
              <button
                type="button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  background: '#f0fdf4',
                  color: '#15803d',
                  border: '1px solid #bbf7d0',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onClick={() =>
                  setSharingNote({
                    title: draft.title || note?.title || '便签',
                    text: draft.text || note?.text || '',
                  })
                }
              >
                💬 分享给TA
              </button>
            )}
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
        {data.contacts.length > 0 && (
          <div
            style={{
              marginTop: '12px',
              padding: '12px 14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                💬 与身边的人讨论这段想法
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                一键把便签内容带入微信对话
              </div>
            </div>
            <button
              type="button"
              style={{
                padding: '7px 12px',
                borderRadius: '8px',
                background: '#07c160',
                color: '#ffffff',
                border: 'none',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={() =>
                setSharingNote({
                  title: draft.title || note?.title || '便签',
                  text: draft.text || note?.text || '',
                })
              }
            >
              选择好友 →
            </button>
          </div>
        )}
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
                : actions.saveNote
                  ? '便签已保存'
                  : '已保存在这台设备'
            }
          />
          {!actions.saveNote && (
            <small>便签同步尚未接入：内容只保存在当前浏览器，换设备或清除数据会丢失。</small>
          )}
          {isNew && operation?.status === 'committed' && (
            <button type="button" onClick={() => open('notes')}>
              返回便签列表
            </button>
          )}
          <Links links={note?.links} open={open} />
        </div>
        {sharingNote && (
          <ShareNoteModal
            note={sharingNote}
            contacts={data.contacts}
            onClose={() => setSharingNote(null)}
            onShare={(contactId) => {
              const text = `我刚在便签里记录了这段想法，你帮我看看：\n\n【${sharingNote.title || '便签'}】\n${sharingNote.text}`;
              setDraft(contactId, text);
              setSharingNote(null);
              open('messages', contactId);
            }}
          />
        )}
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
      {data.contacts.length > 0 && notes.length > 0 && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px 14px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
            💡 便签与生活联动
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
            点击任意便签，可在上方或底部一键将便签想法分享给微信好友，开启全新对话。
          </div>
        </div>
      )}
      {!notes.length && (
        <Empty
          title={query ? '没有找到便签' : '记下这段人生的第一件小事'}
          text={query ? '试试其他关键词。' : '点击“新建便签”开始记录。'}
        />
      )}
      {sharingNote && (
        <ShareNoteModal
          note={sharingNote}
          contacts={data.contacts}
          onClose={() => setSharingNote(null)}
          onShare={(contactId) => {
            const text = `我刚在便签里记录了这段想法，你帮我看看：\n\n【${sharingNote.title || '便签'}】\n${sharingNote.text}`;
            setDraft(contactId, text);
            setSharingNote(null);
            open('messages', contactId);
          }}
        />
      )}
    </div>
  );
}

function ShareNoteModal({
  note,
  contacts,
  onClose,
  onShare,
}: {
  note: { title: string; text: string };
  contacts: readonly PhoneContact[];
  onClose: () => void;
  onShare: (contactId: string) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          background: '#ffffff',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          padding: '20px',
          boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
              💬 分享便签至微信
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              选择你想探讨想法的角色好友
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              fontSize: '14px',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '13px',
            color: '#334155',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <strong style={{ color: '#0f172a' }}>【{note.title || '无标题便签'}】</strong>
          <span
            style={{
              color: '#64748b',
              fontSize: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {note.text || '（空便签）'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
            微信联系人
          </div>
          {contacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
              onClick={() => onShare(contact.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Avatar url={contact.avatarUrl} name={contact.name} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                    {contact.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {contact.relationship}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 500 }}>
                发给TA →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

