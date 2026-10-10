import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links, Search } from './common.tsx';
import { searchable, timeText } from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
import {
  NotesRecords,
  NotesRecordDetail,
  NotesRecordsReadState,
  isSystemRecordTarget,
} from './notes-records.tsx';
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
    records,
    reloadRecords,
  } = usePhoneApps();
  const query = drafts['notes:search'] ?? '';
  const setQuery = (value: string) => setDraft('notes:search', value);
  const reload = reloadRecords
    ? () => {
        void reloadRecords();
      }
    : undefined;

  const note = data.notes.find((n) => n.id === target),
    isNew = target === NEW_NOTE_TARGET && !note;
  const key = target ?? '',
    draft = noteDrafts[key] ?? {
      title: note?.title ?? '',
      text: note?.text ?? '',
      expectedVersion: note?.version,
    };
  const operation = operations[`note:${key}`];
  if (isSystemRecordTarget(target))
    return (
      <div className={`${s.app} ${r.notesPage}`}>
        <nav className={r.recordNavigation} aria-label="备忘录导航">
          <button
            type="button"
            className={r.recordBack}
            aria-label="返回备忘录"
            onClick={() => open('notes')}
          >
            <span aria-hidden="true">‹</span> 备忘录
          </button>
        </nav>
        {records.status === 'ready' ? (
          <NotesRecordDetail data={records.data} target={target!} open={open} />
        ) : (
          <NotesRecordsReadState
            status={records.status}
            error={records.status === 'error' ? records.error : undefined}
            reload={reload}
          />
        )}
      </div>
    );
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
          if (!changed) {
            open('notes');
            return;
          }
          if (!actions.saveNote || operation?.busy || awaiting) return;
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
            <span>备忘录</span>
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
              disabled={!actions.saveNote || operation?.busy || awaiting || !!conflict}
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
  const notes = [...data.notes]
    .filter((n) => searchable(query, n.title, n.text))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const choices = [...(data.choices ?? [])]
    .filter((choice) =>
      searchable(
        query,
        choice.intent,
        choice.quote,
        choice.nextStep?.quote ?? '',
        choice.result?.quote ?? '',
      ),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className={`${s.app} ${r.notesPage}`}>
      {/* 顶部 iOS 原生备忘录大标题栏 */}
      <div
        style={{
          padding: '12px 14px 4px',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#0f172a' }}>备忘录</h2>
          <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 500 }}>
            我的便签 · {data.notes.length} 篇
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            playTapSound();
            open('notes', NEW_NOTE_TARGET);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#d97706',
            fontSize: '22px',
            cursor: 'pointer',
            padding: '2px',
          }}
          title="新建便签"
        >
          📝
        </button>
      </div>

      <div style={{ padding: '4px 12px 8px' }}>
        <Search value={query} onChange={setQuery} label="搜索备忘录" />
      </div>

      {records.status === 'ready' ? (
        <NotesRecords
          data={records.data}
          query={query}
          open={open}
          historyOpen={drafts['notes:history-open'] === 'true'}
          onHistoryToggle={(value) => setDraft('notes:history-open', String(value))}
        />
      ) : (
        <NotesRecordsReadState
          status={records.status}
          error={records.status === 'error' ? records.error : undefined}
          reload={reload}
        />
      )}
      {records.status !== 'ready' && choices.length > 0 && (
        <section className={s.choiceSection} aria-label="这段人生的选择">
          <h3>已有选择记录</h3>
          {choices.map((choice) => (
            <details key={choice.id} className={s.choiceCard}>
              <summary>
                <span className={s.choiceMarker} aria-hidden="true" />
                <span className={s.choiceSummary}>
                  <strong>{choice.intent}</strong>
                  <small>
                    {choice.actorName} · {timeText(choice.at)}
                  </small>
                </span>
                <span className={s.choiceState}>
                  {choice.result?.kind === 'reported_done'
                    ? '你说已完成'
                    : choice.result?.kind === 'blocked'
                      ? choice.recoveryStep
                        ? '有新建议'
                        : '遇到阻碍'
                      : choice.result?.kind === 'abandoned'
                        ? '你说已放下'
                        : choice.nextStep
                          ? '有下一步'
                          : choice.status === 'followed_up'
                            ? '有人问起'
                            : '待续'}
                </span>
              </summary>
              <div className={s.choiceDetail}>
                <p>
                  <span>你当时说</span>
                  {choice.quote}
                </p>
                {choice.nextStep && (
                  <>
                    <p>
                      <span>
                        {choice.actorName}后来提出 · {timeText(choice.nextStep.at)}
                      </span>
                      {choice.nextStep.quote}
                    </p>
                    {choice.nextStep.calendar && (
                      <button
                        type="button"
                        className={s.choiceCalendarLink}
                        onClick={() =>
                          choice.nextStep?.calendar && open('calendar', choice.nextStep.calendar.id)
                        }
                      >
                        <span>
                          日历 · {choice.nextStep.calendar.title}
                          <small>
                            {
                              {
                                proposed: '待你确认',
                                confirmed: '已确认',
                                cancelled: '已取消',
                                attended: '你标记已赴约',
                                missed: '你标记未赴约',
                              }[choice.nextStep.calendar.status]
                            }
                          </small>
                        </span>
                        <span aria-hidden="true">›</span>
                      </button>
                    )}
                  </>
                )}
                {choice.result && (
                  <p>
                    <span>你后来补充 · {timeText(choice.result.at)}</span>
                    {choice.result.quote}
                  </p>
                )}
                {choice.result?.kind === 'blocked' && choice.recoveryStep && (
                  <p>
                    <span>
                      {choice.actorName}后来建议 · {timeText(choice.recoveryStep.at)}
                    </span>
                    {choice.recoveryStep.quote}
                  </p>
                )}
                {choice.result && <small>结果来自你的讲述，尚无独立佐证。</small>}
              </div>
            </details>
          ))}
        </section>
      )}
      <h3 className={r.privateHeading}>我的便签</h3>
      {noteDrafts[NEW_NOTE_TARGET] && (
        <button className={s.draftRow} onClick={() => open('notes', NEW_NOTE_TARGET)}>
          继续未保存的新便签
        </button>
      )}

      <div className={`${s.noteList} ${r.privateList}`}>
        {notes.map((n) => (
          <div key={n.id} style={{ position: 'relative' }}>
            <button className={s.noteRow} onClick={() => open('notes', n.id)}>
              <strong>{noteDrafts[n.id]?.title ?? n.title}</strong>
              <p>{noteDrafts[n.id] ? '未保存的草稿' : n.text}</p>
              <time>{timeText(n.updatedAt)}</time>
            </button>
            {actions.deleteNote && (
              <button
                type="button"
                aria-label={`删除便签 ${n.title}`}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '12px',
                  background: 'none',
                  border: 'none',
                  fontSize: '14px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  zIndex: 2,
                }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`确定要删除便签“${n.title}”吗？`)) {
                    await actions.deleteNote!(n.id);
                  }
                }}
              >
                ✕
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

      {/* 底部 iOS 原生备忘录金黄色工具栏 */}
      <footer
        style={{
          height: '46px',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        <div style={{ width: '28px' }} />
        <span style={{ fontSize: '12px', color: '#64748b' }}>{data.notes.length} 篇私人便签</span>
        <button
          type="button"
          onClick={() => {
            playTapSound();
            open('notes', NEW_NOTE_TARGET);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#d97706',
            fontSize: '22px',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="新建便签"
        >
          📝
        </button>
      </footer>
    </div>
  );
}
