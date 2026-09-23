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
        <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', margin: '12px 14px' }}>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>📅 这天尚无固定日程</h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
            你可以发微信和身边重要的人发起碰头或制定计划：
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
                    💬 与 <strong style={{ color: '#0f172a' }}>{contact.name}</strong>（{contact.relationship}）约时间
                  </span>
                  <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 500, flexShrink: 0 }}>发微信 →</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
    [invalid, setInvalid] = useState(false),
    [showScene, setShowScene] = useState(false),
    [sceneStep, setSceneStep] = useState(0);
  const [actionVersion, setActionVersion] = useState(n.version);
  const key = `invitation:${n.id}`,
    operation = operations[key];
  const changedAfterAccept =
    operation?.status === 'accepted' && operation.signature?.startsWith(`${n.version}:`);
  const disabled = !actions.changeInvitation || operation?.busy || changedAfterAccept;
  const date = drafts[`date:${n.id}`] ?? n.at.slice(0, 16);
  const leadActor =
    data.contacts.find((c) => n.participantIds.includes(c.id)) ?? data.contacts[0];
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
          {n.status === 'confirmed' && (
            <button
              className={s.primary}
              type="button"
              style={{
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 600,
              }}
              onClick={() => setShowScene(true)}
            >
              ✨ 前往赴约 · 经历这一刻
            </button>
          )}
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

      {showScene && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: '#0f172a',
              color: '#f8fafc',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              padding: '24px 20px',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              maxHeight: '90%',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '12px',
                  letterSpacing: '1px',
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                }}
              >
                赴约 · 经历片段
              </span>
              <button
                type="button"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setShowScene(false);
                  setSceneStep(0);
                }}
                aria-label="退出剧情"
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {[0, 1, 2].map((step) => (
                <div
                  key={step}
                  style={{
                    flex: 1,
                    height: '4px',
                    borderRadius: '2px',
                    background: step <= sceneStep ? '#38bdf8' : 'rgba(255,255,255,0.15)',
                    transition: 'background 0.3s ease',
                  }}
                />
              ))}
            </div>

            <div style={{ margin: '8px 0 4px' }}>
              <div style={{ fontSize: '13px', color: '#38bdf8', fontWeight: 500, marginBottom: '6px' }}>
                {sceneStep === 0
                  ? `${n.at.slice(11, 16)} · 碰面时刻`
                  : sceneStep === 1
                    ? '夜色渐深'
                    : '定格回忆'}
              </div>
              <h3 style={{ margin: '0 0 10px', fontSize: '18px', fontWeight: 600, color: '#ffffff' }}>
                {n.title}
              </h3>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.7, color: '#e2e8f0' }}>
                {sceneStep === 0
                  ? `你到达了约好的地点。远处的灯火明亮，夜风吹拂。${leadActor?.name ?? '对方'}早已在桌边等候，看见你走过来，眼中浮现出笑意：“总算来了，这次可算把手机收起来了。”`
                  : sceneStep === 1
                    ? `你们坐在一起聊起最近的日常。平时紧绷的思绪在这段时光里慢慢放松下来，杯盏交错间，周围喧嚣的声音渐渐隐去，只剩下眼前的对视与浅笑。`
                    : `在离开之前，${leadActor?.name ?? '对方'}拿出手机定格了这一刻的画面：“这张合照归我了，你不许删掉。下一次，换你主动约我。”`}
              </p>
            </div>

            <div style={{ marginTop: '8px' }}>
              {sceneStep < 2 ? (
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '13px',
                    borderRadius: '12px',
                    background: '#38bdf8',
                    color: '#0f172a',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '15px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSceneStep((s) => s + 1)}
                >
                  继续这一刻 →
                </button>
              ) : (
                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '13px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '15px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setShowScene(false);
                    setSceneStep(0);
                    open('photos');
                  }}
                >
                  ✨ 收好这段回忆，存入相册
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
