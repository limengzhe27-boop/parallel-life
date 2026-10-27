'use client';

import type { PhoneAppsData, PhoneRecordsState } from './apps/types.ts';
import type { PhoneApp, PhonePanel } from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import styles from './phone-desktop.module.css';

/** Compact identity and status; application entries are owned by PhoneShell. */
export function PhoneDesktop({
  title,
  dateLabel,
  timeLabel,
  data,
  open,
}: {
  title: string;
  dateLabel: string;
  timeLabel: string;
  data: PhoneAppsData;
  records?: PhoneRecordsState;
  open: (app: PhoneApp, target?: string) => void;
  openPanel: (panel: PhonePanel) => void;
}) {
  const unread = data.contacts.reduce((sum, contact) => sum + (contact.unread || 0), 0);
  return (
    <div className={styles.desktop} data-phone-desktop>
      <nav className={styles.controls} aria-label="手机与人生导航">
        <a href="/" aria-label="退出手机，返回聊聊">
          <PhoneIcon name="back" />
          <span>返回</span>
        </a>
        <a href="/possibilities" aria-label="切换人生，查看其他手机">
          切换人生
        </a>
      </nav>
      <div className={styles.identity}>
        <span>这段人生</span>
        <strong>{title}</strong>
      </div>
      <div className={styles.statusRow}>
        <time dateTime={data.referenceTime || undefined}>
          {dateLabel} {timeLabel}
        </time>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => open('messages')}
            aria-label={`${unread} 条未读消息`}
          >
            {unread} 条未读
          </button>
        )}
      </div>
    </div>
  );
}
