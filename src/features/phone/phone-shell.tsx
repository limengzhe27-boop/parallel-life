'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  homeRoute,
  parentRoute,
  phoneApps,
  readRoute,
  routeHash,
  scrollKey,
  type PhoneApp,
  type PhonePanel,
  type PhoneRoute,
} from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import styles from './phone.module.css';

const apps: Record<PhoneApp, string> = {
  messages: '消息',
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
  notice?: ReactNode;
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
  notice,
}: PhoneShellProps) {
  const [route, setRoute] = useState<PhoneRoute>(homeRoute);
  const [failedUrl, setFailedUrl] = useState<string>();
  const wallpaper = useRef<HTMLImageElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const lastPanel = useRef<PhonePanel | undefined>(undefined);
  const key = scrollKey(worldId, route);

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
    if (scroll.current) scroll.current.scrollTop = positions.current.get(key) ?? 0;
  }, [key]);
  useLayoutEffect(() => {
    if (route.panel && panelScroll.current)
      panelScroll.current.scrollTop = positions.current.get(`panel:${route.panel}`) ?? 0;
    if (!route.panel && lastPanel.current) {
      const trigger = root.current?.querySelector<HTMLButtonElement>(
        `[data-panel="${lastPanel.current}"]`,
      );
      (trigger ?? heading.current)?.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
    lastPanel.current = route.panel;
  }, [key, route.panel]);

  function navigate(next: PhoneRoute) {
    const hash = routeHash(worldId, next);
    if (location.hash === hash) return;
    if (scroll.current && !route.panel) positions.current.set(key, scroll.current.scrollTop);
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
  function appButton(app: PhoneApp) {
    return (
      <button key={app} data-app={app} className={styles.launcher} onClick={() => open(app)}>
        <span className={`${styles.appIcon} ${styles[app]}`}>
          <PhoneIcon name={app} />
        </span>
        <span>{apps[app]}</span>
      </button>
    );
  }
  function panelButton(panel: PhonePanel) {
    return (
      <button
        key={panel}
        data-panel={panel}
        className={styles.launcher}
        onClick={() => navigate({ ...route, panel })}
      >
        <span className={`${styles.appIcon} ${styles[panel]}`}>
          <PhoneIcon name={panel} />
        </span>
        <span>{panels[panel]}</span>
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
      data-screen={isHome ? 'home' : 'page'}
      aria-label={`${lifeName}的手机`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !isHome) {
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
      <header className={styles.header}>
        {isHome ? (
          <span className={styles.lifeLabel}>{lifeName}</span>
        ) : (
          <button
            className={styles.headerButton}
            aria-label={route.panel ? '关闭辅助页面' : '返回上一页'}
            onClick={back}
          >
            <PhoneIcon name="back" />
            <span>返回</span>
          </button>
        )}
        {!isHome && <span className={styles.smallTime}>{timeLabel}</span>}
        {!isHome && (
          <button
            className={styles.headerButton}
            aria-label="回到手机桌面"
            onClick={() => navigate(homeRoute)}
          >
            <PhoneIcon name="home" />
          </button>
        )}
      </header>
      <h2 ref={heading} tabIndex={-1} className={isHome ? styles.srOnly : styles.title}>
        {label}
      </h2>
      <div
        ref={scroll}
        hidden={!!route.panel}
        className={styles.scroll}
        data-phone-scroll
        onScroll={(event) => {
          if (!route.panel) positions.current.set(key, event.currentTarget.scrollTop);
        }}
      >
        {!route.app ? (
          <div className={styles.home}>
            <div className={styles.clock}>
              <span>{timeLabel}</span>
              <p>{dateLabel}</p>
            </div>
            <section
              className={styles.notifications}
              aria-label="通知"
              aria-live="polite"
              aria-relevant="additions"
            >
              {notifications.length ? (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className={styles.notification}
                    onClick={() => open(n.app, n.target)}
                  >
                    <span className={`${styles.notificationIcon} ${styles[n.app]}`}>
                      <PhoneIcon name={n.app} />
                    </span>
                    <span>
                      <small>{apps[n.app]}</small>
                      <strong>{n.title}</strong>
                      <span>{n.summary}</span>
                    </span>
                    <PhoneIcon name="next" />
                  </button>
                ))
              ) : (
                <p className={styles.quiet}>暂时没有新通知</p>
              )}
            </section>
            <nav className={styles.launchers} aria-label="桌面应用与生活工具">
              {panelButton('management')}
            </nav>
          </div>
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
          onScroll={(event) =>
            positions.current.set(`panel:${route.panel}`, event.currentTarget.scrollTop)
          }
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
              <p>切换人生、暂停、账号和删除将在对应存档能力接入后开放。</p>
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
          {phoneApps.filter((app) => app !== 'moments').map(appButton)}
        </nav>
      )}
    </section>
  );
}
