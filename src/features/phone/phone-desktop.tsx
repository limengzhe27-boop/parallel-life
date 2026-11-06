'use client';

import { useState } from 'react';
import { usePhoneTaskDeferrals } from './apps/provider.tsx';
import type { PhoneAppsData, PhoneRecordsState } from './apps/types.ts';
import type { PhoneApp, PhonePanel } from './navigation.ts';
import { PhoneIcon } from './phone-icons.tsx';
import { worldDayKey, worldTimeLabel } from '../../modules/world/domain/display-time.ts';
import {
  invitationTask,
  selectDesktopPhoto,
  selectDesktopSchedule,
  selectDesktopTask,
} from './desktop-widget-selection.ts';
import styles from './phone-desktop.module.css';

/** Compact read-only widgets; application entries and unread badges belong to PhoneShell. */
export function PhoneDesktop({
  title,
  dateLabel,
  timeLabel,
  data,
  records,
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
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const schedule = selectDesktopSchedule(data.invitations, data.referenceTime);
  const photo = selectDesktopPhoto(data.photos);
  const taskDeferrals = usePhoneTaskDeferrals();
  const task = selectDesktopTask(records, data.referenceTime, taskDeferrals?.keys);
  const invitation = task && invitationTask(task, data.referenceTime);
  const taskTitle = invitation?.title ?? task?.title;
  const taskState = invitation?.stateLabel ?? task?.stateLabel;
  const scheduleDay = schedule ? worldDayKey(schedule.at) : '';
  const today = worldDayKey(data.referenceTime ?? '');
  const scheduleTime = schedule
    ? `${scheduleDay === today ? '今天' : scheduleDay.slice(5).replace('-', '月') + '日'} ${worldTimeLabel(schedule.at)}`
    : '';
  const taskEmpty =
    records?.status === 'error'
      ? '任务暂未读取，点此查看'
      : records?.status === 'loading'
        ? '正在读取任务'
        : records?.status === 'ready'
          ? '暂无眼下任务'
          : '点此查看任务';

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
      <header className={styles.identity}>
        <strong title={title}>{title}</strong>
        <time dateTime={data.referenceTime || undefined}>
          {dateLabel} {timeLabel}
        </time>
      </header>
      <div className={styles.widgets}>
        <button
          type="button"
          className={styles.schedule}
          onClick={() => open('calendar', schedule?.id)}
          aria-label={
            schedule
              ? `打开日历：${schedule.title}，${schedule.status === 'confirmed' ? '已确认' : '待确认'}，${scheduleTime}`
              : '打开日历，暂无即将到来的日程'
          }
        >
          <span className={styles.cardLabel}>
            <PhoneIcon name="calendar" />
            日程
          </span>
          <strong>{schedule?.title || '暂无即将到来的日程'}</strong>
          {schedule && (
            <span className={styles.scheduleMeta}>
              {scheduleTime} · {schedule.status === 'confirmed' ? '已确认' : '待确认'}
            </span>
          )}
        </button>
        <button
          type="button"
          className={styles.photo}
          onClick={() => open('photos', photo?.id)}
          aria-label={photo ? `打开最近照片：${photo.title}` : '打开相册，暂无照片'}
        >
          {photo && failedPhoto !== photo.url ? (
            <img src={photo.url} alt={photo.title} onError={() => setFailedPhoto(photo.url)} />
          ) : (
            <span className={styles.photoEmpty}>
              <PhoneIcon name="photos" />
              <span>{photo ? '照片暂时无法显示' : '暂无照片'}</span>
            </span>
          )}
          <span className={styles.photoLabel}>最近照片</span>
        </button>
      </div>
      <button
        type="button"
        className={styles.task}
        onClick={() => open('records', task?.id)}
        aria-label={task ? `眼下任务：${taskTitle}，${taskState}` : taskEmpty}
      >
        <span className={styles.taskIcon}>
          <PhoneIcon name="records" />
        </span>
        <span className={styles.taskBody}>
          <span>眼下任务</span>
          <strong>{taskTitle || taskEmpty}</strong>
        </span>
        {task && <span className={styles.taskState}>{taskState}</span>}
        <PhoneIcon name="next" />
      </button>
    </div>
  );
}
