'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppViewport } from '../../components/app-viewport.tsx';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell } from './phone-shell.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import type { PhoneActions, PhoneActionReceipt, PhoneAppsData, PhoneNote } from './apps/types.ts';
import { worldAppData } from './world-app-data.ts';
import { formatChatTime } from './apps/helpers.ts';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState(''),
    [isBuilding, setIsBuilding] = useState(false),
    [statusMessage, setStatusMessage] = useState('正在打开你的手机…'),
    [refreshing, setRefreshing] = useState(false);
  const request = useRef(0),
    retryCommand = useRef<{ taskId: string; id: string } | null>(null);

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
            // 即刻将用户消息先上屏展示
            const optimistic = {
              id: commandId,
              actorId,
              role: 'user' as const,
              text,
              at: new Date().toISOString(),
            };
            setData((current) =>
              current
                ? {
                    ...current,
                    messages: [...current.messages, optimistic],
                  }
                : current,
            );
            const receipt = await client.sendWorldMessage(worldId, {
              commandId,
              actorId,
              text,
              expectedVersion: data.version ?? 0,
            });
            await load();
            return { status: receipt.status };
          }}
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
  onUploadPhoto,
  onSaveNote,
  loading = false,
  loadError,
}: {
  data: WorldPhone;
  preview?: boolean;
  onReload?: () => Promise<void>;
  onChangeInvitation?: PhoneActions['changeInvitation'];
  onSendMessage?: PhoneActions['sendMessage'];
  onUploadPhoto?: PhoneActions['uploadPhoto'];
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

  const basePhoneData = worldAppData(data, viewed);
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
        uploadPhoto: preview ? undefined : onUploadPhoto,
        saveNote: handleSaveNote,
        markRead: async (actorId) => {
          setViewed(
            (current) =>
              new Set([
                ...current,
                ...data.messages.filter((m) => m.actorId === actorId).map((m) => m.id),
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
        // Product worlds stay immersive. Only the explicit development preview
        // exposes its synthetic-data label; production lock screens contain
        // only the time, wallpaper and real notifications.
        notice={preview ? <span>开发样板 · 合成数据 · 未调用模型</span> : undefined}
        notifications={[
          ...data.messages
            .filter((m) => m.role !== 'user')
            .slice(-3)
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
            : data.actors.length > 0
              ? [
                  {
                    id: `notif-cal-${data.id}`,
                    title: '日历提醒 · 阶段备忘',
                    summary: `与 ${data.actors[0]?.name}（${data.actors[0]?.relationship}）的讨论安排`,
                    app: 'calendar' as const,
                    target: undefined,
                    timeLabel: '待处理',
                  },
                ]
              : []),
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
        renderApp={(context) => <PhoneAppView {...context} />}
        renderPanel={(panel) =>
          panel === 'timeline' ? (
            <div className="world-notes">
              <h3>这个世界里的你</h3>
              <p>{data.identity}</p>
              <p>{data.setting}</p>
              <a className="button secondary" href="/possibilities">
                返回分支，选择其他人生
              </a>
            </div>
          ) : panel === 'schedule' ? (
            <p>故事停留在开场，时间推进与暂停控制尚未接入。</p>
          ) : panel === 'director' ? (
            <p>导演调整尚未开放，你可以先查看这段人生的身份与开场。</p>
          ) : null
        }
      />
    </PhoneAppsProvider>
  );
}
