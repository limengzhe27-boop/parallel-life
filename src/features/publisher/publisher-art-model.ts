import { PUBLICATION_ART, publicationArt } from '../../contracts/publication-assets.ts';
import { deepClone } from './publisher-editor.ts';

export function publisherArtUrl(
  content: Record<string, unknown>,
  mediaKey: string | undefined,
  use: 'avatar' | 'cover',
) {
  if (!mediaKey) return undefined;
  if (typeof mediaKey === 'string' && (mediaKey.startsWith('data:') || mediaKey.startsWith('http://') || mediaKey.startsWith('https://') || mediaKey.startsWith('/'))) {
    return mediaKey;
  }
  const entry = Array.isArray(content.media)
    ? (content.media.find((m) => m?.key === mediaKey) as Record<string, any> | undefined)
    : null;
  if (entry && typeof entry.url === 'string' && entry.url) {
    return entry.url;
  }
  return publicationArt(entry, use)?.url;
}
/** Selecting curated art is an explicit edit; other people and unselected references are retained. */
export function selectPublisherArt(
  content: Record<string, unknown>,
  use: 'avatar' | 'cover',
  key: string,
  actorKey?: string,
) {
  const next = deepClone(content);
  const list = Array.isArray(next.media) ? [...next.media] : [];
  const selected = PUBLICATION_ART.find((a) => a.key === key && a.uses.includes(use));
  const custom = list.find((m) => m?.key === key && m?.use === use);
  if (key && !selected && !custom) throw Error('UNKNOWN_PUBLICATION_ART');
  let target: Record<string, unknown>;
  if (use === 'cover') {
    target = (next.work ??= {}) as Record<string, unknown>;
  } else {
    const actor = Array.isArray(next.actors) ? next.actors.find((a) => a?.key === actorKey) : null;
    if (!actor) throw Error('UNKNOWN_ACTOR');
    target = (actor.publicCard ??= {}) as Record<string, unknown>;
  }
  const field = use === 'cover' ? 'coverMediaKey' : 'avatarMediaKey';
  if (!selected && !custom) {
    delete target[field];
    return next;
  }
  if (selected && !custom) {
    const prior = list.find((m) => m?.key === key);
    if (!prior) {
      list.push({
        key,
        asset: { namespace: 'publication', key, revision: selected.revision },
        use,
        depiction: 'generated_image',
        label: selected.label,
        visibility: { kind: 'world' },
      });
    }
  }
  next.media = list;
  target[field] = key;
  return next;
}

/** Imports a custom local image data URL as publisher art (avatar or cover). */
export function importCustomPublisherArt(
  content: Record<string, unknown>,
  use: 'avatar' | 'cover',
  dataUrl: string,
  actorKey?: string,
  label = '自定义导入头像',
) {
  const next = deepClone(content);
  const key = `img_${use}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  let target: Record<string, unknown>;
  if (use === 'cover') {
    target = (next.work ??= {}) as Record<string, unknown>;
  } else {
    const actor = Array.isArray(next.actors) ? next.actors.find((a) => a?.key === actorKey) : null;
    if (!actor) throw Error('UNKNOWN_ACTOR');
    target = (actor.publicCard ??= {}) as Record<string, unknown>;
  }
  const field = use === 'cover' ? 'coverMediaKey' : 'avatarMediaKey';
  const list = Array.isArray(next.media) ? [...next.media] : [];
  list.push({
    key,
    asset: { namespace: 'publication', key, revision: 1 },
    url: dataUrl,
    use,
    depiction: 'uploaded_image',
    label,
    visibility: { kind: 'world' },
  });
  next.media = list;
  target[field] = key;
  return next;
}

