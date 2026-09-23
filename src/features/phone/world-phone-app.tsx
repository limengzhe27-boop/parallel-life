'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell } from './phone-shell.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import { Avatar } from './apps/common.tsx';
import type { PhoneActions, PhoneActionReceipt, PhoneAppsData, PhoneNote } from './apps/types.ts';
import { worldAppData } from './world-app-data.ts';
import { formatChatTime } from './apps/helpers.ts';
import type { PhoneMessage } from './apps/types.ts';
import { PhoneIcon } from './phone-icons.tsx';
import styles from './phone.module.css';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState(''),
    [isBuilding, setIsBuilding] = useState(false),
    [localMessages, setLocalMessages] = useState<PhoneMessage[]>([]),
    [statusMessage, setStatusMessage] = useState('正在打开你的手机…'),
    [refreshing, setRefreshing] = useState(false);
  const request = useRef(0),
    retryCommand = useRef<{ taskId: string; id: string } | null>(null);

  /**
   * Send one phone message and keep its honest state: shown as pending immediately,
   * kept as failed (with the text and a retry action) when the server does not commit.
   * Throws so the composer's operation is recorded as failed rather than "sent".
   */
  async function deliverMessage(
    actorId: string,
    text: string,
    commandId: string,
    replacing?: string,
  ) {
    const entry: PhoneMessage = {
      id: commandId,
      actorId,
      role: 'user',
      text,
      at: new Date().toISOString(),
      status: 'pending',
    };
    setLocalMessages((current) => [
      ...current.filter((message) => message.id !== commandId && message.id !== replacing),
      entry,
    ]);
    try {
      await client.sendWorldMessage(worldId, {
        commandId,
        actorId,
        text,
        expectedVersion: data?.version ?? 0,
      });
      setLocalMessages((current) => current.filter((message) => message.id !== commandId));
      await load();
    } catch (sendError) {
      setLocalMessages((current) =>
        current.map((message) =>
          message.id === commandId ? { ...message, status: 'failed' } : message,
        ),
      );
      throw sendError;
    }
  }

  /**
   * A queued or running build may simply have lost its runner, so completing the
   * existing task is recovery, not a new attempt. A failed or unknown attempt is
   * never retried here: that would spend money without the user asking, and the
   * phone would re-spend on every reload. It needs an explicit retry instead.
   */
  async function resolveInterruptedBuild(): Promise<'opened' | 'failed' | 'unknown' | 'none'> {
    const builds = await client.builds();
    const target = builds.find((build) => build.worldId === worldId);
    const task = target?.task;
    if (!target || target.ready || !task) return 'none';
    if (task.status === 'failed' || task.status === 'unknown') return task.status;
    if (!['queued', 'running'].includes(task.status)) return 'none';
    setIsBuilding(true);
    setStatusMessage('正在继续生成这段人生…');
    await client.task(task.id);
    setData(await client.world(worldId));
    setIsBuilding(false);
    return 'opened';
  }

  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    setRefreshing(true);
    setError('');
    setIsBuilding(false);
    setStatusMessage('正在打开你的手机…');
    try {
      setData(await client.world(worldId));
      return;
    } catch (e) {
      try {
        const resolved = await resolveInterruptedBuild();
        if (resolved === 'opened') return;
        if (resolved === 'unknown') {
          if (currentRequest === request.current)
            setError('上一次生成没有得到完整结果，可能已经产生了费用。请确认后再重新生成。');
          return;
        }
        if (resolved === 'failed') {
          if (currentRequest === request.current)
            setError('上一次生成没有通过校验，所以没有保存。可以重新生成一次。');
          return;
        }
      } catch {
        /* Fall through to the plain read error below. */
      }
      if (currentRequest === request.current) {
        setIsBuilding(false);
        setError(e instanceof ApiFailure ? e.message : '暂时无法打开这段人生。');
      }
    } finally {
      if (currentRequest === request.current) setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, worldId]);

  /** Explicit, user-initiated new attempt: same commandId is reused for one task. */
  async function retryBuild() {
    setError('');
    setIsBuilding(true);
    setStatusMessage('正在重新生成这段人生…');
    try {
      const builds = await client.builds();
      const target = builds.find((build) => build.worldId === worldId);
      const task = target?.task;
      if (!task) throw new Error('没有找到这次生成任务。');
      if (retryCommand.current?.taskId !== task.id)
        retryCommand.current = { taskId: task.id, id: crypto.randomUUID() };
      const retried = await client.retryTask(task.id, retryCommand.current.id);
      await client.task(retried.id);
      setData(await client.world(worldId));
    } catch (e) {
      setError(
        e instanceof ApiFailure ? e.message : '这次重新生成没有完成，可以再试一次。',
      );
    } finally {
      setIsBuilding(false);
    }
  }

  useEffect(() => {
    setData(null);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  return (
    <div className="world-viewport">
      <AppViewport />
      {!data ? (
        <div className="world-loading">
          <a href="/possibilities">← 返回分支</a>
          {isBuilding ? (
            <div className="world-building" role="status">
              <span className="build-state-spinner" aria-hidden="true" />
              <p>{statusMessage}</p>
              <small>大模型正在推演，请不要关闭页面。</small>
            </div>
          ) : error ? (
            <>
              <Notice>{error}</Notice>
              <Button variant="secondary" disabled={refreshing} onClick={() => void load()}>
                重新打开
              </Button>
              <Button disabled={refreshing} onClick={() => void retryBuild()}>
                重新生成这段人生
              </Button>
            </>
          ) : (
            <p>{statusMessage}</p>
          )}
        </div>
      ) : (
        <WorldPhoneSurface
          key={data.id}
          data={data}
          onUploadPhoto={async (file, commandId) => {
            const photo = await client.uploadPhoto(worldId, file, commandId);
            request.current++;
            setRefreshing(false);
            setData((current) =>
              !current || current.id !== photo.worldId
                ? current
                : {
                    ...current,
                    photos: [photo, ...(current.photos ?? []).filter((p) => p.id !== photo.id)],
                  },
            );
            void load();
            return { status: 'committed' };
          }}
          onChangeInvitation={async (input) => {
            const receipt = await client.changeInvitation(worldId, input);
            // Invalidate older reads; a committed receipt must survive a failed refresh.
            request.current++;
            setRefreshing(false);
            setData((current) =>
              !current || current.id !== receipt.worldId || (current.version ?? 0) > receipt.version
                ? current
                : {
                    ...current,
                    version: receipt.version,
                    invitations: (current.invitations ?? []).map((a) =>
                      a.id === receipt.invitation.id ? receipt.invitation : a,
                    ),
                  },
            );
            void load();
            return { status: 'committed' };
          }}
          onSendMessage={async (actorId, text, commandId) => {
            await deliverMessage(actorId, text, commandId);
            return { status: 'committed' };
          }}
          onRetryMessage={async (messageId, commandId) => {
            const failed = localMessages.find((message) => message.id === messageId);
            if (!failed) return { status: 'committed' };
            await deliverMessage(failed.actorId, failed.text, commandId, messageId);
            return { status: 'committed' };
          }}
          localMessages={localMessages}
          onReload={load}
          loading={refreshing}
          loadError={error}
        />
      )}
    </div>
  );
}

export function WorldPhoneSurface({
  data,
  preview = false,
  onReload,
  onChangeInvitation,
  onSendMessage,
  onRetryMessage,
  onUploadPhoto,
  onSaveNote,
  localMessages = [],
  loading = false,
  loadError,
}: {
  data: WorldPhone;
  preview?: boolean;
  onReload?: () => Promise<void>;
  onChangeInvitation?: PhoneActions['changeInvitation'];
  onSendMessage?: PhoneActions['sendMessage'];
  onRetryMessage?: PhoneActions['retryMessage'];
  onUploadPhoto?: PhoneActions['uploadPhoto'];
  /** Messages this browser sent that the server has not confirmed yet. */
  localMessages?: readonly PhoneMessage[];
  onSaveNote?: PhoneActions['saveNote'];
  loading?: boolean;
  loadError?: string;
}) {
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set());

  const notesJson = JSON.stringify(data.notes ?? []);
  const initialNotes: readonly PhoneNote[] = useMemo(() => {
    return (data.notes ?? []).map((note, index) => ({
      id: `${data.id}:opening-note:${index}`,
      title: note.title,
      text: note.text,
      version: 0,
      updatedAt: data.time,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id, notesJson, data.time]);

  const [notes, setNotes] = useState<readonly PhoneNote[]>(initialNotes);

  useEffect(() => {
    try {
      const storageKey = `pl_notes:${data.id}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const savedIds = new Set(parsed.map((n: PhoneNote) => n.id));
          const missingOpening = initialNotes.filter((n) => !savedIds.has(n.id));
          setNotes([...parsed, ...missingOpening]);
          return;
        }
      }
    } catch {
      // Ignore localStorage read errors in restricted contexts
    }
    setNotes(initialNotes);
  }, [data.id, initialNotes]);

  const handleSaveNote: NonNullable<PhoneActions['saveNote']> = useCallback(
    async (input) => {
      const now = new Date().toISOString();
      setNotes((current) => {
        let next: PhoneNote[];
        if (input.id) {
          const exists = current.some((n) => n.id === input.id);
          if (exists) {
            next = current.map((n) =>
              n.id === input.id
                ? {
                    ...n,
                    title: input.title,
                    text: input.text,
                    version: (n.version ?? 0) + 1,
                    updatedAt: now,
                  }
                : n,
            );
          } else {
            next = [
              {
                id: input.id,
                title: input.title,
                text: input.text,
                version: (input.expectedVersion ?? 0) + 1,
                updatedAt: now,
              },
              ...current,
            ];
          }
        } else {
          const newId = `${data.id}:note:${Date.now()}`;
          next = [
            {
              id: newId,
              title: input.title,
              text: input.text,
              version: 1,
              updatedAt: now,
            },
            ...current,
          ];
        }
        try {
          localStorage.setItem(`pl_notes:${data.id}`, JSON.stringify(next));
        } catch {
          // Ignore localStorage write errors
        }
        return next;
      });

      if (onSaveNote) {
        try {
          await onSaveNote(input);
        } catch {
          // Keep local changes even if remote rejected
        }
      }

      return { status: 'committed' };
    },
    [data.id, onSaveNote],
  );

  const [proactiveMessages, setProactiveMessages] = useState<WorldPhone['messages']>(() => {
    try {
      const storageKey = `pl_proactive:${data.id}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore localStorage read errors in restricted contexts
    }
    return [];
  });

  const [directorNotice, setDirectorNotice] = useState<string | null>(null);

  const triggerProactiveMessage = useCallback(
    (actorId?: string) => {
      if (!data.actors.length) return null;
      const targetActor = actorId
        ? data.actors.find((a) => a.id === actorId) ?? data.actors[0]!
        : data.actors[Math.floor(Math.random() * data.actors.length)]!;

      const rel = targetActor.relationship || '';
      let text = '在忙吗？晚点有空回我一下哈～';
      if (
        rel.includes('合伙') ||
        rel.includes('创') ||
        rel.includes('同事') ||
        rel.includes('工作') ||
        rel.includes('项目')
      ) {
        const lines = [
          '孟哲，刚跟团队对了一轮方案，感觉你之前提的核心切入点完全立得住，等你忙完咱们对下细节！',
          '刚才看了眼这周的进度排期，进展很顺利，你那边手头的事怎么样了？',
          '下午我准备去碰一下合作方，有什么需要我带过去的资料吗？',
          '刚把最新的反馈整理了一份纪要，晚点微信发你，有空瞄一眼哈。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('师') ||
        rel.includes('长') ||
        rel.includes('领导') ||
        rel.includes('前辈') ||
        rel.includes('顾问')
      ) {
        const lines = [
          '孟哲啊，看到你手头的新进展了，沉住气，按你自己的节奏走就行。',
          '上次聊到的那个课题方向，我整理了两点参考资料，有空微信上看看。',
          '做事要张弛有度，别把弦绷得太紧，有困惑随时来找我探讨。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('友') ||
        rel.includes('学') ||
        rel.includes('闺蜜') ||
        rel.includes('哥们')
      ) {
        const lines = [
          '在忙啥呢！刚路过那家新开的店，看起来超赞，周末要不要一块去坐坐？',
          '今天下班早不早？好久没跟你碰头吃个饭了，有空随时吱一声！',
          '刚才刷到个好玩的瞬间想到你，晚点你忙完了记得看微信啊～',
          '喂！这周过得如何？找机会聚聚，我有好多新鲜事跟你八卦。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      } else if (
        rel.includes('伴侣') ||
        rel.includes('太太') ||
        rel.includes('女友') ||
        rel.includes('老婆') ||
        rel.includes('先生')
      ) {
        const lines = [
          '下班顺路买点你喜欢的水果回去，今天一切都顺利吧？',
          '在忙吗？别太累着自己，忙完早点休息～',
          '出门记得带把伞，天气看着有点阴。晚上等你一块吃饭。',
        ];
        text = lines[Math.floor(Math.random() * lines.length)]!;
      }

      const newMsg: WorldPhone['messages'][number] = {
        id: `proactive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        actorId: targetActor.id,
        role: 'assistant',
        text,
        at: new Date().toISOString(),
      };

      setProactiveMessages((prev) => {
        const next = [...prev, newMsg];
        try {
          localStorage.setItem(`pl_proactive:${data.id}`, JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });

      return { actorName: targetActor.name, text };
    },
    [data.actors, data.id],
  );

  useEffect(() => {
    const key = `pl_ambient_sent:${data.id}`;
    if (sessionStorage.getItem(key)) return;
    const timer = setTimeout(() => {
      sessionStorage.setItem(key, '1');
      triggerProactiveMessage();
    }, 45000);
    return () => clearTimeout(timer);
  }, [data.id, triggerProactiveMessage]);

  const mergedData: WorldPhone = useMemo(() => {
    if (!proactiveMessages.length) return data;
    const existingIds = new Set(data.messages.map((m) => m.id));
    const newProactive = proactiveMessages.filter((m) => !existingIds.has(m.id));
    return {
      ...data,
      messages: [...data.messages, ...newProactive],
    };
  }, [data, proactiveMessages]);

  const basePhoneData = worldAppData(mergedData, viewed, localMessages);
  const phoneData: PhoneAppsData = useMemo(
    () => ({
      ...basePhoneData,
      notes,
    }),
    [basePhoneData, notes],
  );

  return (
    <PhoneAppsProvider
      worldId={data.id}
      data={phoneData}
      loading={loading}
      loadError={loadError}
      onReload={onReload}
      actions={{
        changeInvitation: preview ? undefined : onChangeInvitation,
        sendMessage: preview ? undefined : onSendMessage,
        retryMessage: preview ? undefined : onRetryMessage,
        uploadPhoto: preview ? undefined : onUploadPhoto,
        saveNote: handleSaveNote,
        noteSync: onSaveNote ? 'server' : 'local',
        markRead: async (actorId) => {
          setViewed(
            (current) =>
              new Set([
                ...current,
                ...mergedData.messages.filter((m) => m.actorId === actorId).map((m) => m.id),
              ]),
          );
        },
      }}
    >
      <PhoneShell
        worldId={data.id}
        lifeName={data.title}
        dateLabel={new Date(data.time.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('zh-CN', {
          timeZone: 'UTC',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
        timeLabel={data.time.slice(11, 16)}
        wallpaperUrl="/art/first-window.webp"
        notice={preview ? <span>开发样板 · 合成数据 · 未调用模型</span> : undefined}
        notifications={[
          ...mergedData.messages
            .filter((m) => m.role !== 'user')
            .slice(-4)
            .map((m) => ({
              id: m.id,
              title: data.actors.find((a) => a.id === m.actorId)?.name ?? '微信消息',
              summary: m.text,
              app: 'messages' as const,
              target: m.actorId,
              timeLabel: formatChatTime(m.at, data.time),
            })),
          ...(data.invitations && data.invitations.length > 0
            ? data.invitations.slice(0, 1).map((inv) => ({
                id: `notif-inv-${inv.id}`,
                title: inv.title,
                summary: `${inv.at.slice(0, 10)} ${inv.at.slice(11, 16)} · ${inv.status === 'confirmed' ? '已约好' : '邀请 · 待回复'}`,
                app: 'calendar' as const,
                target: inv.id,
                timeLabel: inv.status === 'confirmed' ? '已约好' : '待回复',
              }))
            : /* 没有真实约定就不伪造日历通知 */
              []),
          ...(notes.length > 0
            ? [
                {
                  id: `notif-note-${notes[0]?.id}`,
                  title: '便签提醒',
                  summary: `备忘：“${notes[0]?.title}”`,
                  app: 'notes' as const,
                  target: notes[0]?.id,
                  timeLabel: '备忘',
                },
              ]
            : []),
        ]}
        renderHome={({ open, openPanel }) => {
          const unreadCount = data.actors.reduce(
            (acc, actor) =>
              acc +
              mergedData.messages.filter(
                (m) => m.actorId === actor.id && m.role !== 'user' && !viewed.has(m.id),
              ).length,
            0,
          );
          const recentMessage = [...mergedData.messages]
            .reverse()
            .find((m) => m.role !== 'user');
          const recentActor = recentMessage
            ? data.actors.find((a) => a.id === recentMessage.actorId)
            : data.actors[0];

          return (
            <div
              style={{
                minHeight: '100%',
                padding: '14px 16px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              {/* Top Shortcut Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: 'rgba(0, 0, 0, 0.35)',
                    backdropFilter: 'blur(10px)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  <span>✨</span> 平行人生
                </div>
                <button
                  type="button"
                  data-panel="management"
                  onClick={() => openPanel('management')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 14px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(12px)',
                    color: '#0f172a',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  }}
                >
                  人生管理 <PhoneIcon name="next" />
                </button>
              </div>

              {/* Life Overview Widget Card */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.88)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: '22px',
                  padding: '16px 18px',
                  color: '#0f172a',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
                  border: '1px solid rgba(255, 255, 255, 0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#6366f1',
                        letterSpacing: '0.05em',
                        marginBottom: '3px',
                      }}
                    >
                      🌟 当前世界设定
                    </div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '17px',
                        fontWeight: 700,
                        color: '#0f172a',
                        lineHeight: 1.3,
                      }}
                    >
                      {data.title}
                    </h3>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      background: '#ecfdf5',
                      color: '#059669',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      fontWeight: 500,
                      border: '1px solid #a7f3d0',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ● 运转中
                  </span>
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: '#475569',
                    lineHeight: 1.5,
                  }}
                >
                  {data.identity}
                </p>

                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    marginTop: '2px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openPanel('director')}
                    style={{
                      flex: 1,
                      padding: '7px 8px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      color: '#1e293b',
                      fontSize: '11px',
                      fontWeight: 600,
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    🎬 推进剧情
                  </button>
                  <button
                    type="button"
                    onClick={() => openPanel('timeline')}
                    style={{
                      flex: 1,
                      padding: '7px 8px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      color: '#1e293b',
                      fontSize: '11px',
                      fontWeight: 600,
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    👥 人脉图谱
                  </button>
                  <button
                    type="button"
                    onClick={() => openPanel('schedule')}
                    style={{
                      flex: 1,
                      padding: '7px 8px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      color: '#1e293b',
                      fontSize: '11px',
                      fontWeight: 600,
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    🗓️ 故事时间
                  </button>
                </div>
              </div>

              {/* Recent Conversation Activity Widget */}
              {recentActor && (
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.88)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: '20px',
                    padding: '14px 16px',
                    color: '#0f172a',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.6)',
                    cursor: 'pointer',
                  }}
                  onClick={() => open('messages', recentActor.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Avatar name={recentActor.name} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                          {recentActor.name}
                        </div>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {recentActor.relationship}
                        </span>
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#0284c7',
                        fontWeight: 500,
                        background: '#e0f2fe',
                        padding: '2px 8px',
                        borderRadius: '10px',
                      }}
                    >
                      微信来信 ›
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#334155',
                      lineHeight: 1.45,
                      background: '#f8fafc',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {recentMessage ? recentMessage.text : `与 ${recentActor.name} 的对话通道已建立。`}
                  </div>
                </div>
              )}

              {/* App Launchers Grid on Desktop */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '10px',
                  padding: '4px 2px',
                }}
              >
                {[
                  {
                    app: 'messages' as const,
                    name: '微信',
                    badge: unreadCount > 0 ? unreadCount : undefined,
                    icon: 'messages' as const,
                  },
                  {
                    app: 'calendar' as const,
                    name: '日历',
                    badge: data.invitations?.length ? data.invitations.length : undefined,
                    icon: 'calendar' as const,
                  },
                  {
                    app: 'photos' as const,
                    name: '相册',
                    badge: undefined,
                    icon: 'photos' as const,
                  },
                  {
                    app: 'notes' as const,
                    name: '便签',
                    badge: notes.length ? notes.length : undefined,
                    icon: 'notes' as const,
                  },
                ].map((item) => (
                  <button
                    key={item.app}
                    type="button"
                    onClick={() => open(item.app)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: '54px',
                        height: '54px',
                        borderRadius: '14px',
                        background: '#ffffff',
                        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.18)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <span className={`${styles.appIcon} ${styles[item.app]}`} style={{ width: '54px', height: '54px' }}>
                        {item.app === 'calendar' ? (
                          <span className={styles.calendarFace}>
                            <span>日历</span>
                            <strong style={{ fontSize: '26px', lineHeight: '28px' }}>
                              {data.time.slice(8, 10)}
                            </strong>
                          </span>
                        ) : (
                          <PhoneIcon name={item.icon} />
                        )}
                      </span>
                      {item.badge !== undefined && (
                        <span
                          style={{
                            position: 'absolute',
                            top: '-4px',
                            right: '-4px',
                            minWidth: '20px',
                            height: '20px',
                            borderRadius: '10px',
                            background: '#ef4444',
                            color: '#ffffff',
                            fontSize: '11px',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 4px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: '#ffffff',
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
                      }}
                    >
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        }}
        renderApp={(context) => <PhoneAppView {...context} />}
        renderPanel={(panel) => {
          if (panel === 'timeline') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#2563eb',
                      marginBottom: '8px',
                    }}
                  >
                    <span>✨</span> 当前平行世界身份
                  </div>
                  <h3
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#0f172a',
                    }}
                  >
                    {data.title}
                  </h3>
                  <p
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '13px',
                      color: '#334155',
                      lineHeight: 1.6,
                    }}
                  >
                    {data.identity}
                  </p>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#64748b',
                      background: '#ffffff',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <strong>时代与环境：</strong>
                    {data.setting}
                  </div>
                </div>

                <div>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    👥 角色人脉图谱（共 {data.actors.length} 位）
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {data.actors.map((actor) => (
                      <div
                        key={actor.id}
                        style={{
                          background: '#ffffff',
                          borderRadius: '12px',
                          padding: '12px 14px',
                          border: '1px solid #e2e8f0',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Avatar name={actor.name} />
                            <div>
                              <div
                                style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}
                              >
                                {actor.name}
                              </div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {actor.relationship}
                              </span>
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', color: '#16a34a' }}>● 在线</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                          {actor.summary ||
                            `在当前世界中与你紧密相连，是你的${actor.relationship}。`}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <a
                            href={`#life=${data.id}&app=messages&target=${actor.id}`}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '8px',
                              borderRadius: '8px',
                              background: '#ecfdf5',
                              color: '#059669',
                              fontSize: '12px',
                              fontWeight: 500,
                              textDecoration: 'none',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            💬 发微信
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginTop: '8px',
                  }}
                >
                  <a
                    className="button secondary"
                    href="/possibilities"
                    style={{
                      textAlign: 'center',
                      padding: '10px',
                      borderRadius: '10px',
                      background: '#f1f5f9',
                      color: '#334155',
                      textDecoration: 'none',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    ← 换一条人生分支
                  </a>
                  <a
                    href="/"
                    style={{
                      textAlign: 'center',
                      padding: '8px',
                      color: '#64748b',
                      textDecoration: 'none',
                      fontSize: '12px',
                    }}
                  >
                    返回现实档案
                  </a>
                </div>
              </div>
            );
          }

          if (panel === 'schedule') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#0284c7',
                      marginBottom: '4px',
                    }}
                  >
                    ⏱️ 人生时间线与节奏
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
                    {new Date(data.time.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('zh-CN', {
                      timeZone: 'UTC',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                    世界时钟：{data.time.slice(11, 16)} ·{' '}
                    <span style={{ color: '#16a34a' }}>🟢 现实同步流转中</span>
                  </div>
                </div>

                <div>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    🗓️ 近期关键日程与约定（{data.invitations?.length ?? 0} 项）
                  </h4>
                  {data.invitations && data.invitations.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {data.invitations.map((inv) => (
                        <a
                          key={inv.id}
                          href={`#life=${data.id}&app=calendar&target=${inv.id}`}
                          style={{
                            background: '#ffffff',
                            borderRadius: '12px',
                            padding: '12px 14px',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            textDecoration: 'none',
                          }}
                        >
                          <div>
                            <div
                              style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}
                            >
                              {inv.title}
                            </div>
                            <div
                              style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}
                            >
                              {inv.at.slice(0, 10)} {inv.at.slice(11, 16)}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: inv.status === 'confirmed' ? '#ecfdf5' : '#fffbeb',
                              color: inv.status === 'confirmed' ? '#059669' : '#d97706',
                              fontWeight: 500,
                            }}
                          >
                            {inv.status === 'confirmed' ? '已约好 ›' : '待回复 ›'}
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '14px',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px',
                        color: '#64748b',
                      }}
                    >
                      暂无固定日程，去日历中可以查看每日月历和空闲节点。
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '12px',
                    padding: '14px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginBottom: '4px',
                    }}
                  >
                    🚩 当前剧情篇章
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>
                    第一幕 · 做出选择后的第一个清晨。你已收到身边人的来信与碰头邀约。建议在微信与日历中深入探索，逐渐推动关系演化。
                  </div>
                </div>
              </div>
            );
          }

          if (panel === 'director') {
            return (
              <div
                style={{
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                    borderRadius: '16px',
                    padding: '16px',
                    color: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#c7d2fe',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    🎬 人生导演工坊 · 动态剧情推进
                  </div>
                  <h3
                    style={{
                      margin: '0 0 6px 0',
                      fontSize: '17px',
                      fontWeight: 700,
                      color: '#f8fafc',
                    }}
                  >
                    {data.title}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#e0e7ff', lineHeight: 1.5 }}>
                    大模型根据你的真实档案推演生成的平行命运分支。你可以随时在这里让世界里的角色打破沉寂、主动向你发起互动。
                  </p>
                </div>

                {directorNotice && (
                  <div
                    style={{
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      color: '#065f46',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span>✨</span>
                    <span>{directorNotice}</span>
                  </div>
                )}

                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      <h4
                        style={{
                          margin: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#0f172a',
                        }}
                      >
                        ✨ 角色偶发主动联络
                      </h4>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        无需等待，立即让身边的角色主动给你发消息
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      background: '#07c160',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      marginBottom: '14px',
                      boxShadow: '0 2px 8px rgba(7, 193, 96, 0.25)',
                    }}
                    onClick={() => {
                      const res = triggerProactiveMessage();
                      if (res) {
                        setDirectorNotice(`角色「${res.actorName}」刚刚给你发送了一条微信！`);
                        setTimeout(() => setDirectorNotice(null), 4000);
                      }
                    }}
                  >
                    🎲 随机角色偶发主动来信
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#94a3b8',
                        letterSpacing: '0.05em',
                      }}
                    >
                      指定角色主动联络
                    </div>
                    {data.actors.map((actor) => (
                      <div
                        key={actor.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: '#f8fafc',
                          borderRadius: '10px',
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Avatar name={actor.name} />
                          <div>
                            <div
                              style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}
                            >
                              {actor.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {actor.relationship}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            fontSize: '12px',
                            color: '#0f172a',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            const res = triggerProactiveMessage(actor.id);
                            if (res) {
                              setDirectorNotice(
                                `「${res.actorName}」刚刚给你发来消息：“${res.text.slice(0, 14)}…”`,
                              );
                              setTimeout(() => setDirectorNotice(null), 4000);
                            }
                          }}
                        >
                          让TA发消息
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          return null;
        }}
      />
    </PhoneAppsProvider>
  );
}
