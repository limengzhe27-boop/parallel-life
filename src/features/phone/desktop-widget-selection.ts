import type { PlayerRecords } from '../../contracts/world-records.ts';
import type { PhoneInvitation, PhonePhoto, PhoneRecordsState } from './apps/types.ts';

type PlayerRecord = PlayerRecords['current'][number];

/** Task wording is presentation only. The current record owns its state and destination. */
export function invitationTask(record: PlayerRecord, referenceTime?: string) {
  if (record.kind !== 'invitation' || record.navigation?.app !== 'calendar') return undefined;
  const task = record.task;
  const at = Date.parse(record.text);
  if (!task || !Number.isFinite(at)) return undefined;
  // The view is keyed to this exact invitation state and its latest source.
  const key = JSON.stringify([record.id, record.state, record.source, record.text]);
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
      const task = invitationTask(record, referenceTime);
      return task && !deferred.includes(task.key) ? [{ record, task }] : [];
    })
    .sort(
      (a, b) =>
        Number(a.task.kind === 'attend_invitation') - Number(b.task.kind === 'attend_invitation') ||
        Number(Boolean(b.task.recommended)) - Number(Boolean(a.task.recommended)) ||
        Number(a.task.at < now) - Number(b.task.at < now) ||
        a.task.at - b.task.at ||
        a.record.id.localeCompare(b.record.id),
    );
  return (
    actionable[0]?.record ??
    current.find(
      (item) =>
        item.kind === 'world_matter' &&
        item.span === 'near_term' &&
        ['in_progress', 'blocked'].includes(item.state),
    ) ??
    current.find(
      (item) =>
        item.kind === 'world_matter' && item.span === 'near_term' && item.state === 'not_started',
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
