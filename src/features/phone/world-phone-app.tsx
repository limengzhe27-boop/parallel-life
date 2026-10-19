'use client';
import { useAdvanceRecovery } from './use-advance-recovery.ts';
import { reconcileRestoredSendReceipts } from './restored-send-receipts.ts';
import {
  applyStreamSegmentToWorld,
  committedLocalSend,
  projectCommittedTurnReceipt,
  unprojectedLocalSends,
} from './send-projection.ts';
import type { WorldMessageReceipt } from '../../contracts/world-interaction.ts';
import { useWorldTime } from './use-world-time.ts';
import { PHONE_RUNTIME_POLICY } from './time-experience-policy.ts';
import type { PublicOpeningStatus } from '../../contracts/publication-opening.ts';
import { AppointmentWaitRecovery } from './appointment-wait-recovery.tsx';
import {
  AppointmentWaitRequestSchema,
  type AppointmentWaitRequest,
} from '../../contracts/appointment-wait.ts';
import { useWorldMap } from './map/use-map.ts';
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
import { SceneWorldSync } from './scenes/world-sync.ts';
import { useGroups } from './groups/use-groups.ts';
import { isJoined, groupTarget } from './groups/state.ts';
import { projectMessageNotifications } from './notification-projection.ts';
import { isIncomingRuntimeMessage } from './message-notification-policy.ts';
import { AppViewport } from '../../components/app-viewport.tsx';
import { MessageReceiptClient } from '../api/message-receipt-client.ts';
import { LifeClient, ApiFailure } from '../api/client.ts';
import { Button, Notice } from '../../components/ui.tsx';
import type { WorldPhone } from '../../contracts/world-build.ts';
import { CharacterPhoneShell as PhoneShell } from './character-phone-shell.tsx';
import { wechatCharacterTarget } from './wechat-character-target.ts';
import { PhoneDesktop } from './phone-desktop.tsx';
import { PhoneAppsProvider, PhoneAppView } from './apps/index.tsx';
import { recordAttribution } from './apps/notes-records.tsx';
import { PersonCard } from './apps/person-card.tsx';
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
import type { PhoneMessage, PhonePhoto } from './apps/types.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { playTapSound } from './audio-feedback.ts';
import { routeHash } from './navigation.ts';
import { resolveDefaultWallpaper } from './wallpaper.ts';
import styles from './phone.module.css';
import {
  sendFailureStatus,
  restoreSendMessages,
  storeSendMessages,
  restoreSendCommands,
  type SendCommand,
} from './chat-send-state.ts';
export function WorldPhoneApp({
  worldId,
  transport,
  automatic = true,
  wechatActorKey,
  mediaUrlFor,
  runtimeAssetUrlFor,
}: {
  worldId: string;
  transport?: typeof fetch;
  automatic?: boolean;
  wechatActorKey?: string;
  mediaUrlFor?: (worldId: string, assetId: string) => string;
  runtimeAssetUrlFor?: (worldId: string, assetId: string, revision: number) => string;
}) {
  const [receiptClient] = useState(() => new MessageReceiptClient(transport));
  const [client] = useState(() => new LifeClient(transport)),
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
  const openingEpoch = useRef({ worldId, token: {} });
  if (openingEpoch.current.worldId !== worldId) {
    openingEpoch.current = { worldId, token: {} };
    directorInFlight.current = false;
  }
  const observedOpening = useRef<{ worldId: string; delivered: number } | null>(null);
  const openingFinished = useRef<string | null>(null);
  const nativeOpening = useRef<string | null>(null);
  const lastBackgroundCheck = useRef(0);
  const [opening, setOpening] = useState<PublicOpeningStatus | null>(null);
  const [openingWorking, setOpeningWorking] = useState(false);
  const directorAttemptedKeys = useRef(new Set<string>());
  const experienceBusy = useRef(false);
  const setExperienceBusy = useCallback(
    (busy: boolean) => {
      experienceBusy.current = busy;
      phoneReady.current.sending = busy || localMessages.some((m) => m.status === 'pending');
    },
    [localMessages],
  );
  const phoneReady = useRef({ hasData: false, refreshing: true, sending: false, version: 0 });
  phoneReady.current = {
    hasData: data?.id === worldId,
    version: data?.id === worldId ? (data.version ?? 0) : 0,
    refreshing,
    sending:
      experienceBusy.current || localMessages.some((message) => message.status === 'pending'),
  };

  const [screenLock, setScreenLock] = useState({ worldId, locked: !wechatActorKey });
  const screenLocked = screenLock.worldId === worldId ? screenLock.locked : !wechatActorKey;
  const onPhoneLockChange = useCallback(
    (locked: boolean) =>
      setScreenLock((old) =>
        old.worldId === worldId && old.locked === locked ? old : { worldId, locked },
      ),
    [worldId],
  );
  const liveTime = useWorldTime(
    client,
    worldId,
    automatic && data?.id === worldId,
    experienceBusy.current || localMessages.some((message) => message.status === 'pending'),
    screenLocked,
  );
  const liveTimeRef = useRef(liveTime);
  liveTimeRef.current = liveTime;
  useEffect(() => {
    if (automatic && data?.id === worldId)
      liveTimeRef.current.observeIncoming(
        data.messages.filter(isIncomingRuntimeMessage).map((message) => message.id),
      );
  }, [automatic, data, worldId]);
  const sendCommands = useRef<Record<string, SendCommand>>({});
  const committedSends = useRef<Record<string, WorldMessageReceipt>>({});
  const confirmedSendVersion = useRef({ worldId, version: 0 });
  const [recoveryWorld, setRecoveryWorld] = useState<string>();
  const restoredSends = useRef<PhoneMessage[]>([]);
  useEffect(() => {
    let restored: PhoneMessage[] = [];
    try {
      const raw = sessionStorage.getItem(`pl-send:${worldId}`);
      restored = restoreSendMessages(raw, worldId);
      sendCommands.current = restoreSendCommands(raw, worldId);
    } catch {
      /* Storage may be disabled. */
    }
    restoredSends.current = restored;
    committedSends.current = {};
    confirmedSendVersion.current = { worldId, version: 0 };
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
      const custom = localStorage.getItem(`pl_wallpaper_${worldId}`);
      if (custom) return custom;
    }
    return data?.publicationWallpaperUrl ?? resolveDefaultWallpaper(data?.title, data?.identity);
  });

  useEffect(() => {
    if (data?.title) {
      try {
        const custom = localStorage.getItem(`pl_wallpaper_${worldId}`);
        if (!custom) {
          setWallpaperUrl(
            data.publicationWallpaperUrl ?? resolveDefaultWallpaper(data.title, data.identity),
          );
        }
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }, [worldId, data?.title, data?.identity, data?.publicationWallpaperUrl]);

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
    photo?: PhonePhoto,
    updateOp?: (patch: { canInterrupt?: boolean }) => void,
  ) {
    if (automatic) await liveTimeRef.current.startConversation();
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
      ...(photo ? { photo } : {}),
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
      const currentVersion = Math.max(
        data?.version ?? 0,
        confirmedSendVersion.current.worldId === worldId ? confirmedSendVersion.current.version : 0,
      );
      rememberCommand(currentVersion);
      let firstSegmentReceived = false;
      const tSend = performance.now();
      // One submission owns one immutable identity. A 409 may be BUSY, a prior receipt,
      // or a late paid result, not permission to mutate and resubmit that command.
      const receipt = await client.sendWorldMessage(
        worldId,
        {
          commandId,
          actorId,
          text,
          expectedVersion: currentVersion,
        },
        {
          onSegment: (segment) => {
            if (!firstSegmentReceived) {
              firstSegmentReceived = true;
              const firstMeaningfulReplyMs = Math.round(performance.now() - tSend);
              void firstMeaningfulReplyMs;
            }
            confirmedSendVersion.current = {
              worldId,
              version: Math.max(confirmedSendVersion.current.version, segment.version),
            };
            setLocalMessages((current) =>
              current.map((message) =>
                message.id === commandId ? { ...message, status: 'sent' } : message,
              ),
            );
            updateOp?.({ canInterrupt: true });
            setData((current) =>
              current?.id === worldId ? applyStreamSegmentToWorld(current, segment) : current,
            );
          },
        },
      );
      const fullTurnMs = Math.round(performance.now() - tSend);
      void fullTurnMs;
      const confirmed = committedLocalSend(worldId, entry, receipt);
      committedSends.current[commandId] = receipt;
      confirmedSendVersion.current = {
        worldId,
        version: Math.max(currentVersion, receipt.version),
      };
      delete sendCommands.current[commandId];
      setLocalMessages((current) =>
        current.map((message) => (message.id === commandId ? confirmed : message)),
      );
      if (receipt.messages?.length) {
        setData((current) =>
          current?.id === worldId ? projectCommittedTurnReceipt(current, receipt) : current,
        );
      }
    } catch (sendError) {
      if ((sendError as { code?: string })?.code === 'VERSION_CONFLICT') await load();
      setLocalMessages((current) =>
        current.map((message) =>
          message.id === commandId ? { ...message, status: sendFailureStatus(sendError) } : message,
        ),
      );
      if (sendFailureStatus(sendError) === 'unknown') {
        restoredSends.current = [
          ...restoredSends.current.filter((m) => m.id !== commandId),
          { ...entry, status: 'unknown' },
        ];
        throw new ApiFailure('UNKNOWN', '正在核对发送结果，原消息已保留。');
      }
      throw sendError;
    }
    // Sending ends at the durable receipt. Read projections independently, never
    // invoking interrupted-build recovery or extending this send's busy state.
    const projectionEpoch = openingEpoch.current.token;
    void client
      .world(worldId)
      .then((next) => {
        if (openingEpoch.current.token !== projectionEpoch) return;
        setData((current) =>
          current?.id === worldId && (current.version ?? 0) <= (next.version ?? 0) ? next : current,
        );
      })
      .catch(() => {
        // A failed projection read leaves the confirmed user bubble visible.
        // The ordinary read-only phone poll can catch up without resending anything.
      });
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
    setIsBuilding(false);
    setStatusMessage('正在打开你的手机…');
    try {
      const next = await client.world(worldId);
      if (currentRequest === request.current) {
        setData((current) =>
          current && (current.version ?? 0) > (next.version ?? 0) ? current : next,
        );
        setError('');
      }
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

  const advanceRecovery = useAdvanceRecovery(client, worldId, load);
  const advanceRecoveryRef = useRef(advanceRecovery);
  advanceRecoveryRef.current = advanceRecovery;
  useEffect(() => {
    if (recoveryWorld !== worldId) return;
    let active = true;
    let reading = false;
    const checks = new Map<string, { count: number; nextAt: number }>();
    const reconcile = async () => {
      if (!active || reading || document.visibilityState !== 'visible') return;
      reading = true;
      try {
        const saved = restoredSends.current.filter((m) => {
          const check = checks.get(m.id);
          return !check || check.nextAt <= Date.now();
        });
        for (const m of saved) {
          const count = Math.min(12, (checks.get(m.id)?.count ?? 0) + 1);
          checks.set(m.id, {
            count,
            nextAt: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(count - 1, 4)),
          });
        }
        const updates = await reconcileRestoredSendReceipts(
          worldId,
          saved,
          sendCommands.current,
          (id, input) => receiptClient.lookup(id, input),
          (id, input) => receiptClient.recover(id, input),
        );
        if (!active) return;
        const originals = new Map(saved.map((m) => [m.id, m]));
        setLocalMessages((current) =>
          current.flatMap((m) => {
            const original = originals.get(m.id);
            if (
              !original ||
              original.actorId !== m.actorId ||
              original.text !== m.text ||
              !['unknown', 'pending'].includes(m.status ?? '')
            )
              return [m];
            if (updates[m.id] === 'committed') return [];
            return [updates[m.id] === 'failed' ? { ...m, status: 'failed' as const } : m];
          }),
        );
        restoredSends.current = restoredSends.current.filter((m) => !updates[m.id]);
        for (const [id, status] of Object.entries(updates))
          if (status === 'committed') delete sendCommands.current[id];
        if (Object.values(updates).includes('committed')) await load();
      } finally {
        reading = false;
      }
    };
    void reconcile();
    const onReturn = () => {
      void reconcile();
    };
    document.addEventListener('visibilitychange', onReturn);
    const timer = window.setInterval(() => {
      void reconcile();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [worldId, recoveryWorld, receiptClient, load]);

  useEffect(() => {
    if (data?.id !== worldId) return;
    setLocalMessages((current) => {
      const remaining = unprojectedLocalSends(current, data.messages, committedSends.current);
      return remaining.length === current.length ? current : remaining;
    });
  }, [data, worldId]);

  // Scene polling must refresh the saved phone, without retrying a build or action.
  const reloadSceneWorld = useCallback(
    async (minimumVersion: number) => {
      const next = await client.world(worldId);
      if (next.id !== worldId || (next.version ?? 0) < minimumVersion)
        throw new Error('手机记录还在同步，可以重新读取。');
      setData((current) =>
        current?.id === worldId && (current.version ?? 0) <= (next.version ?? 0) ? next : current,
      );
    },
    [client, worldId],
  );

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
  // Other workers/tabs can commit messages even when this page's advance is quiet.
  // Read projections independently from narrative/model scheduling, without blocking chat.
  const hasPendingMedia = data?.messages.some((message) => message.mediaStatus === 'pending');
  const liveWorldReady = data?.id === worldId;
  useEffect(() => {
    if (!liveWorldReady || (!automatic && !hasPendingMedia)) return;
    let active = true;
    let reading = false;
    const timer = window.setInterval(
      async () => {
        if (
          !active ||
          reading ||
          document.visibilityState !== 'visible' ||
          phoneReady.current.sending
        )
          return;
        reading = true;
        try {
          const next = await client.world(worldId);
          if (active)
            setData((current) =>
              current && (current.version ?? 0) > (next.version ?? 0) ? current : next,
            );
        } catch {
          // A transient read failure never changes a committed message into a failed send.
        } finally {
          reading = false;
        }
      },
      hasPendingMedia ? 3000 : 10000,
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [automatic, hasPendingMedia, liveWorldReady, client, worldId]);
  useEffect(() => {
    let hidden = document.visibilityState !== 'visible';
    const onReturn = () => {
      if (document.visibilityState !== 'visible') {
        hidden = true;
        return;
      }
      if (!hidden) return;
      hidden = false;
      lastBackgroundCheck.current = 0;
      // Present already committed changes first, then inspect current work without an idle delay.
      void load().finally(() => directorCheck.current());
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hidden = true;
        onReturn();
      }
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    const epoch = openingEpoch.current.token;
    const isCurrent = () => active && openingEpoch.current.token === epoch;
    const canAdvance = () =>
      isCurrent() &&
      document.visibilityState === 'visible' &&
      phoneReady.current.hasData &&
      !phoneReady.current.refreshing &&
      !phoneReady.current.sending;
    setOpening(null);
    setOpeningWorking(false);
    const claimCheck = (key: string) => {
      if (directorAttemptedKeys.current.has(key)) return false;
      const storageKey = `pl-phone-check-keys-v1:${worldId}`;
      try {
        const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
        const keys: string[] = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
        if (keys.includes(key)) return false;
        localStorage.setItem(storageKey, JSON.stringify([...keys, key].slice(-64)));
      } catch {
        /* The server's original paid-source fence remains authoritative. */
      }
      directorAttemptedKeys.current.add(key);
      if (directorAttemptedKeys.current.size > 256)
        directorAttemptedKeys.current.delete(directorAttemptedKeys.current.values().next().value!);
      return true;
    };
    const releaseCheck = (key: string) => {
      directorAttemptedKeys.current.delete(key);
      try {
        const storageKey = `pl-phone-check-keys-v1:${worldId}`;
        const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
        if (Array.isArray(saved))
          localStorage.setItem(
            storageKey,
            JSON.stringify(saved.filter((v) => typeof v === 'string' && v !== key)),
          );
      } catch {
        /* Server leases and original source receipts remain authoritative. */
      }
    };
    async function checkForWorldNews() {
      if (
        !automatic ||
        liveTimeRef.current.blocked ||
        !active ||
        document.visibilityState !== 'visible' ||
        !phoneReady.current.hasData ||
        phoneReady.current.refreshing ||
        phoneReady.current.sending ||
        directorInFlight.current
      )
        return;
      if (
        openingFinished.current === worldId &&
        Date.now() - lastBackgroundCheck.current < PHONE_RUNTIME_POLICY.checkEveryMs
      )
        return;
      lastBackgroundCheck.current = Date.now();
      directorInFlight.current = true;
      let advancing = false;
      try {
        await advanceRecoveryRef.current.reconcile();
        const clock = await client.readWorldClock(worldId);
        if (
          !active ||
          document.visibilityState !== 'visible' ||
          phoneReady.current.refreshing ||
          phoneReady.current.sending
        )
          return;
        if (openingFinished.current !== worldId || nativeOpening.current === worldId) {
          const current = await client.readWorldOpening(worldId);
          if (!isCurrent()) return;
          setOpening(current);
          const previouslyObserved = observedOpening.current;
          observedOpening.current = { worldId, delivered: current.delivered };
          if (
            current.delivered > 0 &&
            (previouslyObserved?.worldId !== worldId ||
              current.delivered > previouslyObserved.delivered)
          ) {
            await load();
          }
          if (!canAdvance()) return;
          if (current.runtime === 'agents' || ['none', 'complete'].includes(current.phase)) {
            openingFinished.current = worldId;
            if (current.runtime === 'agents') {
              nativeOpening.current = worldId;
              const key =
                current.continuation?.status === 'ready' && liveTimeRef.current.entryKey
                  ? `native-work:${worldId}:${current.continuation.key}`
                  : null;
              if (
                key &&
                !clock.paused &&
                canAdvance() &&
                !liveTimeRef.current.blocked &&
                claimCheck(key)
              ) {
                // Transport suppression only. The existing server rechecks original authority,
                // paid/unknown identities, focus and activity before any model or execution.
                liveTimeRef.current.markChecked();
                advancing = true;
                const result = await advanceRecoveryRef.current.advance(key);
                if (!result) return;
                if (result.deferred === 'scheduler_busy') {
                  releaseCheck(key);
                  return;
                }
                if (isCurrent() && (result.changed || result.played > 0)) await load();
                return;
              }
            }
          } else {
            if (
              clock.paused ||
              !['unplanned', 'ready'].includes(current.phase) ||
              current.retryable
            )
              return;
            setOpeningWorking(true);
            const next = await client.advanceWorldOpening(worldId);
            if (isCurrent()) {
              setOpening(next.opening);
              const previous = observedOpening.current;
              const hasNewMessages =
                next.opening.delivered > 0 &&
                (previous?.worldId !== worldId || next.opening.delivered > previous.delivered);
              observedOpening.current = { worldId, delivered: next.opening.delivered };
              if (next.played > 0 || hasNewMessages) await load();
              if (isCurrent() && next.opening.phase === 'complete')
                openingFinished.current = worldId;
            }
            return;
          }
        }
        if (!liveTimeRef.current.idleDue() || liveTimeRef.current.blocked) return;
        const realNowMs = Date.now();
        const attemptKey = clock.paused
          ? null
          : `idle-check:${worldId}:${Math.floor(realNowMs / PHONE_RUNTIME_POLICY.recheckAfterMs)}`;
        if (!attemptKey) return;
        if (
          !active ||
          document.visibilityState !== 'visible' ||
          phoneReady.current.sending ||
          liveTimeRef.current.blocked ||
          !claimCheck(attemptKey)
        )
          return;
        liveTimeRef.current.markChecked();
        advancing = true;
        const result = await advanceRecoveryRef.current.advance(attemptKey);
        if (!result) return;
        if (result.deferred === 'scheduler_busy') {
          releaseCheck(attemptKey);
          return;
        }
        // Reading the committed world lets the phone's existing message notification
        // and banner show the real incoming reply while this screen stays open.
        if (active && (result.changed || result.played > 0)) await load();
      } catch {
        // Operation failures retain their original queryable identity. Read failures
        // do not imply that a Director/NPC operation failed or authorize a resend.
        if (active && advancing) void advanceRecoveryRef.current.reconcile();
      } finally {
        if (openingEpoch.current.token === epoch) {
          directorInFlight.current = false;
          if (active) setOpeningWorking(false);
        }
      }
    }
    directorCheck.current = () => {
      // Same-origin tabs share a cheap-check/execution transport lock. A lost lock never
      // authorizes a new paid attempt: all source and unknown fences remain server-side.
      if (navigator.locks) {
        void navigator.locks
          .request(`pl-phone-check:${worldId}`, { ifAvailable: true }, (lock) =>
            lock ? checkForWorldNews() : undefined,
          )
          .catch(() => {});
      } else void checkForWorldNews();
    };
    directorCheck.current();
    const interval = window.setInterval(directorCheck.current, PHONE_RUNTIME_POLICY.checkEveryMs);
    return () => {
      active = false;
      window.clearInterval(interval);
      directorCheck.current = () => {};
    };
  }, [client, load, worldId, automatic]);
  useEffect(() => {
    if (data?.id === worldId && !refreshing) directorCheck.current();
  }, [data?.id, refreshing, worldId, liveTime.entryKey]);
  return (
    <div className="world-viewport" style={{ display: 'flex', flexDirection: 'column' }}>
      <AppViewport />
      {data?.id === worldId &&
        opening &&
        opening.runtime !== 'agents' &&
        !['none', 'complete'].includes(opening.phase) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 14px',
              fontSize: 12,
              background: 'var(--surface, #f5f3ed)',
              color: 'var(--muted, #676b65)',
            }}
          >
            <span>
              {opening.phase === 'unknown' && !openingWorking
                ? '有条新消息未能收到'
                : '正在接收新消息'}{' '}
              · {opening.delivered}/{opening.total}
            </span>
            {opening.retryable && (
              <button
                type="button"
                disabled={openingWorking}
                style={{ border: 0, background: 'none', color: 'inherit', font: 'inherit' }}
                onClick={async () => {
                  if (
                    directorInFlight.current ||
                    phoneReady.current.sending ||
                    phoneReady.current.refreshing ||
                    !phoneReady.current.hasData
                  )
                    return;
                  const epoch = openingEpoch.current.token;
                  directorInFlight.current = true;
                  setOpeningWorking(true);
                  try {
                    const next = await client.advanceWorldOpening(worldId, true);
                    if (openingEpoch.current.token !== epoch) return;
                    setOpening(next.opening);
                    const previous = observedOpening.current;
                    const hasNewMessages =
                      next.opening.delivered > 0 &&
                      (previous?.worldId !== worldId ||
                        next.opening.delivered > previous.delivered);
                    observedOpening.current = { worldId, delivered: next.opening.delivered };
                    if (next.opening.phase === 'complete') openingFinished.current = worldId;
                    if (next.played > 0 || hasNewMessages) await load();
                  } catch {
                    if (openingEpoch.current.token !== epoch) return;
                    setOpening((current) =>
                      current ? { ...current, phase: 'unknown', retryable: true } : current,
                    );
                  } finally {
                    if (openingEpoch.current.token === epoch) {
                      directorInFlight.current = false;
                      setOpeningWorking(false);
                    }
                  }
                }}
              >
                继续接收
              </button>
            )}
          </div>
        )}
      {advanceRecovery.items.some((i) => i.state !== 'running') && (
        <details style={{ fontSize: 12, padding: '4px 12px', color: '#64748b' }}>
          <summary>同步记录</summary>
          {advanceRecovery.items
            .filter((i) => i.state !== 'running')
            .map((i) => (
              <p key={i.id}>
                {i.receipt?.waitingOn === 'clock_or_attention'
                  ? '已有进展正在等待合适时机继续，不需要重新发送。'
                  : i.state === 'failed'
                    ? '有一项进展未完成，原记录已保留，其他事项仍可继续。'
                    : i.state === 'unknown'
                      ? '有一项进展的结果尚未确认，系统不会重复执行。'
                      : '正在核对原记录，不需要重新发送。'}
              </p>
            ))}
        </details>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
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
            onLockChange={onPhoneLockChange}
            key={data.id}
            wechatActorKey={wechatActorKey}
            transport={transport}
            data={
              liveTime.displayTime && automatic ? { ...data, time: liveTime.displayTime } : data
            }
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
              if (automatic) await liveTimeRef.current.startConversation();
              const receipt = await client.changeInvitation(worldId, input);
              // Invalidate older reads; a committed receipt must survive a failed refresh.
              request.current++;
              setRefreshing(false);
              setData((current) =>
                !current ||
                current.id !== receipt.worldId ||
                (current.version ?? 0) > receipt.version
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
            onSendMessage={async (actorId, text, commandId, photo, updateOp) => {
              await deliverMessage(actorId, text, commandId, undefined, photo, updateOp);
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
                setLocalMessages((current) =>
                  current.filter((message) => message.id !== messageId),
                );
                delete sendCommands.current[messageId];
                await load();
                return { status: 'committed' };
              }
              if (
                result.status === 'failed' &&
                (failed.status === 'unknown' || commandId === messageId)
              ) {
                setLocalMessages((current) =>
                  current.map((message) =>
                    message.id === messageId ? { ...message, status: 'failed' } : message,
                  ),
                );
                throw new ApiFailure(
                  result.code,
                  '上次回复未能保存，内容仍保留。可以继续聊天，或重新发送这条消息。',
                );
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
            localMessages={unprojectedLocalSends(
              localMessages,
              data.messages,
              committedSends.current,
            )}
            records={records}
            reloadRecords={reloadRecords}
            onReload={load}
            onSceneWorldChanged={reloadSceneWorld}
            mediaUrlFor={mediaUrlFor}
            runtimeAssetUrlFor={runtimeAssetUrlFor}
            loading={refreshing}
            loadError={error}
          />
        )}
      </div>
    </div>
  );
}

export function WorldPhoneSurface({
  data,
  onExperienceBusy,
  onLockChange,
  preview = false,
  transport,
  onReload,
  onSceneWorldChanged,
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
  wechatActorKey,
  mediaUrlFor,
  runtimeAssetUrlFor,
}: {
  data: WorldPhone;
  onExperienceBusy?: (busy: boolean) => void;
  onLockChange?: (locked: boolean) => void;
  preview?: boolean;
  transport?: typeof fetch;
  onReload?: () => Promise<void>;
  onSceneWorldChanged?: (minimumVersion: number) => Promise<void>;
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
  wechatActorKey?: string;
  mediaUrlFor?: (worldId: string, assetId: string) => string;
  runtimeAssetUrlFor?: (worldId: string, assetId: string, revision: number) => string;
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
  const client = useMemo(() => new LifeClient(transport), [transport]);
  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const custom = localStorage.getItem(`pl_wallpaper_${data.id}`);
      if (custom) return custom;
    }
    return data.publicationWallpaperUrl ?? resolveDefaultWallpaper(data.title, data.identity);
  });

  useEffect(() => {
    try {
      const custom = localStorage.getItem(`pl_wallpaper_${data.id}`);
      if (!custom) {
        setWallpaperUrl(
          data.publicationWallpaperUrl ?? resolveDefaultWallpaper(data.title, data.identity),
        );
      }
    } catch {
      /* Storage may be unavailable. */
    }
  }, [data.id, data.title, data.identity, data.publicationWallpaperUrl]);

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
  const [waitWorking, setWaitWorking] = useState(false);
  const [pendingWait, setPendingWait] = useState<AppointmentWaitRequest | null>(null);
  const [waitRecoveryMessage, setWaitRecoveryMessage] = useState('');
  const waitRequest = useRef<AppointmentWaitRequest | null>(null);
  const waitGuard = useRef(false);
  useEffect(() => {
    waitRequest.current = null;
    setPendingWait(null);
    setWaitRecoveryMessage('');
    try {
      const raw = localStorage.getItem('pl-appointment-wait:' + data.id);
      const parsed = raw ? AppointmentWaitRequestSchema.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success) {
        waitRequest.current = parsed.data;
        setPendingWait(parsed.data);
      }
    } catch {}
  }, [data.id]);
  const sceneClient = useMemo(() => new SceneClient(transport), [data.id, transport]);
  const sceneSync = useMemo(() => new SceneWorldSync(data.id), [data.id]);
  const scenePhoneVersion = useRef(data.version ?? 0);
  scenePhoneVersion.current = data.version ?? 0;
  const groups = useGroups(data.id, !preview, onReload, transport);
  const map = useWorldMap(data.id, data.version ?? 0, !preview, onReload, transport);
  useEffect(() => {
    if (!sceneWaiting || preview) return;
    const timer = setInterval(() => {
      void sceneClient
        .read(data.id)
        .then((d) => {
          const waiting = Boolean(d.task && ['queued', 'running'].includes(d.task.status));
          if (waiting) return;
          if (!onSceneWorldChanged) {
            setSceneWaiting(false);
            return;
          }
          return sceneSync
            .sync(d, scenePhoneVersion.current, onSceneWorldChanged)
            .then(() => setSceneWaiting(false));
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [sceneWaiting, sceneClient, sceneSync, data.id, preview, onSceneWorldChanged]);
  useEffect(() => {
    onExperienceBusy?.(
      sceneWaiting || groups.pending || map.working || waitWorking || Boolean(pendingWait),
    );
  }, [sceneWaiting, groups.pending, map.working, waitWorking, pendingWait, onExperienceBusy]);
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

  const basePhoneData = worldAppData(
    mergedData,
    viewed,
    localMessages,
    mediaUrlFor,
    runtimeAssetUrlFor,
  );
  const phoneData: PhoneAppsData = useMemo(
    () => ({
      ...basePhoneData,
      notes: onSaveNote ? basePhoneData.notes : notes,
      referenceTime: currentReferenceTime,
    }),
    [basePhoneData, notes, currentReferenceTime, onSaveNote],
  );

  async function performWait(input: AppointmentWaitRequest) {
    if (waitGuard.current) throw new ApiFailure('BUSY', '正在核对这个等待，请稍等。');
    // Persist before the request, so a lost response or refresh can only replay this exact command.
    try {
      localStorage.setItem('pl-appointment-wait:' + data.id, JSON.stringify(input));
    } catch {
      throw new ApiFailure('UNAVAILABLE', '请允许浏览器保存等待记录后再试。');
    }
    waitRequest.current = input;
    setPendingWait(input);
    setWaitRecoveryMessage('');
    waitGuard.current = true;
    setWaitWorking(true);
    try {
      const receipt = await client.waitToAppointment(data.id, input);
      waitRequest.current = null;
      setPendingWait(null);
      try {
        localStorage.removeItem('pl-appointment-wait:' + data.id);
      } catch {}
      await Promise.allSettled([
        onSceneWorldChanged?.(receipt.version),
        onReload?.(),
        map.refresh(),
        reloadRecords?.(),
      ]);
      return receipt;
    } catch (e) {
      if (
        e instanceof ApiFailure &&
        [
          'VERSION_CONFLICT',
          'INVALID_COMMAND',
          'NOT_FOUND',
          'FORBIDDEN',
          'INVALID_INPUT',
          'IDEMPOTENCY_CONFLICT',
        ].includes(e.code)
      ) {
        waitRequest.current = null;
        setPendingWait(null);
        try {
          localStorage.removeItem('pl-appointment-wait:' + data.id);
        } catch {}
        await Promise.allSettled([onReload?.(), map.refresh()]);
      }
      throw e;
    } finally {
      waitGuard.current = false;
      setWaitWorking(false);
    }
  }
  return (
    <PhoneAppsProvider
      transport={transport}
      worldId={data.id}
      groups={groups}
      data={phoneData}
      records={records}
      reloadRecords={reloadRecords}
      loading={loading}
      loadError={loadError}
      onReload={onReload}
      actions={{
        canWaitToAppointment: (id) => {
          const a = phoneData.invitations.find((a) => a.id === id),
            m = map.data;
          if (
            preview ||
            pendingWait ||
            waitWorking ||
            sceneWaiting ||
            !a ||
            a.status !== 'confirmed' ||
            !m ||
            m.paused ||
            m.busy ||
            m.currentSceneId ||
            map.working ||
            (map.operation && map.operation.status !== 'committed')
          )
            return false;
          const places = m.places.filter((p) => p.appointmentIds.includes(id));
          return (
            places.length === 1 &&
            places[0]!.id === m.currentPlaceId &&
            Date.parse(a.at) > Date.parse(m.storyNow)
          );
        },
        waitToAppointment: preview
          ? undefined
          : async (invitationId, commandId) => {
              if (waitGuard.current) throw new ApiFailure('BUSY', '正在核对这个等待，请稍等。');
              if (
                waitRequest.current &&
                (waitRequest.current.invitationId !== invitationId ||
                  waitRequest.current.commandId !== commandId)
              )
                throw new ApiFailure('BUSY', '上次等待的结果还需要核对，请点击“核对原等待”。');
              const input =
                waitRequest.current ??
                AppointmentWaitRequestSchema.parse({
                  invitationId,
                  commandId,
                  expectedVersion: data.version ?? 0,
                });
              return performWait(input);
            },
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
        onLockChange={onLockChange}
        wechatActorKey={wechatActorKey}
        wechatActorId={
          wechatActorKey ? wechatCharacterTarget(data.actors, wechatActorKey) : undefined
        }
        worldId={data.id}
        lifeName={data.title}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        wallpaperUrl={wallpaperUrl}
        notice={
          preview ? (
            <span>开发样板 · 合成数据 · 未调用模型</span>
          ) : (
            <AppointmentWaitRecovery
              pending={Boolean(pendingWait)}
              working={waitWorking}
              message={waitRecoveryMessage}
              onRecover={() => {
                const input = waitRequest.current;
                if (!input || waitWorking) return;
                void performWait(input)
                  .then(() =>
                    setWaitRecoveryMessage('已核对原等待。是否进入现场，请在日程里决定。'),
                  )
                  .catch((e) =>
                    setWaitRecoveryMessage(
                      e instanceof Error ? e.message : '这次结果还没能确认，请稍后再核对。',
                    ),
                  );
              }}
            />
          )
        }
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
          ...(records?.status === 'ready'
            ? records.data.current
                .filter(
                  (item) =>
                    item.kind === 'world_matter' &&
                    (item.state === 'in_progress' || item.state === 'blocked'),
                )
                .map((item) => ({
                  id: `notif-matter-${item.id}`,
                  title: item.title,
                  summary: `${item.stateLabel} · ${recordAttribution(item)} · ${item.text}`,
                  app: 'notes' as const,
                  target: item.id,
                  at:
                    item.source.kind === 'world_matter' || item.source.kind === 'world_event'
                      ? item.source.at
                      : undefined,
                  timeLabel: item.stateLabel,
                }))
            : []),
        ]}
        renderHome={({ open, openPanel }) => (
          <PhoneDesktop
            title={data.title}
            dateLabel={dateLabel}
            timeLabel={timeLabel}
            data={phoneData}
            records={records}
            open={open}
            openPanel={openPanel}
          />
        )}
        renderApp={(context) => <PhoneAppView {...context} map={map} />}
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
                    {phoneData.contacts.map((actor) => (
                      <PersonCard key={actor.id} contact={actor}>
                        <a href={`#life=${data.id}&app=messages&target=${actor.id}`}>💬 发微信</a>
                        <button
                          type="button"
                          onClick={() => {
                            const saved = data.actors.find((a) => a.id === actor.id);
                            if (saved) setCallingActor(saved);
                          }}
                        >
                          📞 电话呼叫
                        </button>
                      </PersonCard>
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
                transport={transport}
                key={data.id}
                worldId={data.id}
                contacts={phoneData.contacts}
                photos={phoneData.photos}
                phoneVersion={data.version ?? 0}
                onWorldChanged={onSceneWorldChanged}
                worldSync={sceneSync}
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
