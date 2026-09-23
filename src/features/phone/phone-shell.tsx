'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  homeRoute,
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
import { playReceiveSound } from './audio-feedback.ts';
import styles from './phone.module.css';

const apps: Record<PhoneApp, string> = {
  messages: '微信',
  moments: '朋友圈',
  photos: '相册',
  calendar: '日历',
  notes: '便签',
};
const panels: Record<PhonePanel, string> = {
  schedule: '日程',
  timeline: '人生轨迹',
  director: '导演',
  management: '人生管理',
};
export type PhoneNotification = {
  id: string;
  title: string;
  summary: string;
  app: PhoneApp;
  target?: string;
  timeLabel?: string;
};
export type PhoneAppContext = {
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
      setBannerId(incoming.at(-1));
      playReceiveSound();
    }
  }, [notificationSignature]);
  useEffect(() => {
    if (!bannerId) return;
    const timer = window.setTimeout(() => setBannerId(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [bannerId]);
  const pending = notifications.filter((n) => !openedIds.has(n.id));
  const banner = pending.find((n) => n.id === bannerId);
  useEffect(() => {
    if (locked) unlockButton.current?.focus({ preventScroll: true });
    else heading.current?.focus({ preventScroll: true });
  }, [locked]);

  useEffect(() => {
    const sync = () => setRoute(readRoute(location.hash, worldId));
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
    const hash = routeHash(worldId, next);
    if (location.hash === hash) return;
    if (scroll.current && !route.panel && !locked)
      positions.current.set(key, scroll.current.scrollTop);
    history.pushState(
      { ...history.state, plPhone: { worldId, from: routeHash(worldId, route), to: hash } },
      '',
      hash,
    );
    setRoute(next);
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
    setOpenedIds((current) => new Set([...current, n.id]));
    setBannerId(undefined);
    setLocked(false);
    open(n.app, n.target);
  }
  function notificationCard(n: PhoneNotification) {
    return (
      <button
        key={n.id}
        className={styles.notification}
        data-notification={n.id}
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
          <span>{n.summary}</span>
        </span>
        <PhoneIcon name="next" />
      </button>
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
            <PhoneIcon name={app} />
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
  const label = route.panel ? panels[route.panel] : route.app ? apps[route.app] : '手机桌面';
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
      {banner && (
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
          className={(isHome || (route.app === 'messages' && route.target)) ? styles.srOnly : styles.srOnly}
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
                <button
                  className={styles.manageShortcut}
                  data-panel="management"
                  onClick={() => navigate({ ...route, panel: 'management' })}
                >
                  人生管理 <PhoneIcon name="next" />
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
            key={route.panel}
            ref={panelScroll}
            className={styles.panelPage}
            data-phone-panel
            onScroll={(event) => {
              if (!locked)
                positions.current.set(`panel:${route.panel}`, event.currentTarget.scrollTop);
            }}
          >
            {route.panel === 'management' ? (
              <div className={styles.management}>
                <p>这段人生的调整与管理</p>
                <button onClick={() => navigate({ ...route, panel: 'director' })}>
                  与导演讨论 <PhoneIcon name="next" />
                </button>
                <button onClick={() => navigate({ ...route, panel: 'timeline' })}>
                  当前身份与经历 <PhoneIcon name="next" />
                </button>
                <button onClick={() => navigate({ ...route, panel: 'schedule' })}>
                  故事时间与安排 <PhoneIcon name="next" />
                </button>
                <a href="/">
                  返回现实中的我 <PhoneIcon name="next" />
                </a>
                <a href="/possibilities">
                  切换人生 <PhoneIcon name="next" />
                </a>
                <p>暂停、账号和删除将在对应能力接入后开放。</p>
              </div>
            ) : renderPanel ? (
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
            {desktopApps.map(appButton)}
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
                {pending.filter((n) => n.id !== banner?.id).map(notificationCard)}
                {!pending.length && <span className={styles.srOnly}>没有待查看通知</span>}
              </section>
            </div>
          </div>
          {/* 锁屏底部 5 大快捷 Dock 图标（对齐 Screen 03） */}
          <div className={styles.lockDock} aria-label="锁屏快捷入口">
            <button
              type="button"
              className={styles.lockDockButton}
              title="便签"
              aria-label="打开便签"
              onClick={(e) => {
                e.stopPropagation();
                setLocked(false);
                open('notes');
              }}
            >
              📝
            </button>
            <button
              type="button"
              className={styles.lockDockButton}
              title="微信"
              aria-label="打开微信"
              onClick={(e) => {
                e.stopPropagation();
                setLocked(false);
                open('messages');
              }}
            >
              💬
            </button>
            <button
              type="button"
              className={styles.lockDockButton}
              title="日历"
              aria-label="打开日历"
              onClick={(e) => {
                e.stopPropagation();
                setLocked(false);
                open('calendar');
              }}
            >
              🗓️
            </button>
            <button
              type="button"
              className={styles.lockDockButton}
              title="相册"
              aria-label="打开相册"
              onClick={(e) => {
                e.stopPropagation();
                setLocked(false);
                open('photos');
              }}
            >
              🖼️
            </button>
            <button
              type="button"
              className={styles.lockDockButton}
              title="通讯录与电话"
              aria-label="通讯录与电话"
              onClick={(e) => {
                e.stopPropagation();
                setLocked(false);
                open('messages');
              }}
            >
              📞
            </button>
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
