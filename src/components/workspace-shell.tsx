'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './ui.tsx';
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
        <a href="/" className="wordmark" aria-label="如果，回到聊天">
          如果<span className="wordmark-dot">✳</span>
        </a>
        <span className="workspace-caption">{open ? '我的' : '和自己，聊出另一种可能'}</span>
      </header>
      <main className="interview-workspace" hidden={open}>
        <section className="conversation-column" aria-label="认识我的对话">
          <div className="conversation-heading">
            <div className="agent-symbol">
              <Icon name="spark" size={22} />
            </div>
            <div>
              <h2>如果 · 你的倾听者</h2>
              <span>从最近的你，慢慢聊起。</span>
            </div>
            <Icon name="lock" size={15} />
          </div>
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
