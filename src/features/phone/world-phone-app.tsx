'use client';
import { useWorldRecords } from './use-world-records.ts';
import { ProgressState } from '../../components/progress-state.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  worldDayKey,
  worldMonthKey,
  worldTimeLabel,
  worldWeekday,
  worldDateTimeLabel,
} from '../../modules/world/domain/display-time.ts';
import { ScenePanel } from './scenes/scene-panel.tsx';
import { appointmentScene } from './scenes/index-state.ts';
import { SceneClient } from './scenes/client.ts';
import { useGroups } from './groups/use-groups.ts';
import { isJoined, groupTarget } from './groups/state.ts';
import { projectMessageNotifications } from './notification-projection.ts';
import { AppViewport } from '../../components/app-viewport.tsx';
import { MessageReceiptClient } from '../api/message-receipt-client.ts';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { PhoneShell } from './phone-shell.tsx';
import { PhoneDesktop } from './phone-desktop.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import { Avatar } from './apps/common.tsx';
import type {
  PhoneActions,
  PhoneActionReceipt,
  PhoneAppsData,
  PhoneNote,
  PhoneRecordsState,
} from './apps/types.ts';
import { worldAppData } from './world-app-data.ts';
import { mergeNoteReceipt } from './world-receipts.ts';
import { dialogueText, formatChatTime } from './apps/helpers.ts';
import type { PhoneMessage } from './apps/types.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { playTapSound } from './audio-feedback.ts';
import { routeHash } from './navigation.ts';
import { ACTIVE_PHONE_CHECK_MS, autoAdvanceDue } from './auto-advance.ts';
import styles from './phone.module.css';
import {
  sendFailureStatus,
  restoreSendMessages,
  storeSendMessages,
  restoreSendCommands,
  type SendCommand,
} from './chat-send-state.ts';
export function WorldPhoneApp({ worldId }: { worldId: string }) {
  const [receiptClient] = useState(() => new MessageReceiptClient());
  const [client] = useState(() => new LifeClient()),
    [data, setData] = useState<WorldPhone | null>(null),
    [error, setError] = useState(''),
    [isBuilding, setIsBuilding] = useState(false),
    [localMessages, setLocalMessages] = useState<PhoneMessage[]>([]),
    [statusMessage, setStatusMessage] = useState('正在打开你的手机…'),
    [refreshing, setRefreshing] = useState(false);
  const acceptRecordsPhone = useCallback(
    (next: WorldPhone) => {
      if (next.id !== worldId) return;
      setData((current) =>
        current?.id === worldId && (current.version ?? 0) <= (next.version ?? 0) ? next : current,
      );
    },
    [worldId],
  );
  const { records, reloadRecords } = useWorldRecords(
    client,
    worldId,
    data?.id === worldId ? (data.version ?? 0) : undefined,
    acceptRecordsPhone,
  );
  const request = useRef(0),
    retryCommand = useRef<{ taskId: string; id: string } | null>(null);
  const directorCheck = useRef<() => void>(() => {});
  const directorInFlight = useRef(false);
  const directorAttemptedKeys = useRef(new Set<string>());
  const experienceBusy = useRef(false);
  const setExperienceBusy = useCallback(
    (busy: boolean) => {
      experienceBusy.current = busy;
      phoneReady.current.sending = busy || localMessages.some((m) => m.status === 'pending');
    },
    [localMessages],
  );
  const phoneReady = useRef({ hasData: false, refreshing: true, sending: false });
  phoneReady.current = {
    hasData: data?.id === worldId,
    refreshing,
    sending:
      experienceBusy.current || localMessages.some((message) => message.status === 'pending'),
  };

  const sendCommands = useRef<Record<string, SendCommand>>({});
  const [recoveryWorld, setRecoveryWorld] = useState<string>();
  useEffect(() => {
    let restored: PhoneMessage[] = [];
    try {
      const raw = sessionStorage.getItem(`pl-send:${worldId}`);
      restored = restoreSendMessages(raw, worldId);
      sendCommands.current = restoreSendCommands(raw, worldId);
    } catch {
      /* Storage may be disabled. */
    }
    setLocalMessages(restored);
    setRecoveryWorld(worldId);
  }, [worldId]);
  useEffect(() => {
    if (recoveryWorld !== worldId) return;
    try {
      if (localMessages.length)
        sessionStorage.setItem(
          `pl-send:${worldId}`,
          storeSendMessages(worldId, localMessages, sendCommands.current),
        );
      else sessionStorage.removeItem(`pl-send:${worldId}`);
    } catch {
      /* Current screen still preserves the original message. */
    }
  }, [worldId, recoveryWorld, localMessages]);

  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`pl_wallpaper_${worldId}`) || '/art/first-window.webp';
    }
    return '/art/first-window.webp';
  });

  const changeWallpaper = (url: string) => {
    setWallpaperUrl(url);
    try {
      localStorage.setItem(`pl_wallpaper_${worldId}`, url);
    } catch {
      // Ignore localStorage failure
    }
  };

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
    const unresolved = localMessages.find(
      (message) =>
        message.actorId === actorId && message.status === 'unknown' && message.id !== replacing,
    );
    if (unresolved) throw new ApiFailure('UNKNOWN', '上一条发送结果还未确认，请先核对。');
    const entry: PhoneMessage = {
      id: commandId,
      actorId,
      role: 'user',
      text,
      at: data?.time ?? new Date().toISOString(),
      status: 'pending',
    };
    function rememberCommand(expectedVersion: number) {
      sendCommands.current[commandId] = { worldId, commandId, actorId, text, expectedVersion };
      try {
        sessionStorage.setItem(
          `pl-send:${worldId}`,
          storeSendMessages(
            worldId,
            [...localMessages.filter((m) => m.id !== commandId && m.id !== replacing), entry],
            sendCommands.current,
          ),
        );
      } catch {
        /* Keep the same command in the current screen. */
      }
    }
    setLocalMessages((current) => [
      ...current.filter((message) => message.id !== commandId && message.id !== replacing),
      entry,
    ]);
    try {
      let currentVersion = data?.version ?? 0;
      rememberCommand(currentVersion);
      try {
        await client.sendWorldMessage(worldId, {
          commandId,
          actorId,
          text,
          expectedVersion: currentVersion,
        });
      } catch (err: unknown) {
        const errorMsg = String((err as { message?: string })?.message || '');
        const errorStatus = (err as { status?: number })?.status;
        // 如果是版本不同步引起的冲突，立刻重新同步服务端最新世界版本并再次递交
        if (
          (err as { code?: string })?.code === 'VERSION_CONFLICT' ||
          errorMsg.includes('VERSION_CONFLICT') ||
          errorMsg.includes('409') ||
          errorStatus === 409
        ) {
          const freshWorld = await client.world(worldId);
          setData(freshWorld);
          currentVersion = freshWorld.version ?? 0;
          rememberCommand(currentVersion);
          await client.sendWorldMessage(worldId, {
            commandId,
            actorId,
            text,
            expectedVersion: currentVersion,
          });
        } else {
          throw err;
        }
      }
      setLocalMessages((current) => current.filter((message) => message.id !== commandId));
    } catch (sendError) {
      setLocalMessages((current) =>
        current.map((message) =>
          message.id === commandId ? { ...message, status: sendFailureStatus(sendError) } : message,
        ),
      );
      if (sendFailureStatus(sendError) === 'unknown')
        throw new ApiFailure('UNKNOWN', '发送结果还不能确认，原消息已保留。请先核对。');
      throw sendError;
    }
    // The command is committed. A projection read failure must never turn it into a failed send.
    await load();
  }

  /**
   * A queued or running build may simply have lost its runner, so completing the
   * existing task is recovery, not a new attempt. A failed or unknown attempt is
   * never retried here: that would spend money without the user asking, and the
   * phone would re-spend on every reload. It needs an explicit retry instead.
   */
  async function resolveInterruptedBuild(
    currentRequest: number,
  ): Promise<'opened' | 'failed' | 'unknown' | 'none'> {
    const builds = await client.builds();
    const target = builds.find((build) => build.worldId === worldId);
    const task = target?.task;
    if (!target || target.ready || !task) return 'none';
    if (task.status === 'failed' || task.status === 'unknown') return task.status;
    if (!['queued', 'running'].includes(task.status)) return 'none';
    setIsBuilding(true);
    setStatusMessage('正在继续生成这段人生…');
    await client.task(task.id);
    const opened = await client.world(worldId);
    if (currentRequest === request.current) {
      setData(opened);
      setIsBuilding(false);
    }
    return 'opened';
  }

  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    setRefreshing(true);
    setError('');
    setIsBuilding(false);
    setStatusMessage('正在打开你的手机…');
    try {
      const next = await client.world(worldId);
      if (currentRequest === request.current)
        setData((current) =>
          current && (current.version ?? 0) > (next.version ?? 0) ? current : next,
        );
      return;
    } catch (e) {
      if (currentRequest !== request.current) return;
      try {
        const resolved = await resolveInterruptedBuild(currentRequest);
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
      setError(e instanceof ApiFailure ? e.message : '这次重新生成没有完成，可以再试一次。');
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
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onReturn);
    return () => document.removeEventListener('visibilitychange', onReturn);
  }, [load]);
  useEffect(() => {
    let active = true;
    async function checkForWorldNews() {
      if (
        !active ||
        document.visibilityState !== 'visible' ||
        !phoneReady.current.hasData ||
        phoneReady.current.refreshing ||
        phoneReady.current.sending ||
        directorInFlight.current
      )
        return;
      directorInFlight.current = true;
      let advancing = false;
      try {
        const clock = await client.readWorldClock(worldId);
        if (
          !active ||
          document.visibilityState !== 'visible' ||
          phoneReady.current.refreshing ||
          phoneReady.current.sending ||
          !autoAdvanceDue(clock, Date.now())
        )
          return;
        const attemptKey = `pl_director_resume_${worldId}_${clock.lastTickAt}`;
        if (directorAttemptedKeys.current.has(attemptKey)) return;
        try {
          if (sessionStorage.getItem(attemptKey)) return;
          sessionStorage.setItem(attemptKey, '1');
        } catch {
          // Private browsing can disable storage; the in-memory guard still
          // prevents a repeated paid attempt for this phone instance.
        }
        directorAttemptedKeys.current.add(attemptKey);
        advancing = true;
        const result = await client.advanceWorld(worldId, true);
        // Reading the committed world lets the phone's existing message notification
        // and banner show the real incoming reply while this screen stays open.
        if (active && result.played > 0) await load();
      } catch {
        if (active && advancing)
          setError('这次世界后续没有完成。已保存的记录仍在，可以继续查看手机中的来信和日程。');
      } finally {
        directorInFlight.current = false;
      }
    }
    directorCheck.current = () => void checkForWorldNews();
    directorCheck.current();
    const interval = window.setInterval(directorCheck.current, ACTIVE_PHONE_CHECK_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
      directorCheck.current = () => {};
    };
  }, [client, load, worldId]);
  useEffect(() => {
    if (data?.id === worldId && !refreshing) directorCheck.current();
  }, [data?.id, refreshing, worldId]);
  return (
    <div className="world-viewport">
      <AppViewport />
      {!data ? (
        <div className="world-loading">
          <a href="/possibilities">← 返回分支</a>
          {isBuilding ? (
            <ProgressState
              label={statusMessage}
              detail="设定和任务已经保存。可以返回分支，稍后查看当前进度。"
            />
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
            <ProgressState
              label={statusMessage}
              detail="正在读取已有记录，打开后从手机锁屏开始。"
            />
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
            if (!failed) throw new ApiFailure('NOT_FOUND', '原消息已不可访问，请刷新核对。');
            const original = sendCommands.current[messageId];
            if (!original)
              throw new ApiFailure(
                'UNKNOWN',
                '原发送资料不完整，暂时无法核对。内容仍保留，可返回其他页面。',
              );
            let result;
            try {
              const { worldId: originalWorldId, ...input } = original;
              result = await receiptClient.lookup(originalWorldId, input);
            } catch {
              throw new ApiFailure('UNKNOWN', '暂时无法核对，原消息仍待确认。请稍后再核对。');
            }
            if (result.status === 'committed') {
              setLocalMessages((current) => current.filter((message) => message.id !== messageId));
              delete sendCommands.current[messageId];
              await load();
              return { status: 'committed' };
            }
            if (failed.status === 'unknown' && commandId === messageId)
              throw new ApiFailure(
                'UNKNOWN',
                '尚未查到已提交结果，原消息仍待确认。可继续核对，或明确选择再次尝试。',
              );
            // A different command is permitted only by the explicit retry/confirmation button.
            await deliverMessage(failed.actorId, failed.text, commandId, messageId);
            return { status: 'committed' };
          }}
          onSaveNote={async (input) => {
            const receipt = await client.saveWorldNote(worldId, {
              commandId: input.commandId,
              /* 开场便签用它自己的作用域 id，其余由服务端分配 */
              ...(input.id ? { id: input.id } : {}),
              title: input.title,
              text: input.text,
              expectedVersion: input.expectedVersion ?? 0,
            });
            request.current++;
            setRefreshing(false);
            setData((current) => mergeNoteReceipt(current, receipt));
            void load();
            return { status: receipt.status };
          }}
          onExperienceBusy={setExperienceBusy}
          localMessages={localMessages}
          records={records}
          reloadRecords={reloadRecords}
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
  onExperienceBusy,
  preview = false,
  onReload,
  records,
  reloadRecords,
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
  onExperienceBusy?: (busy: boolean) => void;
  preview?: boolean;
  onReload?: () => Promise<void>;
  records?: PhoneRecordsState;
  reloadRecords?: () => Promise<void>;
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
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`pl_read:${data.id}`) ?? '[]');
      return new Set(
        Array.isArray(saved)
          ? saved.filter((id): id is string => typeof id === 'string').slice(-2000)
          : [],
      );
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`pl_read:${data.id}`, JSON.stringify([...viewed].slice(-2000)));
    } catch {
      /* Read receipts remain usable in this session. */
    }
  }, [data.id, viewed]);
  const client = useMemo(() => new LifeClient(), []);
  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`pl_wallpaper_${data.id}`) || '/art/first-window.webp';
    }
    return '/art/first-window.webp';
  });

  const changeWallpaper = (url: string) => {
    setWallpaperUrl(url);
    try {
      localStorage.setItem(`pl_wallpaper_${data.id}`, url);
    } catch {}
  };

  // The phone displays the persisted story time; browser uptime must not advance the world.
  const currentClock = useMemo(() => new Date(data.time), [data.time]);

  const currentReferenceTime = currentClock.toISOString();
  const timeLabel = worldTimeLabel(data.time);
  const localDay = worldDayKey(data.time);
  const dateLabel = `${Number(localDay.slice(5, 7))}月${Number(localDay.slice(8, 10))}日 ${worldWeekday(data.time)}`;

  // Legacy local notes remain available in local previews; live worlds use server receipts.
  const [notes, setNotes] = useState<readonly PhoneNote[]>(() => {
    try {
      const storageKey = `pl_notes:${data.id}`;
      const saved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback below
    }
    return (data.notes ?? []).map((note, index) => ({
      id: note.id || `${data.id}:opening-note:${index}`,
      title: note.title,
      text: note.text,
      version: note.version ?? 0,
      updatedAt: note.updatedAt || data.time,
    }));
  });

  const handleSaveNote: NonNullable<PhoneActions['saveNote']> = useCallback(
    async (input) => {
      const resolvedTitle =
        input.title.trim() || input.text.trim().split('\n')[0]?.slice(0, 20) || '无标题便签';
      if (onSaveNote) return onSaveNote({ ...input, title: resolvedTitle });
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
                    title: resolvedTitle,
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
                title: resolvedTitle,
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
              title: resolvedTitle,
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

      return { status: 'committed' };
    },
    [data.id, onSaveNote],
  );

  const handleDeleteNote: NonNullable<PhoneActions['deleteNote']> = useCallback(
    async (id: string) => {
      setNotes((current) => {
        const next = current.filter((n) => n.id !== id);
        try {
          localStorage.setItem(`pl_notes:${data.id}`, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      return { status: 'committed' };
    },
    [data.id],
  );

  // 清除旧版本在客户端缓存中的伪造主动消息（防止历史遗留的假消息污染最新消息列表）
  useEffect(() => {
    try {
      localStorage.removeItem(`pl_proactive:${data.id}`);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('pl_proactive:')) {
          localStorage.removeItem(k);
        }
      }
    } catch {
      // Ignore
    }
  }, [data.id]);

  const [sceneWaiting, setSceneWaiting] = useState(false);
  const sceneClient = useMemo(() => new SceneClient(), [data.id]);
  const groups = useGroups(data.id, !preview, onReload);
  useEffect(() => {
    if (!sceneWaiting || preview) return;
    const timer = setInterval(() => {
      void sceneClient
        .read(data.id)
        .then((d) => {
          setSceneWaiting(Boolean(d.task && ['queued', 'running'].includes(d.task.status)));
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [sceneWaiting, sceneClient, data.id, preview]);
  useEffect(() => {
    onExperienceBusy?.(sceneWaiting || groups.pending);
  }, [sceneWaiting, groups.pending, onExperienceBusy]);
  useEffect(() => {
    void groups.refresh();
  }, [data.version, groups.refresh]);
  const enterCommand = useRef<
    { appointmentId: string; commandId: string; version: number } | undefined
  >(undefined);
  const [directorNotice, setDirectorNotice] = useState<string | null>(null);

  const [callingActor, setCallingActor] = useState<WorldPhone['actors'][number] | null>(null);

  // Display only persisted world messages and invitations, without fabricating timestamps.
  const mergedData = useMemo(
    () => ({
      ...data,
      messages: data.messages.map((m) => ({ ...m, text: dialogueText(m.text, m.role) })),
    }),
    [data],
  );

  const basePhoneData = worldAppData(mergedData, viewed, localMessages);
  const phoneData: PhoneAppsData = useMemo(
    () => ({
      ...basePhoneData,
      notes: onSaveNote ? basePhoneData.notes : notes,
      referenceTime: currentReferenceTime,
    }),
    [basePhoneData, notes, currentReferenceTime, onSaveNote],
  );

  return (
    <PhoneAppsProvider
      worldId={data.id}
      groups={groups}
      data={phoneData}
      records={records}
      reloadRecords={reloadRecords}
      loading={loading}
      loadError={loadError}
      onReload={onReload}
      actions={{
        enterScene: preview
          ? undefined
          : async (appointmentId) => {
              setSceneWaiting(true);
              try {
                if (enterCommand.current?.appointmentId !== appointmentId)
                  enterCommand.current = {
                    appointmentId,
                    commandId: crypto.randomUUID(),
                    version: data.version ?? 0,
                  };
                const history = await sceneClient.history(data.id);
                const invitation = phoneData.invitations.find((a) => a.id === appointmentId);
                const prior = invitation ? appointmentScene(history, invitation) : undefined;
                if (prior?.status === 'ended') {
                  window.location.hash = routeHash(data.id, {
                    app: 'scenes',
                    panel: 'scene',
                    target: prior.id,
                  });
                  return { status: 'committed' };
                }
                const existing = await sceneClient.read(data.id);
                let receipt;
                if (
                  existing.scene &&
                  existing.scene.appointmentId === appointmentId &&
                  existing.scene.status !== 'ended'
                ) {
                  receipt = await sceneClient.navigate(data.id, existing.scene.id, {
                    commandId: crypto.randomUUID(),
                    expectedVersion: existing.worldVersion,
                    view: 'scene',
                  });
                } else {
                  receipt = await sceneClient.enter(data.id, {
                    commandId: enterCommand.current.commandId,
                    expectedVersion: enterCommand.current.version,
                    appointmentId,
                  });
                }
                window.location.hash = routeHash(data.id, {
                  app: null,
                  panel: 'scene',
                  target: receipt.sceneId,
                });
                await onReload?.();
                if (receipt.task?.status === 'queued') {
                  await sceneClient.execute(receipt.task.id);
                  await onReload?.();
                }
                return { status: 'committed' };
              } catch (e) {
                if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') {
                  enterCommand.current = undefined;
                  await Promise.allSettled([onReload?.()]);
                }
                throw e;
              } finally {
                setSceneWaiting(false);
              }
            },
        changeInvitation: preview ? undefined : onChangeInvitation,
        sendMessage: preview ? undefined : onSendMessage,
        retryMessage: preview ? undefined : onRetryMessage,
        uploadPhoto: preview ? undefined : onUploadPhoto,
        setWallpaper: changeWallpaper,
        saveNote: handleSaveNote,
        // No server delete command yet; never pretend a local hide is a deletion.
        deleteNote: onSaveNote ? undefined : handleDeleteNote,
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
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        wallpaperUrl={wallpaperUrl}
        notice={preview ? <span>开发样板 · 合成数据 · 未调用模型</span> : undefined}
        referenceTime={currentReferenceTime}
        onOpenNotification={(notification) => {
          window.location.hash = routeHash(data.id, {
            app: notification.app,
            target:
              notification.conversationKind === 'group' && notification.target
                ? groupTarget(notification.target)
                : notification.target,
          });
        }}
        notifications={[
          ...projectMessageNotifications(mergedData.messages, data.actors, viewed, (at) =>
            formatChatTime(at, currentReferenceTime),
          ),
          ...Object.values(groups.details)
            .filter((d) => isJoined(d.group))
            .flatMap((d) =>
              d.messages
                .filter((m) => m.sender.kind === 'actor' && m.sourceVersion > d.lastReadVersion)
                .map((m) => ({
                  id: m.id,
                  title: d.group.title,
                  summary: m.text,
                  app: 'messages' as const,
                  conversationKind: 'group' as const,
                  target: d.group.id,
                  at: d.messageTimes[m.id]!.storyAt,
                  timeLabel: formatChatTime(d.messageTimes[m.id]!.storyAt, currentReferenceTime),
                })),
            ),
          ...(data.invitations ?? [])
            .filter(
              (inv) =>
                inv.status === 'proposed' && Date.parse(inv.at) > Date.parse(currentReferenceTime),
            )
            .map((inv) => ({
              id: `notif-inv-${inv.id}`,
              title: inv.title,
              summary: `${worldDateTimeLabel(inv.at)} · 邀请 · 待回复`,
              app: 'calendar' as const,
              target: inv.id,
              actionableUntil: inv.at,
              timeLabel: '待回复',
            })),
        ]}
        renderHome={({ open, openPanel }) => (
          <PhoneDesktop
            title={data.title}
            dateLabel={dateLabel}
            timeLabel={timeLabel}
            data={phoneData}
            open={open}
            openPanel={openPanel}
          />
        )}
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

                {/* 人物核心属性卡片（严格对齐 Screen 01） */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '20px',
                        boxShadow: '0 4px 12px rgba(2,132,199,0.3)',
                      }}
                    >
                      我
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h3
                          style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}
                        >
                          我
                        </h3>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>分支主角</span>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#0284c7',
                          fontWeight: 600,
                          marginTop: '2px',
                        }}
                      >
                        {data.title || '平行人生探索者'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: '#475569',
                      lineHeight: 1.5,
                      marginBottom: '12px',
                    }}
                  >
                    📍 <strong>生活坐标：</strong>
                    {data.setting || '当前人生所处时空与场景'}
                  </div>

                  {/* 随身物品与核心资产 */}
                  <div>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        marginBottom: '8px',
                      }}
                    >
                      🎒 随身物品与资产
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>🔑</span> 钥匙与门禁
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📱</span> 智能手机与通讯录
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>💳</span> 银行卡与身份证件
                      </div>
                      <div
                        style={{
                          background: '#f1f5f9',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📓</span> 随身笔记与日程表
                      </div>
                    </div>
                  </div>
                </div>

                {/* 大事件里程碑时间轴 */}
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '16px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#0f172a',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>⏳</span> 人生里程碑时间轴
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      position: 'relative',
                      paddingLeft: '16px',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: '6px',
                        top: '6px',
                        bottom: '6px',
                        width: '2px',
                        background: '#e2e8f0',
                      }}
                    />

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#0284c7' }}>
                        {data.time
                          ? worldMonthKey(data.time).replace('-', '年 ') + '月'
                          : '分支起点'}{' '}
                        · 抉择
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        开启平行人生分支
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        {data.title
                          ? `进入分支【${data.title}】，开启全新的命运走向。`
                          : '做出了人生重要抉择，开启全新人生篇章。'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a' }}>
                        ● 此刻 · {data.time ? worldDayKey(data.time) : '进行中'}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          marginTop: '2px',
                        }}
                      >
                        当前分支生活展开
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          lineHeight: 1.4,
                        }}
                      >
                        {data.setting ||
                          '在当前人际关系与日常互动中探索，每一次选择都在塑造未来的轨迹。'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 角色人脉网络（严格对齐 Screen 02） */}
                <div>
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    👥 核心人脉网络（共 {data.actors.length} 位）
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
                          boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
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
                              <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
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
                          <span style={{ fontSize: '11px', color: '#16a34a' }}>人物资料</span>
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
                          <button
                            type="button"
                            onClick={() => setCallingActor(actor)}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '8px',
                              borderRadius: '8px',
                              background: '#eff6ff',
                              color: '#2563eb',
                              fontSize: '12px',
                              fontWeight: 500,
                              border: '1px solid #bfdbfe',
                              cursor: 'pointer',
                            }}
                          >
                            📞 电话呼叫
                          </button>
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

          if (panel === 'scene')
            return (
              <ScenePanel
                key={data.id}
                worldId={data.id}
                contacts={phoneData.contacts}
                onWorldChanged={onReload}
                onBusy={setSceneWaiting}
              />
            );

          return null;
        }}
      />
      {callingActor && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(20px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '64px 24px 48px',
            color: '#ffffff',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '88px',
                height: '88px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #059669, #0d9488)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '34px',
                fontWeight: 700,
                boxShadow: '0 8px 24px rgba(5,150,105,0.4)',
                marginBottom: '16px',
              }}
            >
              {callingActor.name.slice(0, 1)}
            </div>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>{callingActor.name}</h2>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
              语音通话尚未接通，可以先发消息
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#6ee7b7',
                marginTop: '20px',
                background: 'rgba(5,150,105,0.25)',
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid rgba(110,231,183,0.3)',
                lineHeight: 1.5,
              }}
            >
              可以通过文字消息继续交流
            </div>
          </div>

          <div
            style={{
              width: '100%',
              maxWidth: '320px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <a
              href={`#life=${data.id}&app=messages&target=${callingActor.id}`}
              onClick={() => setCallingActor(null)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: '#10b981',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '15px',
                textAlign: 'center',
                textDecoration: 'none',
                boxShadow: '0 4px 14px rgba(16,185,129,0.35)',
                boxSizing: 'border-box',
              }}
            >
              💬 转为微信留言
            </a>
            <button
              type="button"
              onClick={() => setCallingActor(null)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '14px',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.4)',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              ✕ 挂断
            </button>
          </div>
        </div>
      )}
    </PhoneAppsProvider>
  );
}
