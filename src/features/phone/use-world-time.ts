'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LifeClient } from '../api/client.ts';
import type { WorldClock, ClockActivityRequest } from '../../contracts/world-clock.ts';
import { StoryWaitRequestSchema, type StoryWaitRequest } from '../../contracts/story-wait.ts';
import { projectStoryTime } from '../../modules/world/domain/clock.ts';
import { readableActivityClock } from '../../modules/world/domain/clock-activity.ts';
import { readRoute } from './navigation.ts';
import { idleCheckDue, phoneTimeMode } from './time-experience-policy.ts';
type Mode = ClockActivityRequest['mode'];
const pageLeases = new Map<string, { clientId: string; sequence: number }>();
type Session = {
  clientId: string;
  sequence: number;
  active: boolean;
  returning: boolean;
  mode?: Mode;
  tail: Promise<unknown>;
};
export function useWorldTime(client: LifeClient, worldId: string, enabled: boolean, busy: boolean) {
  const [view, setView] = useState<{ worldId: string; clock: WorldClock } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingWait, setPendingWait] = useState<StoryWaitRequest | null>(null);
  const pendingWaitRef = useRef(pendingWait);
  pendingWaitRef.current = pendingWait;
  const session = useRef<Session | null>(null);
  const waiting = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const lastMeaningfulActivity = useRef(Date.now());
  const lastCheck = useRef(Date.now());
  const sync = useCallback(
    (mode: Mode, resume = false): Promise<WorldClock | null> => {
      const s = session.current;
      if (!s?.active) return Promise.resolve(null);
      s.mode = mode;
      const input = {
        clientId: s.clientId,
        sequence: ++s.sequence,
        mode,
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
      tail: Promise.resolve(),
    };
    session.current = s;
    setView(null);
    setNotice('');
    setWorking(false);
    lastMeaningfulActivity.current = Date.now();
    lastCheck.current = Date.now();
    try {
      const raw = sessionStorage.getItem('pl-story-wait:' + worldId);
      const parsed = raw ? StoryWaitRequestSchema.safeParse(JSON.parse(raw)) : null;
      setPendingWait(parsed?.success ? parsed.data : null);
    } catch {
      setPendingWait(null);
    }
    const mode = () => phoneTimeMode(busyRef.current, readRoute(location.hash, worldId));
    const update = () => {
      if (document.visibilityState !== 'visible' || s.returning || waiting.current) return;
      void sync(mode()).catch(() => {
        if (s.active) setNotice('时间暂时未同步，稍后重试。');
      });
    };
    const leave = () => {
      s.returning = true;
      setView((current) =>
        current?.worldId === worldId
          ? {
              ...current,
              clock: {
                ...current.clock,
                storyNow: projectStoryTime(current.clock, new Date().toISOString()),
                lastTickAt: new Date().toISOString(),
                paused: true,
              },
            }
          : current,
      );
      void sync('away').catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') leave();
      else {
        s.returning = true;
        void client
          .readWorldClock(worldId)
          .then((clock) => {
            if (s.active)
              setView({
                worldId,
                clock: {
                  ...clock,
                  storyNow: projectStoryTime(clock, new Date().toISOString()),
                  lastTickAt: new Date().toISOString(),
                  paused: true,
                },
              });
          })
          .catch(() => {});
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
    return () => {
      leave();
      s.active = false;
      if (session.current === s) session.current = null;
      clearInterval(heartbeat);
      clearInterval(display);
      window.removeEventListener('hashchange', update);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [client, worldId, enabled, sync]);
  useEffect(() => {
    if (enabled && !session.current?.returning)
      void sync(phoneTimeMode(busy, readRoute(location.hash, worldId))).catch(() => {});
  }, [enabled, busy, sync, worldId]);
  const startConversation = useCallback(async () => {
    if (waiting.current || pendingWaitRef.current) throw Error('请先核对这次等待，再继续交谈。');
    lastMeaningfulActivity.current = Date.now();
    const s = session.current;
    const clock = await sync('conversation');
    if (!s?.active || session.current !== s || !clock || clock.paused || session.current?.returning)
      throw Error('请先继续这段人生，再发送消息。');
  }, [sync]);
  const resume = async () => {
    const s = session.current;
    if (!s) return;
    setWorking(true);
    setNotice('');
    s.returning = false;
    try {
      await sync(phoneTimeMode(busyRef.current, readRoute(location.hash, worldId)), true);
      lastMeaningfulActivity.current = Date.now();
      lastCheck.current = Date.now();
    } catch {
      if (session.current !== s || !s.active) return;
      s.returning = true;
      setNotice('这次没能继续，可以再试一次。');
    } finally {
      if (session.current === s) setWorking(false);
    }
  };
  const pause = async () => {
    const s = session.current;
    if (!s) return;
    s.returning = true;
    setView((current) =>
      current?.worldId === worldId
        ? {
            ...current,
            clock: {
              ...current.clock,
              storyNow: projectStoryTime(current.clock, new Date().toISOString()),
              lastTickAt: new Date().toISOString(),
              paused: true,
            },
          }
        : current,
    );
    await sync('away').catch(() => {
      if (session.current === s && s.active)
        setNotice('暂停请求尚未确认，时间会在连接失效后冻结。');
    });
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
        sync(phoneTimeMode(busyRef.current, readRoute(location.hash, worldId))),
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
      lastCheck.current = 0;
      lastMeaningfulActivity.current = 0;
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
    working,
    notice,
    pendingWait,
    resume,
    pause,
    wait,
    startConversation,
    blocked:
      enabled &&
      (!clock || clock.paused || !!session.current?.returning || working || !!pendingWait),
    displayTime: clock ? projectStoryTime(clock, new Date(now).toISOString()) : null,
    idleDue: () => idleCheckDue(Date.now(), lastMeaningfulActivity.current, lastCheck.current),
    markChecked: () => {
      lastCheck.current = Date.now();
    },
  };
}
