import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneInvitation } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import { dayKey, monthDays, shiftMonth, rescheduleAt, timeText } from './helpers.ts';
import s from './apps.module.css';
const statusLabel = { proposed: '待确认邀约', confirmed: '已确认', cancelled: '已取消' };
export function CalendarApp({ target, open }: PhoneAppContext) {
  const { data, drafts, setDraft } = usePhoneApps();
  const initial = dayKey(data.invitations[0]?.at ?? new Date().toISOString());
  const selected = drafts['calendar:day'] ?? initial;
  const month = drafts['calendar:month'] ?? selected.slice(0, 7);
  const invitation = data.invitations.find((i) => i.id === target);
  if (target && !invitation)
    return <Empty title="找不到这项日程" text="请返回日历或刷新后再试。" />;
  if (invitation)
    return <InvitationDetail key={invitation.id} invitation={invitation} open={open} />;
  const days = monthDays(month),
    dayInvitations = data.invitations
      .filter((i) => dayKey(i.at) === selected)
      .sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className={`${s.app} ${s.calendar}`}>
      <div className={s.monthHeader}>
        <button
          aria-label="上个月"
          onClick={() => setDraft('calendar:month', shiftMonth(month, -1))}
        >
          ‹
        </button>
        <h3>{month.replace('-', ' 年 ')} 月</h3>
        <button
          aria-label="下个月"
          onClick={() => setDraft('calendar:month', shiftMonth(month, 1))}
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
      <div className={s.sectionHeading}>
        <h3>{selected}</h3>
        <small>日程</small>
      </div>
      <div className={s.agenda}>
        {dayInvitations.map((n) => (
          <button
            key={n.id}
            onClick={() => open('calendar', n.id)}
            className={n.status === 'cancelled' ? s.cancelled : ''}
          >
            <time>{n.at.slice(11, 16)}</time>
            <span>
              <strong>{n.title}</strong>
              <small className={n.status === 'proposed' ? s.proposed : undefined}>
                {statusLabel[n.status]}
              </small>
            </span>
            <span aria-hidden>›</span>
          </button>
        ))}
      </div>
      {!dayInvitations.length && (
        <Empty title="这一天暂时没有安排" text="新的邀约会出现在这里，确认后才算约定。" />
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
    [invalid, setInvalid] = useState(false);
  const [actionVersion, setActionVersion] = useState(n.version);
  const key = `invitation:${n.id}`,
    operation = operations[key];
  const changedAfterAccept =
    operation?.status === 'accepted' && operation.signature?.startsWith(`${n.version}:`);
  const disabled = !actions.changeInvitation || operation?.busy || changedAfterAccept;
  const date = drafts[`date:${n.id}`] ?? n.at.slice(0, 16);
  async function change(kind: 'accept' | 'reschedule' | 'cancel', submittedDate?: string) {
    const at = kind === 'reschedule' ? rescheduleAt(submittedDate ?? date, n.at) : undefined;
    if (kind === 'reschedule' && !at) {
      setInvalid(true);
      return;
    }
    if (disabled) return;
    const expectedVersion = kind === 'accept' ? n.version : actionVersion;
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
    }
  }
  return (
    <div className={`${s.app} ${s.invitation}`}>
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
      <Links links={n.links} open={open} />
      {n.status !== 'cancelled' && (
        <div className={s.invitationActions}>
          {n.status === 'proposed' && (
            <button className={s.primary} disabled={disabled} onClick={() => void change('accept')}>
              {operation?.errorCode === 'UNKNOWN' && operation.signature?.includes(':accept:')
                ? '确认重试接受'
                : '接受邀约'}
            </button>
          )}
          <button
            disabled={disabled}
            onClick={() => {
              setActionVersion(n.version);
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
              setActionVersion(n.version);
              setConfirmCancel(true);
              setEdit(false);
            }}
          >
            取消日程
          </button>
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
      {!actions.changeInvitation && n.status !== 'cancelled' && (
        <p className={s.info}>日程操作尚未接入，当前可以查看邀约。</p>
      )}
    </div>
  );
}
