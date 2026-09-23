import { useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneInvitation } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Empty, Feedback, Links } from './common.tsx';
import { dayKey, monthDays, shiftMonth, rescheduleAt, timeText } from './helpers.ts';
import { playTapSound } from '../audio-feedback.ts';
import s from './apps.module.css';
const statusLabel = { proposed: '待确认邀约', confirmed: '已确认', cancelled: '已取消' };
export function CalendarApp({ target, open }: PhoneAppContext) {
  const { data, actions, drafts, setDraft } = usePhoneApps();
  const [tab, setTab] = useState<'today' | 'calendar' | 'invitations'>('calendar');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // 今天基准日期（如果 data.referenceTime 存在使用它，否则使用第一条约定或当前系统时间）
  const todayKey = dayKey(data.referenceTime ?? data.invitations[0]?.at ?? new Date().toISOString());
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
    .sort((a, b) => a.at.localeCompare(b.at));
  const pendingInvitations = data.invitations
    .filter((i) => i.status === 'proposed')
    .sort((a, b) => a.at.localeCompare(b.at));

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
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#ef4444' }}>
          {month.replace('-', '年')}月
        </span>
        <div className={s.segment} role="group" aria-label="日历视图" style={{ margin: 0 }}>
          <button
            aria-pressed={tab === 'today'}
            onClick={() => {
              playTapSound();
              setTab('today');
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

        {actions.createInvitation && (
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
                <time>{n.at.slice(5, 10)} {n.at.slice(11, 16)}</time>
                <span>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>{n.title}</strong>
                  <small className={s.proposed}>待回复 · 点击接受或改期</small>
                </span>
                <span aria-hidden>›</span>
              </button>
            ))}
            {!pendingInvitations.length && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b', fontSize: '13px' }}>
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
                <time style={{ fontWeight: 600, color: '#0284c7' }}>{n.at.slice(11, 16)}</time>
                <span>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>{n.title}</strong>
                  <small className={n.status === 'proposed' ? s.proposed : undefined}>
                    {statusLabel[n.status]}
                  </small>
                </span>
                <span aria-hidden style={{ color: '#94a3b8' }}>›</span>
              </button>
            ))}
          </div>
          {!dayInvitations.length && (
            <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', margin: '12px 14px' }}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>📅 这天尚无固定日程</h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                你可以点击右上角「+ 发起邀约」添加计划，或发微信和身边的人约定碰面：
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
        </>
      )}

      {showCreateModal && (
        <NewInvitationModal
          defaultDate={activeDate}
          contacts={data.contacts}
          onClose={() => setShowCreateModal(false)}
          onCreate={async (inv) => {
            if (actions.createInvitation) {
              await actions.createInvitation(inv);
              setShowCreateModal(false);
              setDraft('calendar:day', dayKey(inv.at));
              setTab('calendar');
            }
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

function NewInvitationModal({
  defaultDate,
  contacts,
  onClose,
  onCreate,
}: {
  defaultDate: string;
  contacts: readonly import('./types.ts').PhoneContact[];
  onClose: () => void;
  onCreate: (invitation: {
    title: string;
    at: string;
    participantIds: string[];
    notes?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('20:30');
  const [actorId, setActorId] = useState(contacts[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedActor = contacts.find((c) => c.id === actorId) ?? contacts[0];

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          padding: '20px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          maxHeight: '85%',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#0f172a' }}>
            📅 发起新日程约定
          </h3>
          <button
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ✕
          </button>
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
            日程名称
          </label>
          <input
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
            placeholder={selectedActor ? `和${selectedActor.name}的露台晚餐` : '项目讨论会'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {contacts.length > 0 && (
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
              约定对象（会同步微信邀约）
            </label>
            <select
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                boxSizing: 'border-box',
                background: '#ffffff',
              }}
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.relationship})
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
              日期
            </label>
            <input
              type="date"
              style={{
                width: '100%',
                padding: '9px 10px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
              时间
            </label>
            <input
              type="time"
              style={{
                width: '100%',
                padding: '9px 10px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
            备注前瞻（选填）
          </label>
          <input
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
            placeholder="她说：这次不准聊工作。"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={busy}
          style={{
            marginTop: '6px',
            padding: '12px',
            borderRadius: '12px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            fontSize: '15px',
            cursor: 'pointer',
          }}
          onClick={async () => {
            const resolvedTitle =
              title.trim() ||
              (selectedActor ? `和${selectedActor.name}的约定` : '新日程');
            setBusy(true);
            try {
              await onCreate({
                title: resolvedTitle,
                at: `${date}T${time}:00Z`,
                participantIds: actorId ? [actorId] : [],
                notes: notes.trim() || undefined,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在发起…' : '确认发起邀约'}
        </button>
      </div>
    </div>
  );
}
