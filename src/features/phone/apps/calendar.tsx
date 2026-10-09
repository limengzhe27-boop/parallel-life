import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneInvitation } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import {
  dayKey,
  monthDays,
  shiftMonth,
  rescheduleAt,
  timeText,
  worldDateTimeInput,
} from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
const statusLabel = {
  proposed: '待确认邀约',
  confirmed: '已确认',
  cancelled: '已取消',
  attended: '已赴约',
  missed: '未赴约',
};
export function CalendarApp({ target, open }: PhoneAppContext) {
  const { data, actions, drafts, setDraft } = usePhoneApps();
  const [tab, setTab] = useState<'today' | 'calendar' | 'invitations'>('calendar');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // 今天基准日期（如果 data.referenceTime 存在使用它，否则使用第一条约定或当前系统时间）
  const todayKey = dayKey(
    data.referenceTime ?? data.invitations[0]?.at ?? new Date().toISOString(),
  );
  const initial = todayKey;
  const selected = drafts['calendar:day'] ?? initial;
  const month = drafts['calendar:month'] ?? selected.slice(0, 7);
  const invitation = data.invitations.find((i) => i.id === target);

  if (target && !invitation)
    return <Empty title="找不到这项日程" text="请返回日历或刷新后再试。" />;
  if (invitation)
    return <InvitationDetail key={invitation.id} invitation={invitation} open={open} />;

  const days = monthDays(month);
  const activeDate = tab === 'today' ? todayKey : selected;
  const dayInvitations = data.invitations
    .filter((i) => dayKey(i.at) === activeDate)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const pendingInvitations = data.invitations
    .filter((i) => i.status === 'proposed')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <div className={`${s.app} ${s.calendar}`} style={{ background: '#f8fafc' }}>
      {/* 顶部 iOS 原生红白日历导航栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
          minHeight: '44px',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444' }}>日历</span>
        <div className={s.segment} role="group" aria-label="日历视图" style={{ margin: 0 }}>
          <button
            aria-pressed={tab === 'today'}
            onClick={() => {
              playTapSound();
              setTab('today');
              setDraft('calendar:day', todayKey);
              setDraft('calendar:month', todayKey.slice(0, 7));
            }}
          >
            今天
          </button>
          <button
            aria-pressed={tab === 'calendar'}
            onClick={() => {
              playTapSound();
              setTab('calendar');
            }}
          >
            月历
          </button>
          <button
            aria-pressed={tab === 'invitations'}
            onClick={() => {
              playTapSound();
              setTab('invitations');
            }}
          >
            待办{pendingInvitations.length > 0 ? ` (${pendingInvitations.length})` : ''}
          </button>
        </div>

        {actions.sendMessage && data.contacts.length > 0 && (
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              fontSize: '24px',
              fontWeight: 300,
              cursor: 'pointer',
              lineHeight: 1,
              padding: '2px 6px',
            }}
            title="添加新日程"
            onClick={() => {
              playTapSound();
              setShowCreateModal(true);
            }}
          >
            +
          </button>
        )}
      </div>

      {tab === 'calendar' && (
        <>
          <div className={s.monthHeader}>
            <button
              aria-label="上个月"
              onClick={() => {
                const next = shiftMonth(month, -1);
                setDraft('calendar:month', next);
                setDraft('calendar:day', next + '-01');
              }}
            >
              ‹
            </button>
            <h3>{month.replace('-', ' 年 ')} 月</h3>
            <button
              aria-label="下个月"
              onClick={() => {
                const next = shiftMonth(month, 1);
                setDraft('calendar:month', next);
                setDraft('calendar:day', next + '-01');
              }}
            >
              ›
            </button>
          </div>
          <div className={s.week} aria-hidden>
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className={s.monthGrid} role="group" aria-label={`${month} 月历`}>
            {days.map((day, i) =>
              day ? (
                <button
                  key={day}
                  aria-label={`${day}${data.invitations.some((n) => dayKey(n.at) === day) ? '，有日程' : ''}`}
                  aria-pressed={selected === day}
                  onClick={() => setDraft('calendar:day', day)}
                >
                  <span>{Number(day.slice(-2))}</span>
                  <i
                    className={
                      data.invitations.some((n) => dayKey(n.at) === day && n.status !== 'cancelled')
                        ? s.dayDot
                        : undefined
                    }
                  />
                </button>
              ) : (
                <span key={`pad-${i}`} />
              ),
            )}
          </div>
        </>
      )}

      {tab === 'invitations' ? (
        <div style={{ padding: '12px' }}>
          <div className={s.sectionHeading}>
            <h3>待确认约定</h3>
            <small>{pendingInvitations.length} 项</small>
          </div>
          <div className={s.agenda}>
            {pendingInvitations.map((n) => (
              <button
                key={n.id}
                onClick={() => open('calendar', n.id)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #fed7aa',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  margin: '6px 0',
                }}
              >
                <time>{timeText(n.at).slice(5)}</time>
                <span>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>{n.title}</strong>
                  <small className={s.proposed}>待回复 · 点击接受或改期</small>
                </span>
                <span aria-hidden>›</span>
              </button>
            ))}
            {!pendingInvitations.length && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 16px',
                  color: '#64748b',
                  fontSize: '13px',
                }}
              >
                🎉 目前没有待处理的邀请
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className={s.sectionHeading}>
            <h3>{tab === 'today' ? `今天 (${activeDate})` : activeDate}</h3>
            <small>日程清单</small>
          </div>
          <div className={s.agenda}>
            {dayInvitations.map((n) => (
              <button
                key={n.id}
                onClick={() => open('calendar', n.id)}
                className={n.status === 'cancelled' ? s.cancelled : ''}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  margin: '6px 0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <time style={{ fontWeight: 600, color: '#0284c7' }}>
                  {timeText(n.at).slice(11)}
                </time>
                <span>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>{n.title}</strong>
                  <small className={n.status === 'proposed' ? s.proposed : undefined}>
                    {statusLabel[n.status]}
                  </small>
                </span>
                <span aria-hidden style={{ color: '#94a3b8' }}>
                  ›
                </span>
              </button>
            ))}
          </div>
          {!dayInvitations.length && (
            <div
              style={{
                padding: '16px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                margin: '12px 14px',
              }}
            >
              <h4
                style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#0f172a', fontWeight: 600 }}
              >
                📅 这天尚无固定日程
              </h4>
              <p
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '12px',
                  color: '#64748b',
                  lineHeight: 1.5,
                }}
              >
                和身边的人聊聊，约定下一次见面。
              </p>
              {data.contacts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.contacts.slice(0, 3).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#1e293b',
                        cursor: 'pointer',
                        textAlign: 'left',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                      }}
                      onClick={() => open('messages', contact.id)}
                    >
                      <span style={{ fontSize: '13px', color: '#1e293b' }}>
                        💬 与 <strong style={{ color: '#0f172a' }}>{contact.name}</strong>约时间
                      </span>
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#2563eb',
                          fontWeight: 500,
                          flexShrink: 0,
                        }}
                      >
                        发微信 →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showCreateModal && (
        <NewInvitationModal
          defaultDate={activeDate}
          contacts={data.contacts}
          onClose={() => setShowCreateModal(false)}
          referenceTime={data.referenceTime}
          onCreate={(inv) => {
            const actorId = inv.participantIds[0];
            if (!actorId) return;
            setDraft(
              `message:${actorId}`,
              `想约你${timeText(inv.at)}一起${inv.title}，你有空吗？${inv.notes ? ` ${inv.notes}` : ''}`,
            );
            setShowCreateModal(false);
            open('messages', actorId);
          }}
        />
      )}
    </div>
  );
}
function InvitationDetail({
  invitation: n,
  open,
}: {
  invitation: PhoneInvitation;
  open: PhoneAppContext['open'];
}) {
  const { data, actions, drafts, setDraft, operations, run } = usePhoneApps();
  const [edit, setEdit] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false),
    [confirmResult, setConfirmResult] = useState<'attend' | 'miss' | null>(null),
    [invalid, setInvalid] = useState(false);
  const key = `invitation:${n.id}`,
    operation = operations[key];
  const changedAfterAccept =
    operation?.status === 'accepted' && operation.signature?.startsWith(`${n.version}:`);
  const disabled = !actions.changeInvitation || operation?.busy || changedAfterAccept;
  const date = drafts[`date:${n.id}`] ?? worldDateTimeInput(n.at);
  const leadActor = data.contacts.find((c) => n.participantIds.includes(c.id));
  const isDue = Date.parse(data.referenceTime ?? '') >= Date.parse(n.at);
  async function change(
    kind: 'accept' | 'reschedule' | 'cancel' | 'attend' | 'miss',
    submittedDate?: string,
  ) {
    const at = kind === 'reschedule' ? rescheduleAt(submittedDate ?? date, n.at) : undefined;
    if (kind === 'reschedule' && !at) {
      setInvalid(true);
      return;
    }
    if (disabled) return;
    const expectedVersion = n.version;
    const receipt = await run(key, `${expectedVersion}:${kind}:${at ?? ''}`, (commandId) =>
      actions.changeInvitation!({
        id: n.id,
        operation: kind,
        ...(at ? { at } : {}),
        expectedVersion,
        commandId,
      }),
    );
    if (receipt?.status === 'committed') {
      setEdit(false);
      setConfirmCancel(false);
      setConfirmResult(null);
    }
  }
  return (
    <div className={`${s.app} ${s.invitation}`}>
      {/* 顶部 iOS 原生日历返回导航 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
          minHeight: '44px',
          margin: '-12px -12px 12px -12px',
        }}
      >
        <button
          type="button"
          onClick={() => {
            playTapSound();
            open('calendar');
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'none',
            border: 'none',
            color: '#ef4444',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>‹</span>
          <span>日历</span>
        </button>
        <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>日程详情</span>
        <div style={{ width: '40px' }} />
      </div>
      <span className={s.invitationStatus}>{statusLabel[n.status]}</span>
      <h3>{n.title}</h3>
      <p className={s.invitationTime}>{timeText(n.at)}</p>
      <small>时间以这段人生的日程为准</small>
      <section className={s.participants}>
        <h4>一起的人</h4>
        {n.participantIds.map((id) => (
          <button key={id} onClick={() => open('messages', id)}>
            {data.contacts.find((c) => c.id === id)?.name ?? '联系人'} <span aria-hidden>›</span>
          </button>
        ))}
      </section>
      {n.status === 'proposed' && <p className={s.info}>这是一个邀约，还没有替你答应。</p>}
      {n.status === 'confirmed' && isDue && (
        <p className={s.info}>
          约定时间已到或已过去。前往前可以先确认对方是否仍在；不会根据日期替你赴约或判定失约。
        </p>
      )}
      <Links links={n.links} open={open} />
      {(n.status === 'proposed' || n.status === 'confirmed') && (
        <div className={s.invitationActions}>
          {n.status === 'confirmed' && isDue && actions.enterScene && (
            <button
              className={s.primary}
              disabled={operation?.busy}
              onClick={() => void run(`scene-enter:${n.id}`, n.id, () => actions.enterScene!(n.id))}
            >
              进入现场
            </button>
          )}
          {n.status === 'confirmed' && leadActor && (
            <button
              className={`${s.primary} ${s.wideAction}`}
              onClick={() => open('messages', leadActor.id)}
            >
              和{leadActor.name}聊聊这次约定
            </button>
          )}
          {n.status === 'proposed' && (
            <button className={s.primary} disabled={disabled} onClick={() => void change('accept')}>
              {operation?.errorCode === 'UNKNOWN' && operation.signature?.includes(':accept:')
                ? '确认重试接受'
                : '接受邀约'}
            </button>
          )}
          {n.status === 'confirmed' && isDue && (
            <div className={s.resultActions}>
              <button
                className={s.primary}
                disabled={disabled}
                onClick={() => setConfirmResult('attend')}
              >
                记录已赴约
              </button>
              <button disabled={disabled} onClick={() => setConfirmResult('miss')}>
                记录未赴约
              </button>
            </div>
          )}
          <button
            disabled={disabled}
            onClick={() => {
              setEdit((v) => !v);
              setConfirmCancel(false);
            }}
          >
            调整时间
          </button>
          <button
            className={s.danger}
            disabled={disabled}
            onClick={() => {
              setConfirmCancel(true);
              setEdit(false);
            }}
          >
            取消日程
          </button>
        </div>
      )}
      {confirmResult && (
        <div className={s.confirm} role="group" aria-label="确认赴约记录">
          <p>
            把“{n.title}”记录为{confirmResult === 'attend' ? '已赴约' : '未赴约'}？
          </p>
          <button
            className={s.primary}
            disabled={disabled}
            onClick={() => void change(confirmResult)}
          >
            确认记录
          </button>
          <button onClick={() => setConfirmResult(null)}>再想想</button>
        </div>
      )}
      {edit && (
        <form
          className={s.inline}
          onSubmit={(e) => {
            e.preventDefault();
            void change('reschedule', String(new FormData(e.currentTarget).get('at') ?? ''));
          }}
        >
          <label>
            新的时间
            <input
              type="datetime-local"
              name="at"
              aria-label="新的日程时间"
              value={date}
              onChange={(e) => {
                setDraft(`date:${n.id}`, e.target.value);
                setInvalid(false);
              }}
              required
            />
          </label>
          {invalid && <p role="alert">请选择有效的日期和时间。</p>}
          <button className={s.primary} disabled={disabled}>
            {operation?.errorCode === 'UNKNOWN' && operation.signature?.includes(':reschedule:')
              ? '确认重试改期'
              : '提交改期'}
          </button>
        </form>
      )}
      {confirmCancel && (
        <div className={s.confirm} role="group" aria-label="确认取消日程">
          <p>确定取消“{n.title}”吗？</p>
          <button className={s.danger} disabled={disabled} onClick={() => void change('cancel')}>
            {operation?.errorCode === 'UNKNOWN' && operation.signature?.includes(':cancel:')
              ? '确认重试取消'
              : '确认取消'}
          </button>
          <button onClick={() => setConfirmCancel(false)}>保留日程</button>
        </div>
      )}
      <Feedback operation={operation} success="日程已更新" />
      {!actions.changeInvitation && (n.status === 'proposed' || n.status === 'confirmed') && (
        <p className={s.info}>日程操作尚未接入，当前可以查看邀约。</p>
      )}
    </div>
  );
}

function NewInvitationModal({
  defaultDate,
  referenceTime,
  contacts,
  onClose,
  onCreate,
}: {
  defaultDate: string;
  referenceTime?: string;
  contacts: readonly import('./types.ts').PhoneContact[];
  onClose: () => void;
  onCreate: (input: {
    title: string;
    at: string;
    participantIds: string[];
    notes?: string;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('18:00');
  const [actorId, setActorId] = useState(contacts[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  return (
    <div
      className={s.inviteOverlay}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        className={s.inviteSheet}
        role="dialog"
        aria-modal="true"
        aria-label="发起邀约"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const at = rescheduleAt(`${date}T${time}`, referenceTime ?? 'Z');
          if (!at || !actorId || !title.trim()) {
            setError('请填写约定内容、对象和有效时间。');
            return;
          }
          onCreate({
            title: title.trim(),
            at,
            participantIds: [actorId],
            notes: notes.trim() || undefined,
          });
        }}
      >
        <header>
          <h3>发起邀约</h3>
          <button type="button" onClick={onClose} aria-label="关闭邀约">
            取消
          </button>
        </header>
        <p>先发给对方聊聊，日程以实际确认的结果为准。</p>
        <label>
          约定内容
          <input
            autoFocus
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="一起吃饭、讨论作品…"
          />
        </label>
        <label>
          邀请谁
          <select value={actorId} onChange={(e) => setActorId(e.target.value)}>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className={s.inviteDate}>
          <label>
            日期
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            时间
            <input required type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label>
          补充一句
          <input
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="选填"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className={s.primary} type="submit">
          去聊天发送邀约
        </button>
      </form>
    </div>
  );
}
