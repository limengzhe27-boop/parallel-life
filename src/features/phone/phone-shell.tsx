'use client';

import type { PhoneMapContext } from './map/context.ts';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  homeRoute,
  activePhoneRoute,
  parentRoute,
  desktopApps,
  readRoute,
  routeHash,
  scrollKey,
  type PhoneApp,
  type PhonePanel,
  type PhoneRoute,
} from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { StatusBar } from './status-bar.tsx';
import { arrivingIds, isUnlockSwipe } from './notification-state.ts';
import {
  groupNotifications,
  latestNotification,
  type NotificationGroup,
} from './notification-projection.ts';
import { playReceiveSound } from './audio-feedback.ts';
import styles from './phone.module.css';

const apps: Record<PhoneApp, string> = {
  messages: '微信',
  moments: '朋友圈',
  photos: '相册',
  calendar: '日历',
  notes: '备忘录',
  scenes: '现场',
  map: '地图',
};
const panels: Partial<Record<PhonePanel, string>> = {
  timeline: '人生轨迹',
  scene: '现场',
  management: '备忘录',
};
export type PhoneNotification = {
  id: string;
  title: string;
  summary: string;
  app: PhoneApp;
  target?: string;
  timeLabel?: string;
  /** Persisted event time, used for deterministic ordering. */
  at?: string;
  /** Private and group conversations with the same target must stay separate. */
  conversationKind?: 'private' | 'group';
  /** Only set from a verified active item; never infer urgency from message text. */
  actionableUntil?: string;
};
export type PhoneAppContext = {
  map?: PhoneMapContext;
  app: PhoneApp;
  target?: string;
  open: (app: PhoneApp, target?: string) => void;
};
export type PhoneShellProps = {
  worldId: string;
  lifeName: string;
  dateLabel: string;
  timeLabel: string;
  /** Caller supplies an authorized URL. No default photo is presented as world data. */
  wallpaperUrl?: string;
  notifications?: readonly PhoneNotification[];
  /** Persisted story time for checking whether an action is still available. */
  referenceTime?: string;
  /** A caller with group routing can open a group notification without using private-chat routes. */
  onOpenNotification?: (notification: PhoneNotification) => void;
  renderApp?: (context: PhoneAppContext) => ReactNode;
  renderPanel?: (panel: PhonePanel) => ReactNode;
  renderHome?: (context: {
    open: (app: PhoneApp, target?: string) => void;
    openPanel: (panel: PhonePanel) => void;
  }) => ReactNode;
  notice?: ReactNode;
  /** Presentation lock only; does not replace account authentication. */
  initiallyLocked?: boolean;
};

/** Content only: the caller owns the device viewport, dimensions and outer navigation. */
export function PhoneShell(props: PhoneShellProps) {
  return <LifePhone key={props.worldId} {...props} />;
}
function LifePhone({
  worldId,
  lifeName,
  dateLabel,
  timeLabel,
  wallpaperUrl,
  notifications = [],
  referenceTime,
  onOpenNotification,
  renderApp,
  renderPanel,
  renderHome,
  notice,
  initiallyLocked = true,
}: PhoneShellProps) {
  const [route, setRoute] = useState<PhoneRoute>(homeRoute);
  const [locked, setLocked] = useState(initiallyLocked);
  const [bannerId, setBannerId] = useState<string>();
  const [openedIds, setOpenedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllGroups, setShowAllGroups] = useState(false);
  const knownIds = useRef<ReadonlySet<string>>(new Set(notifications.map((n) => n.id)));
  const unlockButton = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<number | undefined>(undefined);
  const ignoreUnlockClick = useRef(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const wallpaper = useRef<HTMLImageElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const lastPanel = useRef<PhonePanel | undefined>(undefined);
  const key = scrollKey(worldId, route);

  const notificationSignature = JSON.stringify(notifications.map((n) => n.id));
  useEffect(() => {
    const ids: string[] = JSON.parse(notificationSignature);
    const incoming = arrivingIds(knownIds.current, ids);
    knownIds.current = new Set(ids);
    if (incoming.length) {
      const incomingSet = new Set(incoming);
      const newest = latestNotification(notifications.filter((item) => incomingSet.has(item.id)));
      setBannerId(newest?.id ?? incoming.at(-1));
      playReceiveSound();
    }
  }, [notificationSignature, notifications]);
  useEffect(() => {
    if (!bannerId) return;
    const timer = window.setTimeout(() => setBannerId(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [bannerId]);
  const pending = notifications.filter((n) => !openedIds.has(n.id));
  const banner = pending.find((n) => n.id === bannerId);
  const groups = groupNotifications(pending, referenceTime);
  const visibleGroups = showAllGroups ? groups : groups.slice(0, 3);
  useEffect(() => {
    if (locked) unlockButton.current?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }, [locked]);

  useEffect(() => {
    const sync = () => {
      const saved = readRoute(location.hash, worldId);
      const next = activePhoneRoute(saved);
      if (next !== saved)
        history.replaceState({ ...history.state, plPhone: null }, '', routeHash(worldId, next));
      setRoute(next);
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [worldId]);
  useEffect(() => {
    // A cached/network failure can occur before hydration attaches onError.
    const image = wallpaper.current;
    if (wallpaperUrl && image?.complete && image.naturalWidth === 0) setFailedUrl(wallpaperUrl);
  }, [wallpaperUrl]);
  useLayoutEffect(() => {
    if (scroll.current && !locked) scroll.current.scrollTop = positions.current.get(key) ?? 0;
  }, [key, locked]);
  useLayoutEffect(() => {
    if (locked) return;
    if (route.panel && panelScroll.current)
      panelScroll.current.scrollTop = positions.current.get(`panel:${route.panel}`) ?? 0;
    if (!route.panel && lastPanel.current) {
      const trigger = root.current?.querySelector<HTMLButtonElement>(
        `[data-panel="${lastPanel.current}"]`,
      );
      (trigger ?? heading.current)?.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
    lastPanel.current = route.panel;
  }, [key, route.panel, locked]);

  function navigate(next: PhoneRoute) {
    next = activePhoneRoute(next);
    const hash = routeHash(worldId, next);
    if (location.hash === hash) return;
    if (scroll.current && !route.panel && !locked)
      positions.current.set(key, scroll.current.scrollTop);
    history.pushState(
      { ...history.state, plPhone: { worldId, from: routeHash(worldId, route), to: hash } },
      '',
      hash,
    );
    setRoute(activePhoneRoute(readRoute(hash, worldId)));
  }
  function back() {
    const entry = history.state?.plPhone;
    if (entry?.worldId === worldId && entry.to === location.hash) history.back();
    else {
      const next = parentRoute(route);
      history.replaceState({ ...history.state, plPhone: null }, '', routeHash(worldId, next));
      setRoute(next);
    }
  }
  function open(app: PhoneApp, target?: string) {
    navigate({ app, ...(target ? { target } : {}) });
  }
  function lock() {
    if (route.panel && panelScroll.current)
      positions.current.set(`panel:${route.panel}`, panelScroll.current.scrollTop);
    else if (scroll.current) positions.current.set(key, scroll.current.scrollTop);
    setLocked(true);
  }
  function openNotification(n: PhoneNotification) {
    if (n.conversationKind === 'group' && !onOpenNotification) {
      // Until group routes are connected, the app list is safer than a private-chat deep link.
      setLocked(false);
      open(n.app);
      return;
    }
    setOpenedIds((current) => new Set([...current, n.id]));
    setBannerId(undefined);
    setLocked(false);
    if (n.conversationKind === 'group') onOpenNotification?.(n);
    else open(n.app, n.target);
  }
  function notificationCard(n: PhoneNotification) {
    return (
      <button
        key={n.id}
        className={styles.notification}
        data-notification={n.id}
        aria-label={`${n.title}，${n.timeLabel ?? '时间未注明'}，${n.summary}`}
        onClick={() => openNotification(n)}
      >
        <span className={`${styles.notificationIcon} ${styles[n.app]}`}>
          <PhoneIcon name={n.app} />
        </span>
        <span>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <small>{apps[n.app]}</small>
            {n.timeLabel && <small style={{ opacity: 0.65 }}>{n.timeLabel}</small>}
          </span>
          <strong>{n.title}</strong>
          <span className={styles.notificationSummary}>{n.summary}</span>
        </span>
        <PhoneIcon name="next" />
      </button>
    );
  }
  function groupCard(group: NotificationGroup) {
    const latest = group.latest;
    if (group.items.length === 1)
      return (
        <div key={group.key} className={styles.notificationGroup}>
          {notificationCard(latest)}
        </div>
      );
    const expanded = expandedGroups.has(group.key);
    const regionId = `notification-group-${encodeURIComponent(group.key)}`;
    return (
      <div
        key={group.key}
        className={`${styles.notificationGroup} ${expanded ? styles.notificationGroupExpanded : ''}`}
        data-notification-group={group.key}
      >
        <button
          className={`${styles.notification} ${styles.notificationStack}`}
          aria-label={`${latest.title}，${group.items.length} 条未读消息，最新消息：${latest.summary}`}
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() =>
            setExpandedGroups((current) => {
              const next = new Set(current);
              if (next.has(group.key)) next.delete(group.key);
              else next.add(group.key);
              return next;
            })
          }
        >
          <span className={`${styles.notificationIcon} ${styles[latest.app]}`}>
            <PhoneIcon name={latest.app} />
          </span>
          <span className={styles.notificationBody}>
            <span className={styles.notificationMeta}>
              <small>{apps[latest.app]}</small>
              {latest.timeLabel && <small>{latest.timeLabel}</small>}
            </span>
            <strong>{latest.title}</strong>
            <span className={styles.notificationSummary}>{latest.summary}</span>
            <small className={styles.notificationCount}>
              {group.items.length} 条未读 · {expanded ? '收起' : '展开'}
            </small>
          </span>
          <PhoneIcon name="next" />
        </button>
        {expanded && (
          <div
            id={regionId}
            className={styles.notificationItems}
            aria-label={`${latest.title}的未读消息`}
          >
            {group.items.map(notificationCard)}
          </div>
        )}
      </div>
    );
  }
  function appButton(app: PhoneApp) {
    return (
      <button
        key={app}
        data-app={app}
        aria-label={apps[app]}
        className={styles.launcher}
        onClick={() => open(app)}
      >
        <span className={`${styles.appIcon} ${styles[app]}`}>
          {app === 'calendar' ? (
            <span className={styles.calendarFace}>
              <span>
                {dateLabel.match(/星期[一二三四五六日天]|周[一二三四五六日天]/)?.[0] ?? '日历'}
              </span>
              <strong>{dateLabel.match(/(\d{1,2})\s*日/)?.[1] ?? '—'}</strong>
            </span>
          ) : (
            <PhoneIcon name={app} variant="app" />
          )}
        </span>
        {pending.filter((n) => n.app === app).length > 0 && (
          <span
            className={styles.badge}
            aria-label={`${pending.filter((n) => n.app === app).length} 条待查看通知`}
          >
            {pending.filter((n) => n.app === app).length}
          </span>
        )}
        <span className={styles.appLabel}>{apps[app]}</span>
      </button>
    );
  }
  const isHome = !route.app && !route.panel;
  const label = route.panel
    ? (panels[route.panel] ?? '手机桌面')
    : route.app
      ? apps[route.app]
      : '手机桌面';
  return (
    <section
      ref={root}
      className={styles.phone}
      data-phone-content
      data-screen={locked ? 'lock' : isHome ? 'home' : 'page'}
      aria-label={`${lifeName}的手机`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !isHome && !locked) {
          event.preventDefault();
          back();
        }
      }}
    >
      {wallpaperUrl && failedUrl !== wallpaperUrl && (
        <img
          ref={wallpaper}
          className={styles.wallpaper}
          src={wallpaperUrl}
          alt=""
          onError={() => setFailedUrl(wallpaperUrl)}
        />
      )}
      <div className={styles.shade} />
      {notice && <div className={styles.notice}>{notice}</div>}
      <StatusBar timeLabel={timeLabel} locked={locked} onLock={lock} />
      {banner && !locked && (
        <div className={styles.banner} data-notification-banner role="status" key={banner.id}>
          {notificationCard(banner)}
          <button
            className={styles.dismissBanner}
            aria-label="收起消息横幅"
            onClick={() => setBannerId(undefined)}
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.unlockedContent} hidden={locked} inert={locked}>
        {route.panel && (
          <header className={styles.header}>
            <button
              className={styles.headerButton}
              aria-label={route.panel ? '关闭辅助页面' : '返回上一页'}
              onClick={back}
            >
              <PhoneIcon name="back" />
              <span className={styles.headerBackLabel}>返回</span>
            </button>
            <h2 ref={heading} tabIndex={-1} className={styles.headerTitle}>
              {label}
            </h2>
            <button
              className={styles.headerButton}
              aria-label="回到手机桌面"
              onClick={() => navigate(homeRoute)}
            >
              <PhoneIcon name="home" />
            </button>
          </header>
        )}
        <h2
          ref={heading}
          tabIndex={-1}
          className={
            isHome || (route.app === 'messages' && route.target) ? styles.srOnly : styles.srOnly
          }
        >
          {label}
        </h2>
        <div
          ref={scroll}
          hidden={!!route.panel}
          className={styles.scroll}
          data-phone-scroll
          onScroll={(event) => {
            if (!route.panel && !locked) positions.current.set(key, event.currentTarget.scrollTop);
          }}
        >
          {!route.app ? (
            renderHome ? (
              renderHome({
                open: (app: PhoneApp, target?: string) => open(app, target),
                openPanel: (panel: PhonePanel) => navigate({ ...route, panel }),
              })
            ) : (
              <div className={styles.home}>
                <button className={styles.manageShortcut} onClick={() => open('notes')}>
                  备忘录 <PhoneIcon name="next" />
                </button>
              </div>
            )
          ) : (
            <div className={styles.appContent} key={`${route.app}:${route.target ?? ''}`}>
              {renderApp ? (
                renderApp({ app: route.app, target: route.target, open })
              ) : (
                <div className={styles.empty}>
                  <PhoneIcon name={route.app} />
                  <h3>{apps[route.app]}还未开放</h3>
                  <p>世界准备好后，再来这里看看。</p>
                </div>
              )}
            </div>
          )}
        </div>
        {route.panel && (
          <div
            key={`${route.panel}:${route.panel === 'scene' ? (route.target ?? 'current') : ''}`}
            ref={panelScroll}
            className={styles.panelPage}
            data-phone-panel
            onScroll={(event) => {
              if (!locked)
                positions.current.set(`panel:${route.panel}`, event.currentTarget.scrollTop);
            }}
          >
            {renderPanel ? (
              renderPanel(route.panel)
            ) : (
              <div className={styles.empty}>
                <PhoneIcon name={route.panel} />
                <h3>{panels[route.panel]}还未开放</h3>
                <p>这部分生活还在准备中。</p>
              </div>
            )}
          </div>
        )}
        {isHome && (
          <nav className={styles.dock} aria-label="常用应用">
            {desktopApps.filter((app) => app !== 'scenes').map(appButton)}
          </nav>
        )}
        <button
          className={styles.homeGesture}
          aria-label="返回手机桌面"
          onClick={() => navigate(homeRoute)}
        >
          <span />
        </button>
      </div>
      {locked && (
        <div className={styles.lockScreen} data-lock-screen>
          <div className={styles.lockScroll}>
            <div className={styles.lockContent}>
              <div className={styles.lockClock}>
                <p>{dateLabel}</p>
                <div>{timeLabel}</div>
                <span className={styles.srOnly}>{lifeName}</span>
              </div>
              <section
                className={`${styles.notifications} ${styles.lockNotifications}`}
                aria-label="锁屏通知"
              >
                {visibleGroups.map(groupCard)}
                {groups.length > 3 && (
                  <button
                    className={styles.moreNotifications}
                    aria-expanded={showAllGroups}
                    onClick={() => setShowAllGroups((current) => !current)}
                  >
                    {showAllGroups ? '收起其他通知' : `查看其余 ${groups.length - 3} 组通知`}
                  </button>
                )}
                {!pending.length && <span className={styles.srOnly}>没有待查看通知</span>}
              </section>
            </div>
          </div>

          <button
            ref={unlockButton}
            className={styles.unlock}
            aria-label="解锁手机"
            onClick={() => {
              if (!ignoreUnlockClick.current) setLocked(false);
              ignoreUnlockClick.current = false;
            }}
            onPointerDown={(event) => {
              ignoreUnlockClick.current = false;
              swipeStart.current = event.clientY;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              ignoreUnlockClick.current =
                swipeStart.current !== undefined &&
                Math.abs(swipeStart.current - event.clientY) > 12;
              if (
                swipeStart.current !== undefined &&
                isUnlockSwipe(swipeStart.current, event.clientY)
              )
                setLocked(false);
              swipeStart.current = undefined;
            }}
            onPointerCancel={() => {
              swipeStart.current = undefined;
            }}
          >
            <span>向上轻扫打开</span>
            <i />
          </button>
        </div>
      )}
    </section>
  );
}
