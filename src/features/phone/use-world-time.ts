'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { WorldClock, ClockActivityRequest } from '../../contracts/world-clock.ts';
import { StoryWaitRequestSchema, type StoryWaitRequest } from '../../contracts/story-wait.ts';
import { projectStoryTime } from '../../modules/world/domain/clock.ts';
import { readableActivityClock } from '../../modules/world/domain/clock-activity.ts';
import { readRoute } from './navigation.ts';
import {
  idleCheckDue,
  phoneTimeMode,
  phoneConversationFocus,
  phoneCheckHistory,
  observePhoneIncoming,
  type PhoneCheckHistory,
} from './time-experience-policy.ts';
type Mode = ClockActivityRequest['mode'];
const pageLeases = new Map<string, { clientId: string; sequence: number }>();
type Session = {
  clientId: string;
  sequence: number;
  active: boolean;
  returning: boolean;
  resumeRequired: boolean;
  mode?: Mode;
  acknowledgedMode?: Mode;
  tail: Promise<unknown>;
};
export function useWorldTime(
  client: LifeClient,
  worldId: string,
  enabled: boolean,
  busy: boolean,
  locked: boolean,
) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [view, setView] = useState<{ worldId: string; clock: WorldClock } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const [pendingWait, setPendingWait] = useState<StoryWaitRequest | null>(null);
  const pendingWaitRef = useRef(pendingWait);
  pendingWaitRef.current = pendingWait;
  const session = useRef<Session | null>(null);
  const waiting = useRef(false);
  const immediateCheck = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const checkHistory = useRef<PhoneCheckHistory>(phoneCheckHistory(Date.now()));
  const checkStorageKey = `pl-phone-check-v1:${worldId}`;
  const saveCheckHistory = () => {
    try {
      const raw = localStorage.getItem(checkStorageKey);
      if (raw) {
        const saved = phoneCheckHistory(Date.now(), JSON.parse(raw));
        checkHistory.current.lastActivityAt = Math.max(
          checkHistory.current.lastActivityAt,
          saved.lastActivityAt,
        );
        checkHistory.current.lastCheckAt = Math.max(
          checkHistory.current.lastCheckAt,
          saved.lastCheckAt,
        );
      }
      localStorage.setItem(checkStorageKey, JSON.stringify(checkHistory.current));
    } catch {}
  };
  const sync = useCallback(
    (mode: Mode, resume = false): Promise<WorldClock | null> => {
      const s = session.current;
      if (!s?.active) return Promise.resolve(null);
      s.mode = mode;
      const input = {
        clientId: s.clientId,
        sequence: ++s.sequence,
        mode,
        focus:
          mode === 'conversation'
            ? phoneConversationFocus(readRoute(location.hash, worldId), lockedRef.current)
            : null,
        ...(resume ? { resume: true } : {}),
      };
      pageLeases.set(worldId, { clientId: s.clientId, sequence: s.sequence });
      const run = s.tail
        .catch(() => {})
        .then(async () => {
          // A queued foreground heartbeat must not wake an already hidden page.
          if (mode !== 'away' && (!s.active || document.visibilityState !== 'visible')) return null;
          const clock = await client.updateClockActivity(worldId, input);
          if (session.current === s && s.active && mode !== 'away' && !s.returning) {
            if (!clock.paused) {
              if (resume) s.resumeRequired = false;
              if (resume || s.acknowledgedMode === undefined) setEntryKey(crypto.randomUUID());
              s.acknowledgedMode = mode;
            }
            s.mode = mode;
            setView({ worldId, clock });
          }
          return clock;
        });
      s.tail = run;
      return run;
    },
    [client, worldId],
  );
  useEffect(() => {
    if (!enabled) return;
    const previous = pageLeases.get(worldId);
    const s: Session = {
      clientId: previous?.clientId ?? crypto.randomUUID(),
      sequence: previous?.sequence ?? 0,
      active: true,
      returning: false,
      resumeRequired: true,
      tail: Promise.resolve(),
    };
    session.current = s;
    setView(null);
    setNotice('');
    setEntryKey(null);
    setWorking(false);
    immediateCheck.current = false;
    try {
      const raw = localStorage.getItem(checkStorageKey);
      checkHistory.current = phoneCheckHistory(Date.now(), raw ? JSON.parse(raw) : null);
    } catch {
      checkHistory.current = phoneCheckHistory(Date.now());
    }
    try {
      const raw = sessionStorage.getItem('pl-story-wait:' + worldId);
      const parsed = raw ? StoryWaitRequestSchema.safeParse(JSON.parse(raw)) : null;
      const restored = parsed?.success ? parsed.data : null;
      pendingWaitRef.current = restored;
      setPendingWait(restored);
    } catch {
      pendingWaitRef.current = null;
      setPendingWait(null);
    }
    const mode = () =>
      phoneTimeMode(busyRef.current, readRoute(location.hash, worldId), lockedRef.current);
    const update = () => {
      if (
        document.visibilityState !== 'visible' ||
        s.returning ||
        waiting.current ||
        pendingWaitRef.current
      )
        return;
      void sync(mode(), s.resumeRequired).catch(() => {
        if (s.active) setNotice('时间暂时未同步，稍后重试。');
      });
    };
    const leave = () => {
      if (s.returning) return;
      s.returning = true;
      s.resumeRequired = true;
      setView((current) =>
        current?.worldId === worldId
          ? {
              ...current,
              clock: {
                ...current.clock,
                storyNow: projectStoryTime(current.clock, new Date().toISOString()),
                lastTickAt: new Date().toISOString(),
                paused: current.clock.continuityMode === 'continuous' ? current.clock.paused : true,
              },
            }
          : current,
      );
      void sync('away').catch(() => {});
    };
    const onPageShow = () => {
      if (s.returning && document.visibilityState === 'visible') visibility();
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') leave();
      else if (s.returning) {
        // Resume the existing clock policy, then inspect real pending work immediately.
        // Returning is not a new conversation, message, or paid source identity.
        s.returning = false;
        s.resumeRequired = true;
        immediateCheck.current = true;
        update();
      }
    };
    update();
    const heartbeat = setInterval(update, 15_000);
    const display = setInterval(() => {
      setNow(Date.now());
      if (!s.returning && mode() !== s.mode) update();
    }, 5_000);
    window.addEventListener('hashchange', update);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      leave();
      s.active = false;
      if (session.current === s) session.current = null;
      clearInterval(heartbeat);
      clearInterval(display);
      window.removeEventListener('hashchange', update);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [client, worldId, enabled, sync]);
  useEffect(() => {
    if (enabled && !session.current?.returning && !pendingWaitRef.current)
      void sync(
        phoneTimeMode(busy, readRoute(location.hash, worldId), lockedRef.current),
        session.current?.resumeRequired,
      ).catch(() => {});
  }, [enabled, busy, locked, sync, worldId]);
  const startConversation = useCallback(async () => {
    if (waiting.current || pendingWaitRef.current) throw Error('请先核对这次等待，再继续交谈。');
    checkHistory.current.lastActivityAt = Date.now();
    saveCheckHistory();
    const s = session.current;
    const clock = await sync('conversation', s?.resumeRequired);
    if (!s?.active || session.current !== s || !clock || clock.paused || session.current?.returning)
      throw Error('正在恢复这段人生，请稍后发送。');
  }, [sync]);
  // Only an in-world stopping boundary needs a choice; entering the page never does.
  const continueAtBoundary = async () => {
    if (pendingWaitRef.current || waiting.current) return;
    const s = session.current;
    if (!s?.active || s.returning) return;
    setWorking(true);
    try {
      await sync(
        phoneTimeMode(busyRef.current, readRoute(location.hash, worldId), lockedRef.current),
        true,
      );
      setNotice('');
      // A deliberate boundary continuation is an immediate opportunity to inspect pending work.
      immediateCheck.current = true;
    } catch {
      setNotice('时间暂时未同步，请稍后再试。');
    } finally {
      if (session.current === s) setWorking(false);
    }
  };
  async function wait(
    target: StoryWaitRequest['target'],
    expectedVersion: number,
    reload: () => Promise<void>,
  ) {
    const s = session.current;
    if (!s || working) return;
    const input = pendingWait ?? {
      commandId: crypto.randomUUID(),
      expectedVersion,
      clientId: s.clientId,
      sequence: ++s.sequence,
      target,
    };
    pageLeases.set(worldId, { clientId: s.clientId, sequence: s.sequence });
    waiting.current = true;
    setWorking(true);
    setNotice('');
    setPendingWait(input);
    try {
      sessionStorage.setItem('pl-story-wait:' + worldId, JSON.stringify(input));
    } catch {
      /* In-memory recovery still retains this command. */
    }
    try {
      await s.tail.catch(() => {});
      const result = await client.waitStoryTime(worldId, input);
      if (session.current !== s || !s.active) return;
      try {
        const stored = sessionStorage.getItem('pl-story-wait:' + worldId);
        if (stored && JSON.parse(stored).commandId === input.commandId)
          sessionStorage.removeItem('pl-story-wait:' + worldId);
      } catch {}
      setPendingWait(null);
      if (document.visibilityState === 'visible') s.returning = false;
      // The wait receipt already committed time and resumed its lease atomically.
      // A later refresh failure cannot turn that success into an uncertain wait.
      await Promise.allSettled([
        sync(phoneTimeMode(busyRef.current, readRoute(location.hash, worldId), lockedRef.current)),
        reload(),
      ]);
      if (session.current !== s) return;
      setNotice(
        result.stoppedBy.reason === 'target'
          ? input.target === 'next_appointment'
            ? '已等到赴约前，请自行前往约定地点。'
            : input.target === 'morning'
              ? '已休息到明早。'
              : '已等候一会。'
          : result.stoppedBy.reason === 'opening'
            ? '开场来信还在到达，先看看手机。'
            : result.stoppedBy.reason === 'message'
              ? '有一件待回应的重要事情，先停在这里。'
              : result.stoppedBy.reason === 'appointment'
                ? `已到更早的约定时间${result.stoppedBy.label ? '：' + result.stoppedBy.label : ''}。`
                : '有新的剧情可以展开，先停在这里。',
      );
      immediateCheck.current = true;
    } catch (e) {
      if (
        session.current === s &&
        !['UNAVAILABLE', 'UNKNOWN', 'AI_TIMEOUT'].includes(
          (e as { code?: string })?.code ?? 'UNAVAILABLE',
        )
      ) {
        setPendingWait(null);
        try {
          const stored = sessionStorage.getItem('pl-story-wait:' + worldId);
          if (stored && JSON.parse(stored).commandId === input.commandId)
            sessionStorage.removeItem('pl-story-wait:' + worldId);
        } catch {}
      }
      if (session.current === s)
        setNotice(e instanceof Error ? e.message : '等待结果还需核对，请核对原等待。');
    } finally {
      if (session.current === s) {
        waiting.current = false;
        setWorking(false);
      }
    }
  }
  const clock =
    view?.worldId === worldId
      ? readableActivityClock(view.clock, new Date(now).toISOString())
      : null;
  return {
    clock,
    // Local foreground generation only. Never sent as a model command or source authorization.
    entryKey,
    working,
    notice,
    pendingWait,
    wait,
    startConversation,
    continueAtBoundary,
    blocked:
      enabled &&
      (!clock || clock.paused || !!session.current?.returning || working || !!pendingWait),
    displayTime: clock ? projectStoryTime(clock, new Date(now).toISOString()) : null,
    /** Entry/return is a transport opportunity, not a new model authorization. */
    requestCheck: () => {
      immediateCheck.current = true;
    },
    observeIncoming: (ids: readonly string[]) => {
      checkHistory.current = observePhoneIncoming(checkHistory.current, ids, Date.now());
      saveCheckHistory();
    },
    idleDue: () => {
      if (immediateCheck.current) return true;
      // Other tabs may have observed a message or already checked the same world.
      try {
        const raw = localStorage.getItem(checkStorageKey);
        const saved = phoneCheckHistory(Date.now(), raw ? JSON.parse(raw) : null);
        if (raw) {
          checkHistory.current.lastActivityAt = Math.max(
            checkHistory.current.lastActivityAt,
            saved.lastActivityAt,
          );
          checkHistory.current.lastCheckAt = Math.max(
            checkHistory.current.lastCheckAt,
            saved.lastCheckAt,
          );
        }
      } catch {}
      return idleCheckDue(
        Date.now(),
        checkHistory.current.lastActivityAt,
        checkHistory.current.lastCheckAt,
      );
    },
    markChecked: () => {
      immediateCheck.current = false;
      checkHistory.current.lastCheckAt = Date.now();
      saveCheckHistory();
    },
  };
}
