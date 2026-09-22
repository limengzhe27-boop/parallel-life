'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LifeClient, ApiFailure } from '../api/client.ts';
import type {
  InterviewWorkspace,
  Profile,
  ProfileFact,
  ProfileEdit,
  Task,
} from '../../contracts/api.ts';
import { WorkspaceShell } from '../../components/workspace-shell.tsx';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { Onboarding } from './onboarding.tsx';
import { ProposalThread } from './proposal-thread.tsx';
import { LifeEvents, ImportantPeople } from './life-events.tsx';
const categories: Record<ProfileFact['category'], string> = {
  identity: '基本信息',
  interest: '我的爱好',
  personality: '性格印象',
  relationship: '重要的人',
  experience: '人生经历',
  wish: '心里的愿望',
};
const errorMessage = (error: unknown) =>
  error instanceof ApiFailure ? error.message : '暂时没有完成，内容已保留，请再试一次。';
export function InterviewApp() {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<InterviewWorkspace | null>(null),
    [error, setError] = useState(''),
    [profileError, setProfileError] = useState(''),
    [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false);
  const [entered, setEntered] = useState(false),
    [entryReady, setEntryReady] = useState(false);
  const [editing, setEditing] = useState<{
    fact?: ProfileFact;
    category: ProfileFact['category'];
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null);
  const pending = useRef<{ commandId: string; expectedVersion: number; text: string } | null>(null),
    retry = useRef<{ id: string; commandId: string } | null>(null);
  const apply = useCallback(
    (incoming: InterviewWorkspace) =>
      setData((current) =>
        !current
          ? incoming
          : {
              interview:
                incoming.interview.version >= current.interview.version
                  ? incoming.interview
                  : current.interview,
              profile:
                incoming.profile.version >= current.profile.version
                  ? incoming.profile
                  : current.profile,
            },
      ),
    [],
  );
  const refresh = useCallback(async () => {
    const value = await client.workspace();
    apply(value);
    return value;
  }, [client, apply]);
  useEffect(() => {
    let live = true;
    client
      .workspace()
      .then((value) => {
        if (live) apply(value);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [client, apply]);
  // Drafts live only for this tab session and are scoped to the actual profile.
  useEffect(() => {
    if (!data?.profile.id) return;
    try {
      setDraft(sessionStorage.getItem(`pl-draft:${data.profile.id}`) ?? '');
    } catch {
      /* Storage may be unavailable. */
    }
  }, [data?.profile.id]);
  function updateDraft(value: string) {
    setDraft(value);
    if (data?.profile.id) {
      try {
        sessionStorage.setItem(`pl-draft:${data.profile.id}`, value);
      } catch {
        /* Keep the in-memory draft. */
      }
    }
  }
  useEffect(() => {
    if (!data) return;
    let remembered = false;
    try {
      remembered = sessionStorage.getItem(`pl-entered:${data.profile.id}`) === '1';
    } catch {
      /* optional session memory */
    }
    setEntered(
      location.hash === '#profile' ||
        remembered ||
        data.interview.messages.length > 0 ||
        data.profile.facts.length > 0,
    );
    setEntryReady(true);
  }, [data?.profile.id]);
  function startConversation() {
    setEntered(true);
    if (data) {
      try {
        sessionStorage.setItem(`pl-entered:${data.profile.id}`, '1');
      } catch {
        /* keep current view */
      }
    }
  }
  const task = data?.interview.activeTask,
    waiting = task?.status === 'queued' || task?.status === 'running';
  useEffect(() => {
    if (!task || !waiting) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.task(task.id);
        if (!live) return;
        if (['queued', 'running'].includes(result.status))
          setData((current) =>
            current?.interview.activeTask?.id === result.id
              ? { ...current, interview: { ...current.interview, activeTask: result } }
              : current,
          );
        else {
          await refresh();
          return;
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
      if (live) timer = setTimeout(poll, document.hidden ? 8000 : 2200);
    };
    timer = setTimeout(poll, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, refresh, task?.id, waiting]);
  useEffect(() => {
    if (data?.interview.messages.length)
      end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.interview.messages.length, waiting]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!data || !draft.trim() || sending || waiting) return;
    const text = draft.trim();
    const request =
      pending.current?.text === text
        ? pending.current
        : { commandId: crypto.randomUUID(), expectedVersion: data.interview.version, text };
    pending.current = request;
    setSending(true);
    setError('');
    try {
      const sent = await client.send(request);
      setData((current) => (current ? { ...current, interview: sent.interview } : current));
      setDraft((value) => {
        const next = value.trim() === text ? '' : value;
        try {
          sessionStorage.setItem(`pl-draft:${data.profile.id}`, next);
        } catch {
          /* No persistent draft storage. */
        }
        return next;
      });
      pending.current = null;
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') {
        pending.current = null;
        await refresh().catch(() => {});
      }
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }
  async function edit(operation: ProfileEdit['operation']) {
    if (!data) return;
    setSaving(true);
    setProfileError('');
    try {
      const profile = await client.editProfile({
        expectedVersion: data.profile.version,
        operation,
      });
      setData((current) =>
        current
          ? {
              ...current,
              profile: profile.version >= current.profile.version ? profile : current.profile,
            }
          : current,
      );
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') await refresh().catch(() => {});
      setProfileError(errorMessage(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }
  async function upload(file: File) {
    setUploading(true);
    setProfileError('');
    try {
      if (file.size > 8 * 1024 * 1024) throw new ApiFailure('INVALID_INPUT', '照片请小于 8MB。');
      const asset = await client.upload(file);
      const current = await refresh();
      const profile = await client.editProfile({
        expectedVersion: current.profile.version,
        operation: { kind: 'set-portrait', assetId: asset.id },
      });
      setData((value) => (value ? { ...value, profile } : value));
    } catch (e) {
      setProfileError(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function taskAction(kind: 'cancel' | 'retry') {
    if (!task) return;
    setSaving(true);
    setError('');
    try {
      if (kind === 'cancel') await client.cancelTask(task.id);
      else {
        if (retry.current?.id !== task.id)
          retry.current = { id: task.id, commandId: crypto.randomUUID() };
        await client.retryTask(task.id, retry.current.commandId);
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  const profile = data ? (
    <ProfilePane
      error={profileError}
      events={
        <>
          <LifeEvents events={data.profile.events} onSave={edit} />
          <ImportantPeople people={data.profile.people} client={client} onSave={edit} />
        </>
      }
      profile={data.profile}
      uploading={uploading}
      saving={saving}
      onUpload={() => fileInput.current?.click()}
      onEdit={(category, fact) => setEditing({ category, fact })}
      onConfirm={(id) => void edit({ kind: 'confirm-fact', id }).catch(() => {})}
    />
  ) : (
    <div className="profile-loading">
      <span className="spinner" />
      <span>正在打开你的档案</span>
    </div>
  );
  if (data && entryReady && !entered)
    return <Onboarding profile={data.profile} onStart={startConversation} onSave={edit} />;
  return (
    <>
      <WorkspaceShell
        profile={profile}
        profileCount={data?.profile.facts.filter((f) => f.status === 'suggested').length ?? 0}
        footer={
          <div className="composer-area">
            {error && (
              <Notice>
                <span>{error}</span>
                {!data && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError('');
                      void refresh().catch((e) => setError(errorMessage(e)));
                    }}
                  >
                    重新连接
                  </Button>
                )}
              </Notice>
            )}
            <form className="composer" onSubmit={send}>
              <textarea
                ref={input}
                value={draft}
                maxLength={4000}
                onChange={(e) => updateDraft(e.target.value)}
                aria-label="和人生伙伴说说你"
                placeholder={data?.interview.messages.length ? '接着说，我在听…' : '说说最近的你…'}
                rows={2}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    matchMedia('(pointer:fine)').matches
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <span className="composer-tip">
                  <Icon name="lock" size={12} />
                  只聊你愿意分享的事{draft.length > 3000 && ` · ${draft.length}/4000`}
                </span>
                <Button
                  type="submit"
                  aria-label="发送消息"
                  disabled={!data || !draft.trim() || sending || waiting}
                >
                  {sending ? <span className="spinner" /> : <Icon name="send" size={18} />}
                  <span>发送</span>
                </Button>
              </div>
            </form>
            <p className="saved-hint">只聊你愿意分享的事</p>
          </div>
        }
      >
        {!data ? (
          <div className="opening">
            <span className="spinner" />
            <p>正在打开属于你的空间…</p>
          </div>
        ) : data.interview.messages.length === 0 ? (
          <Welcome
            choose={(text) => {
              updateDraft(text);
              input.current?.focus();
            }}
          />
        ) : (
          <div className="message-list" role="log" aria-label="已保存的对话" aria-live="polite">
            {data.interview.messages.map((message) => (
              <div key={message.id} className={`message message-${message.role} message-enter`}>
                {message.role === 'assistant' && (
                  <div className="message-avatar">
                    <Icon name="spark" size={18} />
                  </div>
                )}
                <div>
                  <div className="message-meta">
                    {message.role === 'assistant' ? '人生伙伴' : '你'}
                    <time>
                      {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <div className="message-text">{message.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {waiting && task && (
          <Waiting task={task} onCancel={() => void taskAction('cancel')} disabled={saving} />
        )}
        {task && ['failed', 'unknown', 'cancelled', 'conflict'].includes(task.status) && (
          <div className="task-recovery">
            <Icon name="chat" />
            <p>
              {task.status === 'unknown'
                ? '这次回应暂时没有完整返回。你说的话已经保存，可以重新尝试。'
                : task.status === 'cancelled'
                  ? '已暂停这次回应。你可以继续说，也可以重新回应上一条。'
                  : task.status === 'conflict'
                    ? '对话已有新的内容，可以接着聊。'
                    : '这次没能完成回应。你说的话已经保存。'}
            </p>
            {task.status !== 'conflict' && (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => void taskAction('retry')}
              >
                <Icon name="refresh" size={16} />
                重新回应
              </Button>
            )}
          </div>
        )}
        <div ref={end} />
        {data && !waiting && (
          <ProposalThread
            client={client}
            revision={data.interview.version}
            profileVersion={data.profile.version}
            ready={data.interview.messages.some((m) => m.role === 'assistant')}
          />
        )}
      </WorkspaceShell>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="上传你的照片"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {editing && data && (
        <FactEditor
          key={editing.fact?.id ?? editing.category}
          selection={editing}
          messages={data.interview.messages}
          onClose={() => setEditing(null)}
          onSave={edit}
        />
      )}
    </>
  );
}
export function Welcome({ choose }: { choose: (text: string) => void }) {
  return (
    <div className="welcome page-enter">
      <div className="chat-opening">
        <span className="agent-symbol">
          <Icon name="spark" size={21} />
        </span>
        <h1>先聊聊此刻的你。</h1>
        <p>
          最近，有没有一件事，
          <br />
          让你总想起另一种选择？
        </p>
      </div>
      <div className="conversation-starters">
        <p>从一个小话题开始</p>
        {[
          ['chat', '最近怎么样', '最近，我的生活是这样的：'],
          ['spark', '一直想试试', '有一件我一直想做、还没尝试的事：'],
          ['clock', '忘不了的选择', '有一件改变过我的事情：'],
        ].map(([icon, label, text]) => (
          <button className="starter" key={label} onClick={() => choose(text!)}>
            <Icon name={icon as 'chat' | 'spark' | 'clock'} size={18} />
            {label}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
function Waiting({
  task,
  onCancel,
  disabled,
}: {
  task: Task;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [task.createdAt]);
  return (
    <div className="waiting" role="status">
      <div className="thinking-dots">
        <i />
        <i />
        <i />
      </div>
      <span>
        {task.status === 'queued' ? '你的话已记下，正在等待回应' : '正在想一想你的故事'}
        <small> · {seconds} 秒</small>
      </span>
      <Button variant="ghost" disabled={disabled} onClick={onCancel}>
        暂停
      </Button>
    </div>
  );
}
export function ProfilePane({
  profile,
  uploading,
  saving,
  onUpload,
  onEdit,
  onConfirm,
  events,
  error,
}: {
  error?: string;
  profile: Profile;
  uploading: boolean;
  saving: boolean;
  onUpload: () => void;
  onEdit: (category: ProfileFact['category'], fact?: ProfileFact) => void;
  onConfirm: (id: string) => void;
  events?: React.ReactNode;
}) {
  const active = profile.facts.filter((f) => f.status !== 'rejected');
  return (
    <div className="profile-stack">
      <header className="profile-title">
        <p className="eyebrow">一点一点，认识你</p>
        <h2>这就是我</h2>
        <p>聊天中提到的事，会整理在这里。你可以确认、修改，也可以自己补充。</p>
      </header>
      {error && <Notice>{error}</Notice>}
      <div className="portrait-card">
        <button
          className="portrait-upload"
          onClick={onUpload}
          disabled={uploading}
          aria-label={profile.portraitAssetId ? '更换你的照片' : '上传你的照片'}
        >
          {profile.portraitAssetId ? (
            <img src={`/api/v1/assets/${profile.portraitAssetId}`} alt="你上传的照片" />
          ) : (
            <Icon name="user" size={32} />
          )}
          <span className="photo-plus">
            {uploading ? <span className="spinner" /> : <Icon name="plus" size={12} />}
          </span>
        </button>
        <div>
          <h3>
            {uploading
              ? '正在保存照片…'
              : profile.portraitAssetId
                ? '每一种人生，都是你'
                : '放一张你的照片'}
          </h3>
          <p>{profile.portraitAssetId ? '点击照片，可以随时更换。' : '先从一张喜欢的照片开始。'}</p>
          <span className="photo-caption">只有你能看到这份档案</span>
        </div>
      </div>
      <div className="profile-section">
        <div className="section-heading">
          <h3>
            <Icon name="user" size={17} />
            关于我
          </h3>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="手动添加资料"
            onClick={() => onEdit('identity')}
          >
            <Icon name="plus" size={18} />
          </Button>
        </div>
        {active.length === 0 ? (
          <div className="profile-empty">
            <span className="empty-lines">
              <i />
              <i />
              <i />
            </span>
            <p>
              关于你的一切，
              <br />
              可以从一句话开始。
            </p>
            <Button variant="ghost" onClick={() => onEdit('identity')}>
              也可以自己填写
              <Icon name="edit" size={14} />
            </Button>
          </div>
        ) : (
          <div className="profile-facts">
            {(Object.keys(categories) as ProfileFact['category'][]).map((category) => {
              const facts = active.filter((f) => f.category === category);
              if (!facts.length) return null;
              return (
                <div className="fact-group" key={category}>
                  <h4>{categories[category]}</h4>
                  {facts.map((fact) => (
                    <div className="fact-row" key={fact.id}>
                      <button className="fact-content" onClick={() => onEdit(category, fact)}>
                        <span>{fact.value}</span>
                        <small>
                          {fact.status === 'suggested' ? '这像你吗？' : '已确认'}
                          <Icon name="edit" size={12} />
                        </small>
                      </button>
                      {fact.status === 'suggested' && (
                        <Button
                          variant="ghost"
                          className="icon-button confirm-fact"
                          aria-label={`确认：${fact.value}`}
                          disabled={saving}
                          onClick={() => onConfirm(fact.id)}
                        >
                          <Icon name="check" size={17} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {events ?? (
        <div className="profile-section">
          <div className="section-heading">
            <h3>
              <Icon name="book" size={17} />
              我的人生轨迹
            </h3>
          </div>
          <p className="section-copy">
            聊到重要的经历时，
            <br />
            它们会成为这里的一个个节点。
          </p>
          <div className="empty-timeline" aria-hidden="true">
            <i />
            <span />
            <i />
            <span />
            <i />
          </div>
        </div>
      )}
      <div className="profile-footnote">
        <Icon name="lock" size={14} />
        <p>
          由我们的对话慢慢整理。
          <br />
          不准确的地方，随时改成你自己的版本。
        </p>
      </div>
    </div>
  );
}
function FactEditor({
  selection,
  messages,
  onClose,
  onSave,
}: {
  selection: { fact?: ProfileFact; category: ProfileFact['category'] };
  messages: InterviewWorkspace['interview']['messages'];
  onClose: () => void;
  onSave: (op: ProfileEdit['operation']) => Promise<void>;
}) {
  const [value, setValue] = useState(selection.fact?.value ?? ''),
    [category, setCategory] = useState(selection.category),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sources = messages.filter((m) => selection.fact?.sourceMessageIds.includes(m.id));
  async function save(remove = false) {
    if (!remove && !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSave(
        remove
          ? { kind: 'delete-fact', id: selection.fact!.id }
          : { kind: 'set-fact', id: selection.fact?.id, category, value },
      );
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={selection.fact ? '把这条记录改成你的版本' : '写一点关于你'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="form-label">
          这是一条关于
          <select
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value as ProfileFact['category'])}
          >
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          内容
          <textarea
            className="field"
            value={value}
            autoFocus
            maxLength={500}
            onChange={(e) => setValue(e.target.value)}
            placeholder="用你自己的话写下来…"
          />
        </label>
        {sources.length > 0 && (
          <div className="source-note">
            <span>来自你说过的话</span>
            {sources.map((m) => (
              <p key={m.id}>“{m.text}”</p>
            ))}
          </div>
        )}
        {error && <Notice>{error} 你的输入还在，可以检查后重新保存。</Notice>}
        <div className="form-actions">
          {selection.fact && (
            <Button variant="danger" type="button" disabled={busy} onClick={() => void save(true)}>
              不保留这条
            </Button>
          )}
          <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? '保存中…' : '确认并保存'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
