'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LifeClient, ApiFailure } from '../api/client.ts';
import type {
  InterviewWorkspace,
  InterviewMessage,
  Profile,
  ProfileFact,
  ProfileEdit,
  Task,
  InterviewSend,
} from '../../contracts/api.ts';
import type { MemoryCandidate, MemoryCandidateDecision } from '../../contracts/memory.ts';
import { WorkspaceShell } from '../../components/workspace-shell.tsx';
import { Button, Icon, Modal, Notice } from '../../components/ui.tsx';
import { BasicInfo } from './basic-info.tsx';
import { routeBranchIntent, type BranchIntent } from './branch-intent.ts';
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

function renderMessageContent(text: string) {
  const match = text.match(/\[照片:([^\]]+)\]/);
  if (match) {
    const imageUrl = match[1];
    const remainingText = text.replace(/\[照片:[^\]]+\]\s*/, '').trim();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <a href={imageUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block' }}>
          <img
            src={imageUrl}
            alt="分享的照片"
            style={{
              maxWidth: '220px',
              maxHeight: '220px',
              borderRadius: '10px',
              objectFit: 'cover',
              display: 'block',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              border: '1px solid rgba(0,0,0,0.06)',
            }}
          />
        </a>
        {remainingText && <span>{remainingText}</span>}
      </div>
    );
  }
  return text;
}
export function InterviewApp() {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<InterviewWorkspace | null>(null),
    [error, setError] = useState(''),
    [profileError, setProfileError] = useState(''),
    [candidates, setCandidates] = useState<MemoryCandidate[]>([]),
    [candidateError, setCandidateError] = useState(''),
    [candidateBusy, setCandidateBusy] = useState<string | null>(null),
    [draft, setDraft] = useState(''),
    [streamingText, setStreamingText] = useState(''),
    [sending, setSending] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadingChatPhoto, setUploadingChatPhoto] = useState(false),
    [branchCommand, setBranchCommand] = useState<{ at: number; intent: BranchIntent } | null>(null);
  const [editing, setEditing] = useState<{
    fact?: ProfileFact;
    category: ProfileFact['category'];
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    chatFileInput = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null);
  const pending = useRef<InterviewSend | null>(null),
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
  const refreshCandidates = useCallback(async () => {
    const value = await client.candidates('suggested');
    setCandidates(value.candidates);
    return value.candidates;
  }, [client]);
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
    client
      .candidates('suggested')
      .then((value) => {
        if (live) setCandidates(value.candidates);
      })
      .catch((e) => {
        if (live) setCandidateError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [client, apply]);
  async function decideCandidate(candidateId: string, action: MemoryCandidateDecision['action']) {
    setCandidateBusy(candidateId);
    setCandidateError('');
    try {
      await client.decideCandidate({
        commandId: crypto.randomUUID(),
        candidateId,
        action,
      });
      await Promise.all([refresh(), refreshCandidates()]);
    } catch (e) {
      setCandidateError(errorMessage(e));
    } finally {
      setCandidateBusy(null);
    }
  }
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
  async function send(event?: FormEvent, textOverride?: string) {
    event?.preventDefault();
    const text = (textOverride ?? draft).trim();
    if (!data || !text || sending || waiting) return;
    const request =
      pending.current?.text === text
        ? pending.current
        : {
            commandId: crypto.randomUUID(),
            expectedVersion: data.interview.version,
            text,
            questionId: data.interview.openQuestion?.id,
            questionVersion: data.interview.openQuestion?.version,
          };
    pending.current = request;
    setSending(true);
    setStreamingText('');
    setError('');
    // 1. 立即清空输入框并聚焦
    if (!textOverride) {
      setDraft('');
      if (data.profile?.id) {
        try {
          sessionStorage.removeItem(`pl-draft:${data.profile.id}`);
        } catch {
          /* No persistent draft storage. */
        }
      }
    }

    // 2. 即刻将用户消息先上屏展示（解耦用户发送与 AI 回复）
    const optimisticMessage: InterviewMessage = {
      id: `temp-${request.commandId}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
      taskId: null,
    };
    setData((current) =>
      current
        ? {
            ...current,
            interview: {
              ...current.interview,
              messages: [...current.interview.messages, optimisticMessage],
            },
          }
        : current,
    );

    const branchIntent = routeBranchIntent(text);
    if (branchIntent !== 'none') setBranchCommand({ at: Date.now(), intent: branchIntent });

    try {
      const sent = await client.sendStream(request, (token) =>
        setStreamingText((current) => current + token),
      );
      setData((current) => (current ? { ...current, interview: sent.interview } : current));
      pending.current = null;
      setStreamingText('');
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') {
        pending.current = null;
        await refresh().catch(() => {});
      } else {
        // The user message is committed before the model stream starts;
        // refresh so an interrupted stream still becomes visible and retryable.
        await refresh().catch(() => {});
      }
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  async function uploadChatPhoto(file: File) {
    if (!data || sending || waiting || uploadingChatPhoto) return;
    setUploadingChatPhoto(true);
    setError('');
    try {
      if (file.size > 4 * 1024 * 1024) throw new ApiFailure('INVALID_INPUT', '照片请小于 4MB。');
      const asset = await client.upload(file);
      // 同时写入档案的参考照片
      try {
        const current = await refresh();
        const profile = await client.editProfile({
          expectedVersion: current.profile.version,
          operation: { kind: 'add-reference-photo', assetId: asset.id },
        });
        setData((value) => (value ? { ...value, profile } : value));
      } catch {
        /* 静默容错 */
      }

      const userText = draft.trim();
      const photoTag = `[照片:/api/v1/assets/${asset.id}]`;
      const fullText = userText ? `${photoTag}\n${userText}` : `${photoTag}\n我分享了一张生活照片。`;
      setDraft('');
      await send(undefined, fullText);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploadingChatPhoto(false);
      if (chatFileInput.current) chatFileInput.current.value = '';
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
      if (file.size > 4 * 1024 * 1024) throw new ApiFailure('INVALID_INPUT', '照片请小于 4MB。');
      const asset = await client.upload(file);
      const current = await refresh();
      const profile = await client.editProfile({
        expectedVersion: current.profile.version,
        operation: { kind: 'add-reference-photo', assetId: asset.id },
      });
      setData((value) => (value ? { ...value, profile } : value));
    } catch (e) {
      setProfileError(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  async function deletePhoto(assetId: string) {
    if (!data) return;
    setUploading(true);
    setProfileError('');
    try {
      const current = await refresh();
      const profile = await client.editProfile({
        expectedVersion: current.profile.version,
        operation: { kind: 'delete-reference-photo', assetId },
      });
      setData((value) => (value ? { ...value, profile } : value));
    } catch (e) {
      setProfileError(errorMessage(e));
    } finally {
      setUploading(false);
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
      basicInfo={
        <BasicInfo key={`profile-${data.profile.version}`} profile={data.profile} onSave={edit} />
      }
      events={<LifeEvents events={data.profile.events} onSave={edit} />}
      people={<ImportantPeople people={data.profile.people} client={client} onSave={edit} />}
      profile={data.profile}
      messages={data.interview.messages}
      uploading={uploading}
      saving={saving}
      onUpload={() => fileInput.current?.click()}
      onDeletePhoto={(assetId) => void deletePhoto(assetId)}
      onEdit={(category, fact) => setEditing({ category, fact })}
      onConfirm={(id) => void edit({ kind: 'confirm-fact', id }).catch(() => {})}
      candidates={candidates}
      candidateError={candidateError}
      candidateBusy={candidateBusy}
      onCandidateAction={(id, action) => void decideCandidate(id, action)}
    />
  ) : (
    <div className="profile-loading">
      <span className="spinner" />
      <span>正在打开你的档案</span>
    </div>
  );
  return (
    <>
      <WorkspaceShell
        profile={profile}
        profileCount={
          (data?.profile.facts.filter((f) => f.status === 'suggested').length ?? 0) +
          candidates.length
        }
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
              <input
                ref={chatFileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="上传照片并发送"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadChatPhoto(file);
                }}
              />
              <textarea
                ref={input}
                value={draft}
                maxLength={4000}
                onChange={(e) => updateDraft(e.target.value)}
                aria-label="和人生伙伴说说你"
                placeholder="说点什么，也可点击下方发送照片…"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <span className="composer-tip">
                  <Icon name="lock" size={12} />按 Enter 发送 · Shift + Enter 换行
                  {draft.length > 3000 && ` · ${draft.length}/4000`}
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    type="button"
                    title="上传照片分享给人生伙伴并存入档案"
                    aria-label="发送照片"
                    disabled={!data || sending || waiting || uploadingChatPhoto}
                    onClick={() => chatFileInput.current?.click()}
                    style={{
                      background: 'none',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '6px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '13px',
                      color: '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {uploadingChatPhoto ? (
                      <span className="spinner" style={{ width: '14px', height: '14px' }} />
                    ) : (
                      <Icon name="photo" size={15} />
                    )}
                    <span>照片</span>
                  </button>
                  <Button
                    type="submit"
                    aria-label="发送消息"
                    disabled={!data || !draft.trim() || sending || waiting || uploadingChatPhoto}
                  >
                    {sending ? <span className="spinner" /> : <Icon name="send" size={18} />}
                    <span>发送</span>
                  </Button>
                </div>
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
                  <div className="message-text">{renderMessageContent(message.text)}</div>
                </div>
              </div>
            ))}
            {streamingText ? (
              <div
                className="message message-assistant message-enter"
                aria-label="人生伙伴正在回复"
              >
                <div className="message-avatar">
                  <Icon name="spark" size={18} />
                </div>
                <div>
                  <div className="message-text streaming-text">
                    {streamingText}
                    <span className="streaming-caret" aria-hidden="true" />
                  </div>
                </div>
              </div>
            ) : sending ? (
              <div
                className="message message-assistant message-enter"
                aria-label="人生伙伴正在思考"
              >
                <div className="message-avatar">
                  <Icon name="spark" size={18} />
                </div>
                <div>
                  <div
                    className="message-text"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.85 }}
                  >
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    <span>人生伙伴正在思考…</span>
                  </div>
                </div>
              </div>
            ) : null}
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
        {data && (
          <ProposalThread
            client={client}
            revision={data.interview.version}
            profileVersion={data.profile.version}
            ready={data.interview.messages.some((m) => m.role === 'assistant')}
            confirmedCount={data.profile.facts.filter((f) => f.status === 'confirmed').length}
            pendingCandidates={candidates.length}
            externalTrigger={branchCommand?.at ?? 0}
            externalIntent={branchCommand?.intent ?? 'none'}
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
    <div className="message message-assistant first-greeting">
      <div className="message-avatar">如</div>
      <div>
        <div className="message-text">
          你想不想看一看，平行世界的你正在过着怎样的人生？
          <br />
          <br />
          告诉我一些关于你的事情，我来为你塑造几段专属于你的平行世界事件。在此之前，你可以先告诉我你的出生年月日（或者时间），让我感受你的性格底色；也可以直接告诉我，你最近有什么烦心事，或者人生中有哪些最想重新选择的决定。
        </div>
        <div
          className="first-greeting-suggestions"
          style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}
        >
          <button
            type="button"
            className="button secondary compact"
            style={{ fontSize: '13px', borderRadius: '16px', padding: '6px 12px' }}
            onClick={() => choose('我的出生年月日是：')}
          >
            🎂 告知出生时间，测算性格基调
          </button>
          <button
            type="button"
            className="button secondary compact"
            style={{ fontSize: '13px', borderRadius: '16px', padding: '6px 12px' }}
            onClick={() => choose('如果当年我做出了另一个重大决定：')}
          >
            🔀 假如重选当年那个关键决定
          </button>
          <button
            type="button"
            className="button secondary compact"
            style={{ fontSize: '13px', borderRadius: '16px', padding: '6px 12px' }}
            onClick={() => choose('最近让我最烦恼心累的一件事是：')}
          >
            💭 聊聊最近挥之不去的烦心事
          </button>
        </div>
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

  const isQueued = task.status === 'queued';
  const isQueuedDelayed = isQueued && seconds >= 25;
  const isRunningDelayed = !isQueued && seconds >= 45;
  const isTimedOut = seconds >= 90;

  return (
    <div
      className={`waiting ${isTimedOut ? 'waiting-timeout' : isQueuedDelayed || isRunningDelayed ? 'waiting-delayed' : ''}`}
      role="status"
    >
      {!isTimedOut && (
        <div className="thinking-dots">
          <i />
          <i />
          <i />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <span>
          {isTimedOut
            ? '处理时间超出预期，连接或通道可能中断'
            : isQueuedDelayed
              ? '当前排队通道繁忙，正在等待调度'
              : isRunningDelayed
                ? '模型正在深度推演中，耗时较平时稍长'
                : isQueued
                  ? '你的话已记下，正在等待回应'
                  : '正在想一想你的故事'}
          <small> · {seconds} 秒</small>
        </span>
        {isTimedOut && (
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            输入内容已保存在会话中，建议暂停并重新发起回应
          </span>
        )}
      </div>
      <Button variant={isTimedOut ? 'secondary' : 'ghost'} disabled={disabled} onClick={onCancel}>
        {isTimedOut ? '取消重试' : '暂停'}
      </Button>
    </div>
  );
}
export function ProfilePane({
  profile,
  messages = [],
  uploading,
  saving,
  onUpload,
  onDeletePhoto,
  onEdit,
  onConfirm,
  events,
  people,
  basicInfo,
  error,
  candidates = [],
  candidateError,
  candidateBusy,
  onCandidateAction,
}: {
  error?: string;
  profile: Profile;
  uploading: boolean;
  saving: boolean;
  onUpload: () => void;
  onDeletePhoto?: (assetId: string) => void;
  onEdit: (category: ProfileFact['category'], fact?: ProfileFact) => void;
  onConfirm: (id: string) => void;
  events?: React.ReactNode;
  people?: React.ReactNode;
  basicInfo?: React.ReactNode;
  messages?: InterviewWorkspace['interview']['messages'];
  candidates?: MemoryCandidate[];
  candidateError?: string;
  candidateBusy?: string | null;
  onCandidateAction?: (id: string, action: MemoryCandidateDecision['action']) => void;
}) {
  const active = profile.facts.filter(
    (f) => f.status !== 'rejected' && !(basicInfo && f.value.startsWith('个人资料\n')),
  );
  const name = profile.facts
    .filter((f) => f.status === 'confirmed')
    .flatMap((f) => f.value.split('\n'))
    .find((line) => line.startsWith('姓名：'))
    ?.slice(3);
  return (
    <div className="profile-stack">
      {error && <Notice>{error}</Notice>}
      <div
        className="portrait-card"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            className="portrait-upload"
            onClick={onUpload}
            disabled={uploading}
            aria-label={profile.portraitAssetId ? '更换你的肖像照片' : '上传你的肖像照片'}
            style={{ width: '56px', height: '56px', flexShrink: 0 }}
          >
            {profile.portraitAssetId ? (
              <img src={`/api/v1/assets/${profile.portraitAssetId}`} alt="你上传的主肖像照片" />
            ) : (
              <Icon name="user" size={32} />
            )}
            <span className="photo-plus">
              {uploading ? <span className="spinner" /> : <Icon name="plus" size={12} />}
            </span>
          </button>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px' }}>
              {uploading
                ? '正在保存底模照片…'
                : profile.referenceAssetIds && profile.referenceAssetIds.length > 0
                  ? `📸 肖像与生活照底模已就绪 (${profile.referenceAssetIds.length} 张)`
                  : profile.portraitAssetId
                    ? '✨ 肖像底模已就绪'
                    : '📸 上传肖像底模（用于平行人生图生图）'}
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '3px', lineHeight: '1.4' }}>
              {profile.referenceAssetIds && profile.referenceAssetIds.length > 0
                ? '已绑定为您本人的面貌参考底模，开启平行分支时将图生图生成开篇角色写真并存入相册。'
                : '上传真实照片后，选择平行分支（如独立电影导演、主理人）时将以您的面貌图生图生成角色写真存入相册。'}
            </p>
          </div>
        </div>

        {/* 多张参考底模图片平铺展示区 */}
        {profile.referenceAssetIds && profile.referenceAssetIds.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0 2px' }}>
            {profile.referenceAssetIds.map((id, index) => (
              <div
                key={id}
                style={{
                  position: 'relative',
                  width: '64px',
                  height: '64px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border:
                    id === profile.portraitAssetId ? '2px solid #0284c7' : '1px solid #e2e8f0',
                  flexShrink: 0,
                  background: '#f8fafc',
                }}
              >
                <img
                  src={`/api/v1/assets/${id}`}
                  alt={`参考底模照片 ${index + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {id === profile.portraitAssetId && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'rgba(2, 132, 199, 0.85)',
                      color: '#ffffff',
                      fontSize: '9px',
                      textAlign: 'center',
                      lineHeight: '14px',
                      fontWeight: 600,
                    }}
                  >
                    主肖像
                  </span>
                )}
                {onDeletePhoto && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePhoto(id);
                    }}
                    title="移除这张底模照片"
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {profile.referenceAssetIds.length < 6 && (
              <button
                type="button"
                onClick={onUpload}
                disabled={uploading}
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '8px',
                  border: '1px dashed #cbd5e1',
                  background: '#f8fafc',
                  color: '#64748b',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '11px',
                  flexShrink: 0,
                  gap: '2px',
                }}
              >
                <Icon name="plus" size={16} />
                <span>添加</span>
              </button>
            )}
          </div>
        )}
      </div>
      {onCandidateAction && (
        <CandidatePanel
          candidates={candidates}
          messages={messages}
          error={candidateError}
          busyId={candidateBusy}
          onAction={onCandidateAction}
        />
      )}
      <details className="profile-fold">
        <summary>
          基本资料
          <Icon name="chevron" size={16} />
        </summary>
        {basicInfo}
      </details>
      <details
        className="profile-fold"
        open={active.some((f) => f.status === 'suggested') || undefined}
      >
        <summary>
          我的故事
          <Icon name="chevron" size={16} />
        </summary>
        <div className="profile-section">
          <div className="section-heading">
            <h3>
              <Icon name="user" size={17} />
              聊到的事
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
      </details>
      <details className="profile-fold">
        <summary>
          重要的人
          <Icon name="chevron" size={16} />
        </summary>
        {people ?? <p className="preview-profile-placeholder">你聊过的重要人物，会整理在这里。</p>}
      </details>
      <details className="profile-fold">
        <summary>
          人生经历
          <Icon name="chevron" size={16} />
        </summary>
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
      </details>
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

function CandidatePanel({
  candidates,
  messages,
  error,
  busyId,
  onAction,
}: {
  candidates: MemoryCandidate[];
  messages: InterviewWorkspace['interview']['messages'];
  error?: string;
  busyId?: string | null;
  onAction: (id: string, action: MemoryCandidateDecision['action']) => void;
}) {
  if (!candidates.length && !error) return null;
  const messageById = new Map(messages.map((message) => [message.id, message]));
  return (
    <section className="candidate-review" aria-labelledby="candidate-review-title">
      <div className="section-heading">
        <h3 id="candidate-review-title">
          <Icon name="spark" size={17} />
          Agent 的记录
        </h3>
        <span className="candidate-count">{candidates.length}</span>
      </div>
      <p className="candidate-intro">刚才聊到的内容，先由你决定要不要留下。</p>
      {error && <Notice>{error}</Notice>}
      <div className="candidate-list">
        {candidates.map((candidate) => {
          const sources = candidate.sourceMessageIds
            .map((id) => messageById.get(id))
            .filter((message): message is NonNullable<typeof message> => Boolean(message));
          const busy = busyId === candidate.id;
          return (
            <article className="candidate-card" key={candidate.id}>
              <div className="candidate-card-meta">
                <span>{categories[candidate.category]}</span>
                {candidate.eventDate && <time>{candidate.eventDate}</time>}
              </div>
              <p className="candidate-text">{candidate.text}</p>
              <details className="candidate-source">
                <summary>
                  查看来源 · {sources.length || candidate.sourceMessageIds.length} 条对话
                </summary>
                <div className="candidate-source-list">
                  {sources.length ? (
                    sources.map((source) => <p key={source.id}>{source.text}</p>)
                  ) : (
                    <p>来源对话暂时不可见。</p>
                  )}
                </div>
              </details>
              <div className="candidate-actions">
                <Button disabled={busy} onClick={() => onAction(candidate.id, 'confirm')}>
                  {busy ? <span className="spinner" /> : <Icon name="check" size={15} />}
                  记住这条
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onAction(candidate.id, 'reject')}
                >
                  暂不记录
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
