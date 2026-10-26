import { PUBLICATION_ART } from '../../../contracts/publication-assets.ts';
import { SceneImageUrlSchema } from '../../../contracts/world-space.ts';
import { sceneOverview } from './index-state.ts';
import type { PhoneContact } from '../apps/types.ts';
import type { SceneRead } from '../../../contracts/scenes.ts';
import type { PhonePhoto } from '../apps/types.ts';
/** Require an already authorized world/revision URL; never use the owner-only image endpoint. */
export function scenePhotoUrl(read: SceneRead, assetId: string, photos: readonly PhonePhoto[]) {
  const photo = photos.find((item) => item.id === assetId && item.status === 'ready');
  if (!photo?.url || !read.scene || !photo.url.startsWith('/api/v1/assets/')) return undefined;
  const url = new URL(photo.url, 'https://scene.invalid');
  const revision = Number(url.searchParams.get('revision'));
  return url.pathname === '/api/v1/assets/' + assetId &&
    url.searchParams.get('worldId') === read.scene.worldId &&
    Number.isInteger(revision) &&
    revision > 0
    ? photo.url
    : undefined;
}
/** Presentation consumes only the current scene's player-visible persisted entries. */
export function visibleSceneEntries(read: SceneRead) {
  return read.entries.filter(
    (entry) =>
      read.scene &&
      entry.sceneId === read.scene.id &&
      entry.worldId === read.scene.worldId &&
      entry.ownerId === read.scene.ownerId &&
      entry.sourceVersion <= read.worldVersion &&
      entry.observableTo.some((observer) => observer.kind === 'player') &&
      (entry.kind !== 'media_reference' ||
        (entry.media.worldId === entry.worldId &&
          entry.media.ownerId === entry.ownerId &&
          entry.media.sourceVersion <= entry.sourceVersion &&
          (entry.media.purpose === 'scene_reference' ||
            (entry.media.purpose === 'scene_illustration' &&
              entry.media.sourceEventId === entry.sourceEventId)))),
  );
}
export function sceneArtwork(read: SceneRead, photos: readonly PhonePhoto[] = []) {
  const entries = visibleSceneEntries(read);
  const place = entries.filter((entry) => entry.kind === 'time_place').at(-1);
  const image = entries
    .filter(
      (entry) =>
        entry.kind === 'media_reference' &&
        entry.media.purpose === 'scene_illustration' &&
        entry.media.worldId === entry.worldId &&
        entry.media.ownerId === entry.ownerId &&
        entry.media.sourceVersion <= read.worldVersion &&
        entry.sourceVersion >= (place?.sourceVersion ?? 0),
    )
    .at(-1);
  const backgrounds: Record<string, string> = {
    repair_shop: 'garage',
    old_workshop: 'garage',
    lin_home: 'dining-room',
  };
  const fallbackUrl =
    '/art/scenes/' + (backgrounds[read.scene?.placeId ?? ''] ?? 'interior') + '.svg';
  const eventImageUrl =
    image?.kind === 'media_reference'
      ? scenePhotoUrl(read, image.media.assetId, photos)
      : undefined;
  const imageUrl = eventImageUrl ?? (read.scene ? read.sceneImageUrl : undefined);
  return {
    url: imageUrl ?? fallbackUrl,
    fallbackUrl,
    illustration: !imageUrl,
    authored: Boolean(imageUrl && !eventImageUrl),
    location: place?.kind === 'time_place' ? place.location : (read.scene?.title ?? '现场'),
  };
}

/** Match explicit visual identity, never the character's name or the world's title. */
export function scenePortraits(read: SceneRead, contacts: readonly PhoneContact[]) {
  const present = sceneOverview(read).people;
  return present.flatMap((participant) => {
    if (participant.kind !== 'actor') return [];
    const person = contacts.find((p) => p.id === participant.actorId);
    if (!person) return [];
    const uploaded = read.actorImages?.find((image) => image.actorId === person.id);
    const validUpload =
      uploaded &&
      SceneImageUrlSchema.safeParse(uploaded.url).success &&
      (uploaded.url.startsWith(`/api/v1/worlds/${read.scene!.worldId}/media/`) ||
        /^\/api\/v1\/publisher\/trials\/[0-9a-f-]{36}\/world\/media\/[0-9a-f-]{36}$/.test(
          uploaded.url,
        ));
    const original =
      person.avatarKind === 'publication-art'
        ? PUBLICATION_ART.find((art) => art.uses.includes('avatar') && art.url === person.avatarUrl)
        : undefined;
    const url = validUpload ? uploaded.url : original?.scenePortrait?.url;
    return url ? [{ actorId: person.id, name: person.name, url }] : [];
  });
}
