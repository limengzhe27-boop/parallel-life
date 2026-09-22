'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AppTabs } from './app-tabs.tsx';
import { AppViewport } from './app-viewport.tsx';
export function WorkspaceShell({
  children,
  profile,
  footer,
  profileCount = 0,
}: {
  children: ReactNode;
  profile: ReactNode;
  footer?: ReactNode;
  profileCount?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(location.hash === '#profile');
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  function select(tab: 'chat' | 'profile') {
    const next = tab === 'profile';
    if (next === open) return;
    history.pushState(
      history.state,
      '',
      location.pathname + location.search + (next ? '#profile' : ''),
    );
    setOpen(next);
  }
  return (
    <div className="app-workspace">
      <header className="app-header">
        <h1 className="outer-title">{open ? '我的' : '如果'}</h1>
      </header>
      <main className="interview-workspace" hidden={open}>
        <section className="conversation-column" aria-label="认识我的对话">
          <div className="conversation-content">{children}</div>
          {footer}
        </section>
      </main>
      {open && (
        <main className="my-page" aria-label="我的信息">
          {profile}
        </main>
      )}
      <AppTabs active={open ? 'profile' : 'chat'} onSelect={select} profileCount={profileCount} />
      <AppViewport />
    </div>
  );
}
