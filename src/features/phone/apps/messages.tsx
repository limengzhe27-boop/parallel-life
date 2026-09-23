import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import type { PhoneContact } from './types.ts';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty, Feedback, Links, Search } from './common.tsx';
import { formatChatTime, searchable, timeText } from './helpers.ts';
import s from './apps.module.css';
export function MessagesApp({ target, open }: PhoneAppContext) {
  const { data, actions, drafts, setDraft, operations, run } = usePhoneApps();
  const [tab, setTab] = useState<'chats' | 'contacts'>('chats');
  const [query, setQuery] = useState('');
  const [showPerson, setShowPerson] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [callingContact, setCallingContact] = useState<PhoneContact | null>(null);
  const messageScroll = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const lastScroll = useRef(0);
  const readAttempt = useRef<string | undefined>(undefined);
  const actor = data.contacts.find((c) => c.id === target);
  const messages = data.messages
    .filter((m) => m.actorId === target)
    .sort((a, b) => a.at.localeCompare(b.at));
  const key = `message:${target}`,
    text = drafts[key] ?? '',
    operation = operations[key];
  useLayoutEffect(() => {
    const el = messageScroll.current;
    if (el) {
      el.scrollTop =
        drafts[`scroll:${target}`] === undefined
          ? el.scrollHeight
          : Number(drafts[`scroll:${target}`]);
      lastScroll.current = el.scrollTop;
      wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
  }, [target]);
  useLayoutEffect(() => {
    const el = messageScroll.current;
    if (el && wasNearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    const el = messageScroll.current;
    if (!el || !actor) return;
    let previousHeight = el.clientHeight;
    const readSignature = `${actor.id}:${actor.unread}:${messages.at(-1)?.id ?? ''}`;
    const observe = () => {
      if (el.clientHeight === 0) {
        previousHeight = 0;
        return;
      }
      if (previousHeight === 0) el.scrollTop = lastScroll.current;
      previousHeight = el.clientHeight;
      if (
        document.visibilityState === 'visible' &&
        actor.unread > 0 &&
        actions.markRead &&
        readAttempt.current !== readSignature
      ) {
        readAttempt.current = readSignature;
        void run(`read:${actor.id}`, readSignature, async () => {
          await actions.markRead!(actor.id);
          return { status: 'committed' };
        });
      }
    };
    const resize = new ResizeObserver(observe);
    resize.observe(el);
    document.addEventListener('visibilitychange', observe);
    observe();
    return () => {
      resize.disconnect();
      document.removeEventListener('visibilitychange', observe);
    };
  }, [actor?.id, actor?.unread, actions.markRead, messages.at(-1)?.id]);
  if (target && !actor) return <Empty title="找不到这个联系人" text="请返回通讯录或刷新后再试。" />;
  if (!actor) {
    const contacts = data.contacts.filter((c) => searchable(query, c.name, c.relationship));
    const sortedChats = [...contacts].sort((a, b) => {
      const latestA = data.messages
        .filter((m) => m.actorId === a.id)
        .sort((x, y) => x.at.localeCompare(y.at))
        .at(-1);
      const latestB = data.messages
        .filter((m) => m.actorId === b.id)
        .sort((x, y) => x.at.localeCompare(y.at))
        .at(-1);
      const timeA = latestA?.at ?? '';
      const timeB = latestB?.at ?? '';
      return timeB.localeCompare(timeA);
    });
    const selectedProfile = data.contacts.find((c) => c.id === selectedProfileId);

    return (
      <div className={s.app}>
        <div className={s.segment} role="group" aria-label="微信页面">
          <button aria-pressed={tab === 'chats'} onClick={() => setTab('chats')}>
            聊天
          </button>
          <button aria-pressed={tab === 'contacts'} onClick={() => setTab('contacts')}>
            通讯录
          </button>
        </div>
        <Search label={tab === 'chats' ? '搜索聊天' : '搜索联系人'} value={query} onChange={setQuery} />
        {tab === 'chats' ? (
          <div className={s.list}>
            {sortedChats.map((c) => {
              const latest = data.messages
                .filter((m) => m.actorId === c.id)
                .sort((a, b) => a.at.localeCompare(b.at))
                .at(-1);
              return (
                <button key={c.id} className={s.contact} onClick={() => open('messages', c.id)}>
                  <Avatar url={c.avatarUrl} name={c.name} />
                  <span className={s.contactText}>
                    <strong>{c.name}</strong>
                    <small>{latest?.text ?? '开始聊聊'}</small>
                  </span>
                  <span className={s.contactMeta}>
                    {latest && <time>{formatChatTime(latest.at)}</time>}
                    {c.unread > 0 && (
                      <b aria-label={`${c.unread} 条未读`}>{c.unread > 99 ? '99+' : c.unread}</b>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={s.list}>
            {contacts.map((c) => (
              <button
                key={c.id}
                className={s.contact}
                onClick={() => setSelectedProfileId(c.id)}
                style={{ display: 'flex', alignItems: 'center' }}
              >
                <Avatar url={c.avatarUrl} name={c.name} />
                <span className={s.contactText}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {c.name}
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 'normal',
                        padding: '1px 6px',
                        borderRadius: '6px',
                        background: '#e2e8f0',
                        color: '#475569',
                      }}
                    >
                      {c.relationship}
                    </span>
                  </strong>
                  <small style={{ color: '#64748b' }}>
                    {c.summary ? (c.summary.length > 26 ? c.summary.slice(0, 26) + '…' : c.summary) : '查看人物名片与生平'}
                  </small>
                </span>
                <span style={{ fontSize: '13px', color: '#94a3b8', paddingRight: '4px' }}>名片 ›</span>
              </button>
            ))}
          </div>
        )}
        {!contacts.length && (
          <Empty
            title={query ? '没有找到联系人' : (tab === 'chats' ? '还没有聊天' : '通讯录还是空的')}
            text="世界中的人物会出现在这里。"
          />
        )}

        {selectedProfile && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              zIndex: 100,
            }}
            onClick={() => setSelectedProfileId(null)}
          >
            <div
              style={{
                background: '#ffffff',
                borderTopLeftRadius: '20px',
                borderTopRightRadius: '20px',
                padding: '24px 20px',
                boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                maxHeight: '82%',
                overflowY: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  <Avatar url={selectedProfile.avatarUrl} name={selectedProfile.name} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#0f172a' }}>
                      {selectedProfile.name}
                    </h3>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          background: '#f1f5f9',
                          color: '#334155',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          fontWeight: 500,
                        }}
                      >
                        {selectedProfile.relationship}
                      </span>
                      <span style={{ fontSize: '11px', color: '#16a34a' }}>● 在线</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedProfileId(null)}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '28px',
                    height: '28px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#64748b',
                  }}
                  aria-label="关闭名片"
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>
                  人物生平与性格
                </div>
                <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6 }}>
                  {selectedProfile.summary || `在当前人生中与你相识，是你的${selectedProfile.relationship}。`}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '11px',
                    borderRadius: '12px',
                    background: '#07c160',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const id = selectedProfile.id;
                    setSelectedProfileId(null);
                    open('messages', id);
                  }}
                >
                  💬 发送微信
                </button>
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '11px',
                    borderRadius: '12px',
                    background: '#f1f5f9',
                    color: '#1e293b',
                    border: '1px solid #cbd5e1',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setCallingContact(selectedProfile);
                  }}
                >
                  📞 拨打电话
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '9px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedProfileId(null);
                    open('calendar');
                  }}
                >
                  🗓️ 查看日程
                </button>
                <button
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '9px',
                    borderRadius: '10px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedProfileId(null);
                    open('photos');
                  }}
                >
                  🖼️ 共同回忆
                </button>
              </div>

              {callNotice && (
                <div
                  style={{
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    textAlign: 'center',
                  }}
                >
                  {callNotice}
                </div>
              )}
            </div>
          </div>
        )}
        {callingContact && (
          <CallModal
            contact={callingContact}
            onClose={() => setCallingContact(null)}
            onOpenChat={(id) => {
              setCallingContact(null);
              setSelectedProfileId(null);
              open('messages', id);
            }}
          />
        )}
      </div>
    );
  }
  const disabled =
    operation?.busy || (operation?.status === 'accepted' && operation.signature === text);
  const relatedInvitation =
    data.invitations.find((inv) => inv.participantIds.includes(actor.id)) ??
    (data.invitations.length > 0 ? data.invitations[0] : null);
  return (
    <div className={`${s.app} ${s.chat}`} data-phone-thread>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#f2f2f7',
          borderBottom: '1px solid #e5e5ea',
          paddingRight: '12px',
        }}
      >
        <button
          className={s.personHeader}
          style={{ flex: 1, borderBottom: 'none' }}
          aria-expanded={showPerson}
          onClick={() => setShowPerson((v) => !v)}
        >
          <Avatar url={actor.avatarUrl} name={actor.name} />
          <span>
            <strong>{actor.name}</strong>
            <small>
              {actor.relationship} · <span style={{ color: '#52c41a' }}>● 在线</span>
            </small>
          </span>
        </button>
        <button
          type="button"
          title={`拨打电话给 ${actor.name}`}
          style={{
            background: '#e2fbe8',
            border: '1px solid #bbf7d0',
            borderRadius: '50%',
            width: '34px',
            height: '34px',
            fontSize: '15px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#15803d',
            marginRight: '6px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setCallingContact(actor);
          }}
        >
          📞
        </button>
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            color: '#707078',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '4px',
          }}
          onClick={() => setShowPerson((v) => !v)}
        >
          ···
        </button>
      </div>
      {showPerson && (
        <section className={s.personSummary} aria-label="人物摘要">
          <h3>{actor.name}</h3>
          <p>{actor.summary ?? actor.relationship}</p>
        </section>
      )}
      {operations[`read:${actor.id}`]?.error && (
        <div className={s.inline}>
          <Feedback operation={operations[`read:${actor.id}`]} />
          <button
            onClick={() =>
              void run(`read:${actor.id}`, actor.id, async () => {
                await actions.markRead!(actor.id);
                return { status: 'committed' };
              })
            }
          >
            重试标记已读
          </button>
        </div>
      )}
      <div
        ref={messageScroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!el.clientHeight) return;
          lastScroll.current = el.scrollTop;
          wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          setDraft(`scroll:${target}`, String(el.scrollTop));
        }}
        className={s.messages}
        role="log"
        aria-label={`与${actor.name}的聊天`}
        aria-live="polite"
        aria-relevant="additions"
      >
        {relatedInvitation && (
          <div
            style={{
              margin: '4px 0 12px 0',
              padding: '12px 14px',
              background: '#f8fafc',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onClick={() => open('calendar', relatedInvitation.id)}
            role="button"
            tabIndex={0}
            aria-label="查看相关日程"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>🗓️</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                  {relatedInvitation.title}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                  {relatedInvitation.at.slice(0, 10)} {relatedInvitation.at.slice(11, 16)} ·{' '}
                  <span
                    style={{
                      color:
                        relatedInvitation.status === 'confirmed'
                          ? '#16a34a'
                          : relatedInvitation.status === 'cancelled'
                            ? '#94a3b8'
                            : '#d97706',
                      fontWeight: 500,
                    }}
                  >
                    {relatedInvitation.status === 'confirmed'
                      ? '已约好'
                      : relatedInvitation.status === 'cancelled'
                        ? '已取消'
                        : '邀请 · 待确认'}
                  </span>
                </div>
              </div>
            </div>
            <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 500 }}>
              查看约定 ›
            </span>
          </div>
        )}
        {!messages.length && <Empty title="还没有聊天记录" text={`和${actor.name}说句话吧。`} />}
        {messages.map((m) => (
          <article key={m.id} className={`${s.message} ${m.role === 'user' ? s.mine : ''}`}>
            <time>{timeText(m.at)}</time>
            <div className={s.bubble}>
              <p>{m.text}</p>
              <Links links={m.links} open={open} />
            </div>
            {m.status === 'pending' && <small>等待处理</small>}
            {(m.status === 'failed' || m.status === 'unknown') && (
              <div className={s.messageFailure}>
                <span>{m.status === 'unknown' ? '结果待确认，请先刷新核对' : '发送失败'}</span>
                <button
                  disabled={
                    !actions.retryMessage ||
                    operations[`retry:${m.id}`]?.busy ||
                    operations[`retry:${m.id}`]?.status === 'accepted'
                  }
                  onClick={() =>
                    void run(`retry:${m.id}`, m.id, (id) => actions.retryMessage!(m.id, id))
                  }
                >
                  {m.status === 'unknown' ? '确认重试' : '重试'}
                </button>
                <Feedback operation={operations[`retry:${m.id}`]} success="重试已完成" />
              </div>
            )}
          </article>
        ))}
      </div>
      <form
        className={s.composer}
        onSubmit={async (e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value || !actions.sendMessage || disabled) return;
          setDraft(key, '');
          await run(key, text, (id) => actions.sendMessage!(actor.id, value, id));
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            padding: '2px 0 8px 0',
            scrollbarWidth: 'none',
          }}
          aria-label="快速发起互动"
        >
          {['在忙吗？', '关于接下来的安排…', '有空碰个面吗？', '刚看到便签里的事…'].map((topic) => (
            <button
              key={topic}
              type="button"
              style={{
                flexShrink: 0,
                fontSize: '12px',
                padding: '4px 10px',
                borderRadius: '14px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#334155',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
              }}
              onClick={() => setDraft(key, topic)}
            >
              💬 {topic}
            </button>
          ))}
        </div>
        <label className={s.srOnly} htmlFor={`compose-${actor.id}`}>
          消息内容
        </label>
        <div className={s.composerRow}>
          <textarea
            id={`compose-${actor.id}`}
            rows={2}
            maxLength={4000}
            value={text}
            disabled={!!operation?.busy}
            onChange={(e) => setDraft(key, e.target.value)}
            placeholder={actions.sendMessage ? '发消息…' : '聊天尚未接通，可先写草稿'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            className={s.green}
            type="submit"
            disabled={!actions.sendMessage || !text.trim() || disabled}
          >
            {operation?.errorCode === 'UNKNOWN' && operation.signature === text
              ? '确认重试'
              : '发送'}
          </button>
        </div>
        <Feedback operation={operation} success="消息已提交" />
        {!actions.sendMessage && <small>持续对话尚未接入，草稿仅在当前页面保留。</small>}
        <small className={s.hint}>按 Enter 发送 · Shift + Enter 换行</small>
      </form>
      {callingContact && (
        <CallModal
          contact={callingContact}
          onClose={() => setCallingContact(null)}
          onOpenChat={(id) => {
            setCallingContact(null);
            setSelectedProfileId(null);
            open('messages', id);
          }}
        />
      )}
    </div>
  );
}

function CallModal({
  contact,
  onClose,
  onOpenChat,
}: {
  contact: PhoneContact;
  onClose: () => void;
  onOpenChat: (actorId: string) => void;
}) {
  const [status, setStatus] = useState<'dialing' | 'connected' | 'ended'>('dialing');
  const [seconds, setSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);

  useEffect(() => {
    const dialTimer = setTimeout(() => {
      setStatus('connected');
    }, 2200);
    return () => clearTimeout(dialTimer);
  }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const voiceLine = useMemo(() => {
    const rel = contact.relationship || '';
    if (
      rel.includes('合伙') ||
      rel.includes('创') ||
      rel.includes('同事') ||
      rel.includes('工作') ||
      rel.includes('项目')
    ) {
      return `“喂，孟哲！刚看你打来。这会儿手头正在推进项目节点，稍后我把重点发你微信，咱们文字对一下更细致，有事随时找我！”`;
    }
    if (
      rel.includes('师') ||
      rel.includes('长') ||
      rel.includes('领导') ||
      rel.includes('前辈') ||
      rel.includes('顾问')
    ) {
      return `“喂，孟哲啊，我正准备参加一个研讨，你先在微信把想法留言给我，我一散会马上看。”`;
    }
    if (rel.includes('友') || rel.includes('学') || rel.includes('闺蜜') || rel.includes('哥们')) {
      return `“喂～怎么啦！我正赶路呢，刚想着给你发消息你就打过来了！晚点微信聊，随时找我哈！”`;
    }
    return `“喂，孟哲？我刚看到你打过来，手头正忙着一小会儿，晚点微信上细聊，记得看我消息哦！”`;
  }, [contact]);

  const handleEndCall = () => {
    setStatus('ended');
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const formatCallDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(180deg, #090d16 0%, #0f172a 60%, #1e1b4b 100%)',
        color: '#ffffff',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '60px 24px 44px 24px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: '#94a3b8',
            letterSpacing: '0.05em',
          }}
        >
          <span>🔒</span> 端到端加密通话
        </div>
        <div style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
          {contact.name}
        </div>
        <div
          style={{
            fontSize: '13px',
            color: '#cbd5e1',
            background: 'rgba(255,255,255,0.08)',
            padding: '2px 10px',
            borderRadius: '12px',
          }}
        >
          {contact.relationship}
        </div>
        <div
          style={{
            fontSize: '15px',
            color: status === 'connected' ? '#4ade80' : '#94a3b8',
            fontWeight: 500,
            marginTop: '4px',
          }}
        >
          {status === 'dialing' && '正在呼叫…'}
          {status === 'connected' && formatCallDuration(seconds)}
          {status === 'ended' && `通话已结束（时长 ${formatCallDuration(seconds)}）`}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          maxWidth: '320px',
          width: '100%',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '96px',
            height: '96px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.1)',
            boxShadow:
              status === 'dialing'
                ? '0 0 0 10px rgba(59, 130, 246, 0.2), 0 0 0 20px rgba(59, 130, 246, 0.1)'
                : '0 10px 25px rgba(0,0,0,0.5)',
            transition: 'box-shadow 0.4s ease',
          }}
        >
          <div
            style={{
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#334155',
            }}
          >
            <Avatar url={contact.avatarUrl} name={contact.name} />
          </div>
        </div>

        {status === 'connected' && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '16px',
              padding: '14px 16px',
              color: '#f1f5f9',
              fontSize: '13px',
              lineHeight: 1.6,
              textAlign: 'center',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: '#93c5fd',
                marginBottom: '4px',
                fontWeight: 600,
              }}
            >
              🎙️ 对方实时语音中
            </div>
            {voiceLine}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '28px',
          width: '100%',
          maxWidth: '300px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%' }}>
          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.1)',
              border: isMuted ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => setIsMuted((m) => !m)}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>

          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: isSpeaker ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.1)',
              border: isSpeaker ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => setIsSpeaker((s) => !s)}
          >
            {isSpeaker ? '🔊' : '🔈'}
          </button>

          <button
            type="button"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%',
              width: '56px',
              height: '56px',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              fontSize: '18px',
            }}
            onClick={() => onOpenChat(contact.id)}
          >
            💬
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#ef4444',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '26px',
              cursor: 'pointer',
              transform: 'rotate(135deg)',
              boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
            }}
            onClick={handleEndCall}
            aria-label="挂断电话"
          >
            📞
          </button>
        </div>
      </div>
    </div>
  );
}
