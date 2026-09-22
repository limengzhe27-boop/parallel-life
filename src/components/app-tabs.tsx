'use client';
import { useEffect } from 'react';
import { Icon } from './ui.tsx';
export function AppTabs({
  active,
  onProfile,
}: {
  active: 'chat' | 'possibilities' | 'profile';
  onProfile?: () => void;
}) {
  useEffect(() => {
    const resize = () =>
      document.documentElement.style.setProperty(
        '--app-height',
        `${window.visualViewport?.height ?? innerHeight}px`,
      );
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
  return (
    <nav className="app-tabs" aria-label="主导航">
      <a href="/" aria-current={active === 'chat' ? 'page' : undefined}>
        <Icon name="chat" size={23} />
        <span>聊聊</span>
      </a>
      <a href="/possibilities" aria-current={active === 'possibilities' ? 'page' : undefined}>
        <Icon name="spark" size={24} />
        <span>如果</span>
      </a>
      {onProfile ? (
        <button onClick={onProfile} aria-current={active === 'profile' ? 'page' : undefined}>
          <Icon name="user" size={23} />
          <span>我的</span>
        </button>
      ) : (
        <a href="/#profile">
          <Icon name="user" size={23} />
          <span>我的</span>
        </a>
      )}
    </nav>
  );
}
