'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, Modal } from './ui.tsx';
import { AppTabs } from './app-tabs.tsx';
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
  function show() {
    history.pushState({ ...history.state, plPanel: true }, '', '#profile');
    setOpen(true);
  }
  function close() {
    setOpen(false);
    if (history.state?.plPanel && location.hash === '#profile') history.back();
    else history.replaceState(history.state, '', location.pathname + location.search);
  }
  return (
    <div className="app-workspace">
      <header className="app-header">
        <a href="/" className="wordmark" aria-label="如果，回到聊天">
          如果<span className="wordmark-dot">✳</span>
        </a>
        <Button variant="ghost" className="mobile-profile" onClick={show} aria-label="打开我的故事">
          <Icon name="book" size={20} />
          我的故事{profileCount > 0 && <span className="count-dot">{profileCount}</span>}
        </Button>
      </header>
      <main className="interview-workspace">
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
      <AppTabs active={open ? 'profile' : 'chat'} onProfile={show} />
      <Modal open={open} onClose={close} title="我的故事" className="profile-modal">
        {open && profile}
      </Modal>
    </div>
  );
}
