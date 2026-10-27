import type { PlayerRecords } from '../../contracts/world-records.ts';
import type { PhoneInvitation, PhonePhoto, PhoneRecordsState } from './apps/types.ts';

type PlayerRecord = PlayerRecords['current'][number];

/** Read only the player's current, explicitly recorded work; never borrow NPC plans or notes. */
export function selectDesktopTask(
  records: PhoneRecordsState | undefined,
): PlayerRecord | undefined {
  if (records?.status !== 'ready') return undefined;
  const current = records.data.current;
  return (
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
