import type { PhoneContact, PhonePhoto } from './types.ts';

export type PhotoAlbum = { id: string; title: string; photos: readonly PhonePhoto[] };
export type PhotoView =
  | { kind: 'library' | 'albums' }
  | { kind: 'collection'; album: PhotoAlbum }
  | { kind: 'photo'; photo: PhonePhoto; back?: string }
  | { kind: 'missing' };

/** Display dates are supplied by the server; unknown dates are never filled with today's date. */
export function photoDay(date: string): string {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? '日期未记录'
    : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(value);
}
export function photoDateLabel(date: string): string {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? '日期未记录'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(value);
}
export function sortedPhotos(photos: readonly PhonePhoto[]): PhonePhoto[] {
  return [...photos].sort((a, b) => {
    const at = Date.parse(a.date),
      bt = Date.parse(b.date);
    return (Number.isNaN(bt) ? -Infinity : bt) - (Number.isNaN(at) ? -Infinity : at) || 0;
  });
}
export function photoGroups(photos: readonly PhonePhoto[]) {
  const groups = new Map<string, { id: string; label: string; photos: PhonePhoto[] }>();
  for (const photo of sortedPhotos(photos)) {
    const id = photoDay(photo.date);
    if (!groups.has(id)) groups.set(id, { id, label: photoDateLabel(photo.date), photos: [] });
    groups.get(id)!.photos.push(photo);
  }
  return [...groups.values()];
}
/** A person's name in a caption is not evidence that a photograph depicts them. */
export function photoAlbums(
  photos: readonly PhonePhoto[],
  contacts: readonly PhoneContact[],
): PhotoAlbum[] {
  const ordered = sortedPhotos(photos);
  const albums: PhotoAlbum[] = [
    { id: 'all', title: '全部照片', photos: ordered },
    {
      id: 'uploads',
      title: '添加的照片',
      photos: ordered.filter((p) => p.tag === 'upload' || !!p.sourcePersonId),
    },
    { id: 'identity', title: '身份照片', photos: ordered.filter((p) => p.tag === 'identity') },
    { id: 'events', title: '故事照片', photos: ordered.filter((p) => p.tag === 'event') },
    {
      id: 'memories',
      title: '回忆',
      photos: ordered.filter((p) => p.tag === 'memory' && !p.sourcePersonId),
    },
  ];
  const seen = new Set<string>();
  for (const contact of contacts) {
    if (!contact.sourcePersonId || seen.has(contact.sourcePersonId)) continue;
    seen.add(contact.sourcePersonId);
    const images = ordered.filter((p) => p.sourcePersonId === contact.sourcePersonId);
    if (images.length)
      albums.push({ id: `person:${contact.id}`, title: contact.name, photos: images });
  }
  return albums.filter((album) => album.id === 'all' || album.photos.length > 0);
}
export function photoSourceLabel(photo: PhonePhoto): string {
  if (photo.sourcePersonId) return '带入的人物照片';
  if (photo.tag === 'upload') return '添加的照片';
  if (photo.tag === 'identity') return '身份照片';
  if (photo.tag === 'event') return '故事照片';
  return '相册记录';
}
export function photoTarget(id: string, back?: string): string {
  if (!back) return id; // Existing message links still use the original photo ID.
  const target = `photo?${new URLSearchParams({ id, back })}`;
  return target.length <= 256 ? target : id;
}
export function readPhotoView(
  target: string | undefined,
  photos: readonly PhonePhoto[],
  albums: readonly PhotoAlbum[],
): PhotoView {
  if (!target) return { kind: 'library' };
  // Real IDs take precedence over UI navigation labels.
  const direct = photos.find((p) => p.id === target);
  if (direct) return { kind: 'photo', photo: direct };
  if (target === 'albums') return { kind: 'albums' };
  if (target.startsWith('album:')) {
    const album = albums.find((a) => a.id === target.slice(6));
    return album ? { kind: 'collection', album } : { kind: 'missing' };
  }
  if (target.startsWith('photo?')) {
    const params = new URLSearchParams(target.slice(6));
    const photo = photos.find((p) => p.id === params.get('id'));
    const from = params.get('back');
    const back =
      from === 'albums' || albums.some((a) => `album:${a.id}` === from) ? from! : undefined;
    return photo ? { kind: 'photo', photo, back } : { kind: 'missing' };
  }
  return { kind: 'missing' };
}
