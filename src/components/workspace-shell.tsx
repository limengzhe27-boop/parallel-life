'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Brand, Button, Icon, Modal } from './ui.tsx';
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
    const resize = () =>
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? innerHeight}px`,
      );
    resize();
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.visualViewport?.removeEventListener('resize', resize);
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
        <Brand />
        <nav className="journey" aria-label="当前体验阶段">
          <span className="journey-current">
            <i />
            认识自己
          </span>
          <span className="journey-line" />
          <span>另一种可能</span>
          <span className="journey-line" />
          <span>平行人生</span>
        </nav>
        <span className="private-label">
          <Icon name="lock" size={14} />
          只属于你的空间
        </span>
        <Button variant="secondary" className="mobile-profile" onClick={show}>
          <Icon name="user" size={17} />
          我的档案{profileCount > 0 && <span className="count-dot">{profileCount}</span>}
        </Button>
      </header>
      <main className="interview-workspace">
        <section className="conversation-column" aria-label="认识我的对话">
          <div className="conversation-heading">
            <div className="agent-symbol">
              <Icon name="spark" size={22} />
            </div>
            <div>
              <h2>人生访谈</h2>
              <span>故事的起点，是此刻的你。</span>
            </div>
            <span className="conversation-kind">PERSONAL SPACE</span>
          </div>
          <div className="conversation-content">{children}</div>
          {footer}
        </section>
        <aside className="profile-aside" aria-label="现实中的我">
          {profile}
        </aside>
      </main>
      <Modal open={open} onClose={close} title="现实中的我" className="profile-modal">
        {open && profile}
      </Modal>
    </div>
  );
}
