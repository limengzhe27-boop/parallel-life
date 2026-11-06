import type { PlayerRecords } from '../../contracts/world-records.ts';
import type { PhoneInvitation, PhonePhoto, PhoneRecordsState } from './apps/types.ts';

type PlayerRecord = PlayerRecords['current'][number];

function taskKey(record: PlayerRecord) {
  return JSON.stringify([
    record.id,
    record.state,
    record.source,
    record.text,
    record.task?.stepTitle,
  ]);
}

/** Task wording is presentation only. The current record owns its state and destination. */
export function invitationTask(record: PlayerRecord, referenceTime?: string) {
  if (record.kind !== 'invitation' || record.navigation?.app !== 'calendar') return undefined;
  const task = record.task;
  const at = Date.parse(record.text);
  if (!task || !Number.isFinite(at)) return undefined;
  // The view is keyed to this exact invitation state and its latest source.
  const key = taskKey(record);
  if (task.kind === 'decide_invitation' && record.state === 'proposed') {
    if (at < Date.parse(referenceTime ?? '')) return undefined;
    return {
      ...task,
      key,
      at,
      title: `决定是否参加：${record.title}`,
      stateLabel: '待你决定',
      actionLabel: '查看邀约',
    };
  }
  if (task.kind === 'attend_invitation' && record.state === 'confirmed')
    return {
      ...task,
      key,
      at,
      title: `赴约：${record.title}`,
      stateLabel: '已安排',
      actionLabel: '查看日程',
    };
  return undefined;
}

/** Requests enter this view only through the evidence-backed records contract. */
export function playerTask(record: PlayerRecord, referenceTime?: string) {
  if (
    record.task?.kind === 'address_request' &&
    record.kind === 'actor_suggestion' &&
    record.state === 'suggested' &&
    record.navigation?.app === 'wechat'
  )
    return {
      ...record.task,
      key: taskKey(record),
      at: record.source.kind === 'world_event' ? Date.parse(record.source.at) : Infinity,
      title: record.title,
      stateLabel: '待你处理',
      actionLabel: '去商量',
    };
  if (
    record.task?.kind === 'scene_action' &&
    record.kind === 'world_matter' &&
    ['not_started', 'in_progress'].includes(record.state) &&
    record.navigation?.app === 'map'
  )
    return {
      ...record.task,
      key: taskKey(record),
      at: Infinity,
      title: record.task.stepTitle ?? record.title,
      stateLabel: '现场待办',
      actionLabel: '查看地点',
    };
  return invitationTask(record, referenceTime);
}

const taskPriority = {
  decide_invitation: 0,
  scene_action: 1,
  address_request: 2,
  attend_invitation: 3,
};

function taskUpdatedAt(record: PlayerRecord): number {
  const source = record.source;
  const time = 'at' in source && source.timeBasis === 'story' ? Date.parse(source.at) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** Read only the player's current, explicitly recorded work; never borrow NPC plans or notes. */
export function selectDesktopTask(
  records: PhoneRecordsState | undefined,
  referenceTime?: string,
  deferred: readonly string[] = [],
): PlayerRecord | undefined {
  if (records?.status !== 'ready') return undefined;
  const current = records.data.current;
  const now = Date.parse(referenceTime ?? '');
  const actionable = current
    .flatMap((record) => {
      const task = playerTask(record, referenceTime);
      return task && !deferred.includes(task.key) ? [{ record, task }] : [];
    })
    .sort(
      (a, b) =>
        Number(a.task.kind === 'attend_invitation') - Number(b.task.kind === 'attend_invitation') ||
        (a.task.kind !== 'attend_invitation' && b.task.kind !== 'attend_invitation'
          ? taskUpdatedAt(b.record) - taskUpdatedAt(a.record)
          : 0) ||
        taskPriority[a.task.kind] - taskPriority[b.task.kind] ||
        Number(Boolean(b.task.recommended)) - Number(Boolean(a.task.recommended)) ||
        (a.task.kind === 'address_request' && b.task.kind === 'address_request'
          ? b.task.at - a.task.at
          : Number(a.task.at < now) - Number(b.task.at < now) || a.task.at - b.task.at) ||
        a.record.id.localeCompare(b.record.id),
    );
  return (
    actionable[0]?.record ??
    current.find(
      (item) =>
        item.kind === 'world_matter' &&
        item.navigation?.app !== 'map' &&
        item.span === 'near_term' &&
        ['in_progress', 'blocked'].includes(item.state),
    ) ??
    current.find(
      (item) =>
        item.kind === 'world_matter' &&
        item.navigation?.app !== 'map' &&
        item.span === 'near_term' &&
        item.state === 'not_started',
    ) ??
    current.find(
      (item) => item.kind === 'player_choice' && ['planned', 'blocked'].includes(item.state),
    )
  );
}

/** A proposal remains a proposal. Confirmed future arrangements take precedence. */
export function selectDesktopSchedule(
  invitations: readonly PhoneInvitation[],
  referenceTime: string | undefined,
): PhoneInvitation | undefined {
  const now = Date.parse(referenceTime ?? '');
  if (!Number.isFinite(now)) return undefined;
  const upcoming = invitations
    .filter(
      (item) =>
        ['confirmed', 'proposed'].includes(item.status) &&
        Number.isFinite(Date.parse(item.at)) &&
        Date.parse(item.at) >= now,
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return (
    upcoming.find((item) => item.status === 'confirmed') ??
    upcoming.find((item) => item.status === 'proposed')
  );
}

export function selectDesktopPhoto(photos: readonly PhonePhoto[]): PhonePhoto | undefined {
  return photos
    .filter(
      (photo) =>
        photo.status === 'ready' &&
        !!photo.url &&
        photo.mediaType !== 'video' &&
        !photo.mimeType?.startsWith('video/'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0];
}
