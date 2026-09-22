'use client';
import { Icon } from './ui.tsx';
export function AppTabs({
  active,
  onSelect,
  profileCount = 0,
}: {
  active: 'chat' | 'possibilities' | 'profile';
  onSelect?: (tab: 'chat' | 'profile') => void;
  profileCount?: number;
}) {
  return (
    <nav className="app-tabs" aria-label="主导航">
      <a
        href="/"
        aria-current={active === 'chat' ? 'page' : undefined}
        onClick={
          onSelect
            ? (event) => {
                event.preventDefault();
                onSelect('chat');
              }
            : undefined
        }
      >
        <Icon name="chat" size={23} />
        <span>聊聊</span>
      </a>
      <a href="/possibilities" aria-current={active === 'possibilities' ? 'page' : undefined}>
        <Icon name="spark" size={23} />
        <span>如果</span>
      </a>
      <a
        href="/#profile"
        aria-current={active === 'profile' ? 'page' : undefined}
        onClick={
          onSelect
            ? (event) => {
                event.preventDefault();
                onSelect('profile');
              }
            : undefined
        }
      >
        <span className="tab-icon">
          <Icon name="user" size={23} />
          {profileCount > 0 && <i aria-label={`${profileCount} 条信息待确认`} />}
        </span>
        <span>我的</span>
      </a>
    </nav>
  );
}
