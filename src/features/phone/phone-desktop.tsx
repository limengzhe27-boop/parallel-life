'use client';

import { useState } from 'react';
import type { PhoneAppsData } from './apps/types.ts';
import type { PhoneApp, PhonePanel } from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import {
  worldDayKey,
  worldTimeLabel,
  worldWeekday,
} from '../../modules/world/domain/display-time.ts';
import styles from './phone-desktop.module.css';

/** Desktop widgets only read the same authorized projections as the phone apps. */
export function PhoneDesktop({
  title,
  data,
  open,
  openPanel,
}: {
  title: string;
  data: PhoneAppsData;
  open: (app: PhoneApp, target?: string) => void;
  openPanel: (panel: PhonePanel) => void;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const photos = data.photos.filter((photo) => photo.status === 'ready' && photo.url);
  const photo = [...photos].sort((a, b) => b.date.localeCompare(a.date))[0];
  const reference = data.referenceTime ?? '';
  const current = Date.parse(reference);
  const next = data.invitations
    .filter(
      (item) =>
        ['proposed', 'confirmed'].includes(item.status) &&
        Number.isFinite(current) &&
        Date.parse(item.at) >= current,
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const day = worldDayKey(reference);
  const weekday = worldWeekday(reference);
  const nextDay = next ? worldDayKey(next.at) : '';
  const appointmentTime = next
    ? `${nextDay === day ? '今天' : nextDay.slice(5).replace('-', '月') + '日'} ${worldTimeLabel(next.at)}`
    : '';

  return (
    <div className={styles.desktop} data-phone-desktop>
      <nav className={styles.controls} aria-label="手机与人生导航">
        <a href="/" aria-label="退出手机，返回聊聊">
          <PhoneIcon name="back" />
          <span>返回</span>
        </a>
        <a href="/possibilities" aria-label="切换人生，查看其他手机">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" />
          </svg>
          <span>切换人生</span>
        </a>
      </nav>

      <button
        className={styles.identity}
        onClick={() => openPanel('timeline')}
        aria-label={`查看当前身份：${title}`}
      >
        <span>这段人生</span>
        <strong>{title}</strong>
      </button>

      <div className={styles.widgets}>
        <button
          className={styles.calendar}
          onClick={() => open('calendar', next?.id)}
          aria-label={next ? `打开日历：${next.title}，${appointmentTime}` : '打开日历'}
        >
          <span className={styles.weekday}>{weekday || '日历'}</span>
          {day && <strong className={styles.day}>{Number(day.slice(-2))}</strong>}
          <span className={styles.appointment}>
            <span className={styles.appointmentTitle}>{next?.title || '暂无待办日程'}</span>
            {next && (
              <span className={styles.appointmentMeta}>
                {appointmentTime} · {next.status === 'proposed' ? '待回复' : '已约好'}
              </span>
            )}
          </span>
        </button>

        <button
          className={styles.album}
          onClick={() => open('photos')}
          aria-label={`打开相册，${photos.length}张照片`}
        >
          {photo?.url && failedPhoto !== photo.url ? (
            <img
              className={styles.photo}
              src={photo.url}
              alt=""
              onError={() => setFailedPhoto(photo.url)}
            />
          ) : (
            <span className={styles.albumEmpty}>
              <PhoneIcon name="photos" />
              <span>{photos.length ? '打开相册查看' : '还没有照片'}</span>
            </span>
          )}
          <span className={styles.albumCaption}>
            <span>相册</span>
            <small>{photos.length} 张</small>
          </span>
        </button>
      </div>

      <div className={styles.utilities} aria-label="手机工具">
        {(['timeline', 'time', 'management'] as const).map((panel) => (
          <button key={panel} data-panel={panel} onClick={() => openPanel(panel)}>
            <span className={`${styles.utilityIcon} ${styles[panel]}`}>
              {panel === 'time' ? (
                <svg
                  viewBox="0 0 32 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="16" cy="16" r="10.5" />
                  <path d="M16 9v7l5 3" />
                </svg>
              ) : (
                <PhoneIcon name={panel} />
              )}
            </span>
            <span>{panel === 'timeline' ? '身份' : panel === 'time' ? '时间' : '设置'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
