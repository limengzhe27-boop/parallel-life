import { PUBLICATION_ART, publicationArt } from '../../contracts/publication-assets.ts';
import { deepClone } from './publisher-editor.ts';

export function publisherArtUrl(
  content: Record<string, unknown>,
  mediaKey: string | undefined,
  use: 'avatar' | 'cover',
) {
  if (!mediaKey) return undefined;
  const entry = Array.isArray(content.media)
    ? content.media.find((m) => m?.key === mediaKey)
    : null;
  return publicationArt(entry, use)?.url;
}
/** Selecting curated art is an explicit edit; other people and unselected references are retained. */
export function selectPublisherArt(
  content: Record<string, unknown>,
  use: 'avatar' | 'cover',
  key: string,
  actorKey?: string,
) {
  const next = deepClone(content),
    selected = PUBLICATION_ART.find((a) => a.key === key && a.uses.includes(use));
  if (key && !selected) throw Error('UNKNOWN_PUBLICATION_ART');
  let target: Record<string, unknown>;
  if (use === 'cover') {
    target = (next.work ??= {}) as Record<string, unknown>;
  } else {
    const actor = Array.isArray(next.actors) ? next.actors.find((a) => a?.key === actorKey) : null;
    if (!actor) throw Error('UNKNOWN_ACTOR');
    target = (actor.publicCard ??= {}) as Record<string, unknown>;
  }
  const field = use === 'cover' ? 'coverMediaKey' : 'avatarMediaKey';
  if (!selected) {
    delete target[field];
    return next;
  }
  const list = Array.isArray(next.media) ? next.media : [];
  const prior = list.find((m) => m?.key === key);
  if (prior && !publicationArt(prior, use)) throw Error('MEDIA_KEY_CONFLICT');
  if (!prior)
    list.push({
      key,
      asset: { namespace: 'publication', key, revision: selected.revision },
      use,
      depiction: 'generated_image',
      label: selected.label,
      visibility: { kind: 'world' },
    });
  next.media = list;
  target[field] = key;
  return next;
}
