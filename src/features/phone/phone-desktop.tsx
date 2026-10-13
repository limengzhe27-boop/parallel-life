'use client';

import { useState } from 'react';
import type { PhoneAppsData, PhoneRecordsState } from './apps/types.ts';
import type { PhoneApp, PhonePanel } from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { recordAttribution } from './apps/notes-records.tsx';
import {
  worldDayKey,
  worldTimeLabel,
  worldWeekday,
} from '../../modules/world/domain/display-time.ts';
import styles from './phone-desktop.module.css';

/** Desktop widgets only read the same authorized projections as the phone apps. */
export function PhoneDesktop({
  title,
  dateLabel,
  timeLabel,
  data,
  records,
  open,
  openPanel,
}: {
  title: string;
  dateLabel: string;
  timeLabel: string;
  data: PhoneAppsData;
  records?: PhoneRecordsState;
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
  const note = [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const choice = [...(data.choices ?? [])]
    .filter(
      (item) =>
        item.status !== 'superseded' &&
        item.result?.kind !== 'reported_done' &&
        item.result?.kind !== 'abandoned',
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const record = choice?.intent || note?.title;

  // Key matter card: priority to active near-term matter or pursuit
  const currentItems = records?.status === 'ready' ? records.data.current : [];
  const aboutItems = records?.status === 'ready' ? records.data.about : [];
  const activeMatter =
    currentItems.find(
      (item) =>
        item.kind === 'world_matter' && (item.state === 'in_progress' || item.state === 'blocked'),
    ) ??
    currentItems.find(
      (item) =>
        item.kind === 'world_matter' && item.state !== 'completed' && item.state !== 'abandoned',
    );
  const currentItem = currentItems.find(
    (item) => item.kind === 'invitation' || item.kind === 'actor_suggestion',
  );
  const pursuitItem = aboutItems.find(
    (item) => item.span === 'pursuit' && item.state !== 'completed' && item.state !== 'abandoned',
  );
  const keyRecord = activeMatter ?? currentItem ?? pursuitItem;

  let cardLabel = '备忘录';
  let cardTitle = '';
  let cardMeta: string | undefined;
  let cardTarget: string | undefined;

  if (keyRecord) {
    if (keyRecord.kind === 'world_matter' && keyRecord.span === 'pursuit') {
      cardLabel = '长期追求';
    } else if (keyRecord.kind === 'world_matter') {
      cardLabel = '眼下要做的事';
    } else if (keyRecord.kind === 'actor_suggestion') {
      cardLabel = '人物建议';
    } else if (keyRecord.kind === 'invitation') {
      cardLabel = '待办邀约';
    } else {
      cardLabel = '备忘事项';
    }
    cardTitle = keyRecord.title;
    cardMeta = [keyRecord.stateLabel, recordAttribution(keyRecord)].filter(Boolean).join(' · ');
    cardTarget = keyRecord.id;
  } else {
    cardLabel = '备忘录';
    cardTitle = record || '还没有记录';
    cardTarget = undefined;
  }
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

      <time className={styles.storyTime} dateTime={reference || undefined}>
        {dateLabel} {timeLabel}
      </time>

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

      <button
        className={styles.record}
        onClick={() => (keyRecord ? open('records', cardTarget) : open('notes', cardTarget))}
        aria-label={
          keyRecord
            ? `打开人生记录事项：${cardTitle}，${cardMeta ?? ''}`
            : record
              ? `打开备忘录：${record}`
              : '打开备忘录'
        }
      >
        <span className={styles.recordIcon}>
          <PhoneIcon name={keyRecord ? 'records' : 'notes'} variant="app" />
        </span>
        <span className={styles.recordBody}>
          <span className={styles.recordLabel}>{cardLabel}</span>
          <strong>{cardTitle}</strong>
          {cardMeta && <span className={styles.recordMeta}>{cardMeta}</span>}
        </span>
        <PhoneIcon name="next" />
      </button>

      <div className={styles.utilities} aria-label="手机工具">
        <button data-panel="scenes" onClick={() => open('scenes')}>
          <span className={`${styles.utilityIcon} ${styles.scenes || ''}`}>
            <PhoneIcon name="scenes" variant="app" />
          </span>
          <span>现场</span>
        </button>
        <button data-panel="records" onClick={() => open('records')}>
          <span className={`${styles.utilityIcon} ${styles.records || ''}`}>
            <PhoneIcon name="records" variant="app" />
          </span>
          <span>记录</span>
        </button>
        <button data-panel="timeline" onClick={() => openPanel('timeline')}>
          <span className={`${styles.utilityIcon} ${styles.timeline || ''}`}>
            <PhoneIcon name="timeline" variant="app" />
          </span>
          <span>身份</span>
        </button>
      </div>
    </div>
  );
}
