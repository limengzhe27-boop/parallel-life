import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { usePhoneApps } from './provider.tsx';
import { Avatar, Empty, Feedback, Links, Search } from './common.tsx';
import { searchable, timeText } from './helpers.ts';
import s from './apps.module.css';
export function MessagesApp({ target, open }: PhoneAppContext) {
  const { data, actions, drafts, setDraft, operations, run } = usePhoneApps();
  const [tab, setTab] = useState<'chats' | 'contacts'>('chats');
  const [query, setQuery] = useState('');
  const [showPerson, setShowPerson] = useState(false);
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
        <Search label="搜索联系人" value={query} onChange={setQuery} />
        <div className={s.list}>
          {contacts.map((c) => {
            const latest = data.messages
              .filter((m) => m.actorId === c.id)
              .sort((a, b) => a.at.localeCompare(b.at))
              .at(-1);
            return (
              <button key={c.id} className={s.contact} onClick={() => open('messages', c.id)}>
                <Avatar url={c.avatarUrl} name={c.name} />
                <span className={s.contactText}>
                  <strong>{c.name}</strong>
                  <small>
                    {tab === 'contacts' ? c.relationship : (latest?.text ?? '开始聊聊')}
                  </small>
                </span>
                <span className={s.contactMeta}>
                  {tab === 'chats' && latest && <time>{latest.at.slice(11, 16)}</time>}
                  {c.unread > 0 && (
                    <b aria-label={`${c.unread} 条未读`}>{c.unread > 99 ? '99+' : c.unread}</b>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {!contacts.length && (
          <Empty
            title={query ? '没有找到联系人' : '通讯录还是空的'}
            text="世界中的人物会出现在这里。"
          />
        )}
      </div>
    );
  }
  const disabled =
    operation?.busy || (operation?.status === 'accepted' && operation.signature === text);
  return (
    <div className={`${s.app} ${s.chat}`} data-phone-thread>
      <button
        className={s.personHeader}
        aria-expanded={showPerson}
        onClick={() => setShowPerson((v) => !v)}
      >
        <Avatar url={actor.avatarUrl} name={actor.name} />
        <span>
          <strong>{actor.name}</strong>
          <small>{actor.relationship}</small>
        </span>
        <span className={s.more}>···</span>
      </button>
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
          await run(key, text, (id) => actions.sendMessage!(actor.id, value, id));
        }}
      >
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
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing)
                e.currentTarget.form?.requestSubmit();
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
        <small className={s.hint}>换行用 Enter · 发送用 ⌘ / Ctrl + Enter</small>
      </form>
    </div>
  );
}
