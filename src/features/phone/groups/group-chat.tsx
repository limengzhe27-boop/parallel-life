import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PhoneContact } from '../apps/types.ts';
import type { GroupTask } from './client.ts';
import type { GroupsController } from './use-groups.ts';
import {
  activeMembers,
  isJoined,
  localGroupKey,
  mayExecute,
  mayRetry,
  publicMemberName,
  restorePending,
  taskText,
  type Pending,
} from './state.ts';
import { dayKey, timeText } from '../apps/helpers.ts';
import { GroupMembers } from './group-members.tsx';
import { playSendSound } from '../audio-feedback.ts';
import s from './groups.module.css';
import { retryLatestGroupTask } from '../chat-send-state.ts';
function readLocal(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveLocal(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Browsing still works when local storage is disabled. */
  }
}
export function GroupChat({
  id,
  groups,
  contacts,
  back,
}: {
  id: string;
  groups: GroupsController;
  contacts: readonly PhoneContact[];
  back: () => void;
}) {
  const detail = groups.details[id];
  const [text, setText] = useState(''),
    [pending, setPendingState] = useState<Pending>(),
    [task, setTask] = useState<GroupTask>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [members, setMembers] = useState(false),
    [retryConfirm, setRetryConfirm] = useState(false),
    [loading, setLoading] = useState(!detail);
  const pendingRef = useRef<Pending | undefined>(undefined),
    busyRef = useRef(false),
    mounted = useRef(true),
    scroll = useRef<HTMLDivElement>(null),
    restoredElement = useRef<HTMLDivElement | null>(null),
    nearBottom = useRef(true),
    lastRead = useRef(0);
  useEffect(() => {
    if (task) groups.watchTask(task);
  }, [task, groups.watchTask]);
  const pendingKey = localGroupKey(groups.worldId, id, 'pending'),
    draftKey = localGroupKey(groups.worldId, id, 'draft'),
    scrollKey = localGroupKey(groups.worldId, id, 'scroll');
  function pendingChange(p?: Pending) {
    pendingRef.current = p;
    setPendingState(p);
    saveLocal(pendingKey, p ? JSON.stringify(p) : null);
  }
  const update = useCallback(async () => {
    const d = await groups.read(id);
    if (mounted.current) setLoading(false);
    return d;
  }, [groups.read, id]);
  useEffect(() => {
    mounted.current = true;
    setText(readLocal(draftKey) ?? '');
    const p = restorePending(readLocal(pendingKey), groups.worldId, id);
    pendingRef.current = p;
    setPendingState(p);
    void update().catch((e) => {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : '群消息没能打开，请再试一次。');
        setLoading(false);
      }
    });
    if (p?.taskId)
      void groups.client
        .task(p.taskId)
        .then((t) => {
          if (mounted.current) setTask(t);
        })
        .catch(() => {
          if (mounted.current) setError('上一条的发送状态还不能确认，请刷新核对。');
        });
    return () => {
      mounted.current = false;
    };
  }, [groups.client, groups.worldId, id, update, draftKey, pendingKey]);
  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void groups.client
        .task(task.id)
        .then((t) => {
          if (mounted.current) {
            setTask(t);
            if (t.status === 'succeeded') pendingChange(undefined);
            if (!['queued', 'running'].includes(t.status))
              void update()
                .then(() => groups.syncWorld())
                .catch(() => setError('回复状态已更新，但消息没能同步，请刷新查看。'));
          }
        })
        .catch(() => {
          if (mounted.current) setError('暂时没能查看回复状态，已发送的消息不会重发。');
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [task?.id, task?.status, groups.client, update, groups.syncWorld]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !detail || members) return;
    const restore = () => {
      // The shell keeps apps mounted behind the lock screen; wait for a visible viewport.
      if (el.clientHeight === 0) return;
      if (restoredElement.current !== el) {
        const raw = readLocal(scrollKey),
          saved = Number(raw);
        el.scrollTop = raw !== null && Number.isFinite(saved) ? saved : el.scrollHeight;
        restoredElement.current = el;
        nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      } else if (nearBottom.current) el.scrollTop = el.scrollHeight;
    };
    restore();
    const observer = new ResizeObserver(restore);
    observer.observe(el);
    return () => observer.disconnect();
  }, [detail?.messages.length, scrollKey, members]);
  useEffect(() => {
    const el = scroll.current;
    if (!detail?.unread || !el || members) return;
    const version = detail.messages.at(-1)?.sourceVersion;
    if (!version) return;
    const mark = () => {
      if (
        el.clientHeight === 0 ||
        document.visibilityState !== 'visible' ||
        version <= lastRead.current
      )
        return;
      lastRead.current = version;
      void groups.client
        .markRead(groups.worldId, id, version)
        .then(() => groups.read(id))
        .catch(() => {
          lastRead.current = 0;
        });
    };
    mark();
    const observer = new ResizeObserver(mark);
    observer.observe(el);
    document.addEventListener('visibilitychange', mark);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', mark);
    };
  }, [
    detail?.unread,
    detail?.messages.length,
    groups.client,
    groups.read,
    groups.worldId,
    id,
    members,
  ]);
  async function execute(t: GroupTask) {
    if (!mayExecute(t)) return;
    const result = await groups.client.execute(groups.worldId, id, t.id);
    if (mounted.current) setTask(result);
    await update();
    void groups.syncWorld();
    if (result.status === 'succeeded') pendingChange(undefined);
  }
  async function submit(reconcile = false) {
    if (busyRef.current || (!reconcile && !text.trim())) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      let p = pendingRef.current;
      if (!reconcile) {
        if (p && !task) throw Error('上一条的发送结果还没确认，请先核对。');
        if (task && ['queued', 'running'].includes(task.status))
          throw Error('上一条还在等回复，请稍等。');
        const fresh = await groups.client.read(groups.worldId, id);
        p = {
          worldId: groups.worldId,
          groupId: id,
          commandId: crypto.randomUUID(),
          expectedVersion: fresh.version,
          text: text.trim(),
        };
        setTask(undefined);
        pendingChange(p);
      }
      if (!p) return;
      const receipt = await groups.client.send(groups.worldId, id, p);
      pendingChange({ ...p, taskId: receipt.task.id });
      setTask(receipt.task);
      if (text.trim() === p.text) {
        setText('');
        saveLocal(draftKey, null);
      }
      await update();
      void groups.syncWorld();
      playSendSound();
      if (!reconcile) await execute(receipt.task);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : '发送结果还没确认，请查看最新消息。');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function continueTask() {
    if (busyRef.current || !task) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await execute(await groups.client.task(task.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '暂时没能查看回复，请刷新核对。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    const p = pendingRef.current;
    if (busyRef.current || !task || !p || !mayRetry(task)) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setRetryConfirm(false);
    try {
      const result = await retryLatestGroupTask(
        task.id,
        (id) => groups.client.task(id),
        (id, commandId) => groups.client.retry(id, commandId),
        () => {
          const commandId = p.retryCommandId ?? crypto.randomUUID();
          pendingChange({ ...p, retryCommandId: commandId });
          return commandId;
        },
      );
      setTask(result.task);
      if (!result.retried) {
        if (result.task.status === 'succeeded') pendingChange(undefined);
        await update();
        void groups.syncWorld();
        return;
      }
      pendingChange({ ...p, taskId: result.task.id });
      await execute(result.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : '这次没能重新等到回复，消息还在。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  if (members && detail)
    return (
      <GroupMembers
        detail={detail}
        groups={groups}
        contacts={contacts}
        close={() => setMembers(false)}
        updated={async () => {
          await update();
        }}
      />
    );
  const joined = detail ? isJoined(detail.group) : false;
  const pendingMessageId = pending
    ? detail?.messages.find(
        (m) =>
          m.sender.kind === 'player' &&
          m.sourceVersion === pending.expectedVersion + 1 &&
          m.text === pending.text,
      )?.id
    : undefined;
  const sendFeedback =
    pending && (error || taskText(task) || !pending.taskId) ? (
      <div className={s.messageStatus} aria-live="polite">
        {(error || taskText(task)) && <p role="alert">{error || taskText(task)}</p>}
        {pending && !pending.taskId && (
          <button disabled={busy} onClick={() => void submit(true)}>
            恢复发送结果
          </button>
        )}
        {task && mayExecute(task) && (
          <button disabled={busy} onClick={() => void continueTask()}>
            继续等待回复
          </button>
        )}
        {task && mayRetry(task) && pending && (
          <button disabled={busy} onClick={() => setRetryConfirm(true)}>
            重新尝试回复
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => {
            setError(undefined);
            void update()
              .then(async () => {
                if (task) setTask(await groups.client.task(task.id));
              })
              .catch(() => setError('暂时没能更新，请稍后再试。'));
          }}
        >
          刷新查看
        </button>
      </div>
    ) : null;

  return (
    <div className={s.page} data-phone-fixed-dock>
      <header className={s.header}>
        <button onClick={back}>‹ 微信</button>
        <strong>
          {detail?.group.title ?? '群聊'}
          {detail ? ` (${activeMembers(detail.group).length})` : ''}
        </strong>
        <button aria-label="群聊成员" disabled={!detail} onClick={() => setMembers(true)}>
          •••
        </button>
      </header>
      <div
        ref={scroll}
        aria-label="群消息记录"
        className={s.messages}
        onScroll={() => {
          const el = scroll.current;
          if (el) {
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            saveLocal(scrollKey, String(el.scrollTop));
          }
        }}
      >
        {loading && (
          <p className={s.hint} role="status">
            正在打开群聊…
          </p>
        )}
        {detail?.messages.map((message, i) => {
          const date = detail.messageTimes[message.id]?.storyAt,
            name = publicMemberName(message.sender, contacts),
            own = message.sender.kind === 'player';
          const previous = i ? detail.messageTimes[detail.messages[i - 1]!.id]?.storyAt : undefined;
          const sender = message.sender;
          const actor =
            sender.kind === 'actor' ? contacts.find((c) => c.id === sender.actorId) : undefined;
          return (
            <div key={message.id}>
              {date && (!previous || dayKey(previous) !== dayKey(date)) && (
                <div className={s.day}>{timeText(date).split(' ')[0]}</div>
              )}
              <div className={`${s.message} ${own ? s.own : ''}`}>
                {actor?.avatarUrl ? (
                  <img className={s.personAvatar} src={actor.avatarUrl} alt="" />
                ) : (
                  <span className={s.personAvatar} aria-hidden>
                    {name.slice(0, 1)}
                  </span>
                )}
                <div className={s.messageBody}>
                  <span className={s.sender}>{name}</span>
                  <p className={s.bubble}>{message.text}</p>
                  {date && <time title={timeText(date)}>{timeText(date)}</time>}
                  {message.id === pendingMessageId && sendFeedback}
                </div>
              </div>
            </div>
          );
        })}
        {pending && !pendingMessageId && (
          <div className={s.pendingSend}>
            <p className={s.hint}>待核对的消息</p>
            <p className={s.bubble}>{pending.text}</p>
            {sendFeedback}
          </div>
        )}
        {detail && !detail.messages.length && (
          <p className={s.hint}>还没有消息，和大家打个招呼吧。</p>
        )}
        {detail && !joined && (
          <div className={s.notice}>
            你已退出群聊。这里只保留你在群期间可见的消息。
            <button onClick={() => setMembers(true)}>查看成员与重新加入</button>
          </div>
        )}
      </div>
      {(groups.error || (!pending && error)) && (
        <div className={s.status}>
          <p role="alert">{groups.error || error}</p>
          <button
            disabled={busy}
            onClick={() => {
              setError(undefined);
              void update().catch(() => setError('暂时没能更新，请稍后再试。'));
              void groups.refresh();
            }}
          >
            刷新查看
          </button>
        </div>
      )}
      {retryConfirm && (
        <div className={s.notice} role="alert">
          <p>
            {task?.status === 'unknown'
              ? '上一条回复可能已经处理。重新尝试会再次生成回复，要继续吗？'
              : '重新尝试获取上一条的回复？消息不会再次发送。'}
          </p>
          <button disabled={busy} onClick={() => void retry()}>
            确认重试
          </button>
          <button disabled={busy} onClick={() => setRetryConfirm(false)}>
            取消
          </button>
        </div>
      )}
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="群消息"
          rows={1}
          maxLength={4000}
          value={text}
          disabled={!joined}
          placeholder={joined ? '发消息…' : '已退出群聊'}
          onChange={(e) => {
            setText(e.target.value);
            saveLocal(draftKey, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          className={s.send}
          disabled={
            busy ||
            !joined ||
            !text.trim() ||
            Boolean(pending && !task) ||
            Boolean(task && ['queued', 'running'].includes(task.status))
          }
        >
          {busy ? '发送中…' : '发送'}
        </button>
      </form>
    </div>
  );
}
