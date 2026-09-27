'use client';
import type { PhoneAppContext } from '../phone-shell.tsx';
import { Empty } from './common.tsx';
import s from './apps.module.css';

/** There is no persisted moments feed yet. Do not invent posts or social reactions. */
export function MomentsApp({ open }: PhoneAppContext) {
  return (
    <div className={s.app}>
      <header className={s.sectionHeading}>
        <button type="button" onClick={() => open('messages')} aria-label="返回消息">
          ‹
        </button>
        <h2>朋友圈</h2>
      </header>
      <Empty title="朋友圈尚未开放" text="朋友的动态将在这里与你见面。" />
    </div>
  );
}
