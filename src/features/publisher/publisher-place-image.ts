type Row = Record<string, unknown>;
type Draft = Record<string, unknown>;

export type UploadedSceneImage = {
  assetId: string;
  kind: 'image' | 'video';
  label?: string;
  url?: string;
};

function rows(value: unknown): Row[] {
  if (
    !Array.isArray(value) ||
    value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  )
    throw new Error('原有地点或图片需要核对，已保留原稿。');
  return value as Row[];
}

function placeIndex(places: Row[], key: string) {
  const index = places.findIndex((place) => place.key === key);
  if (index < 0 || places.some((place, other) => other !== index && place.key === key))
    throw new Error('未找到这个地点，请刷新后重试。');
  return index;
}

export function addEmptyPlace(content: Draft): Draft {
  const places = rows(content.places ?? []);
  if (places.length >= 24) throw new Error('地点已达到 24 处上限。');
  const keys = new Set(places.map((place) => place.key));
  let index = 1;
  while (keys.has(`place_new_${index}`)) index++;
  return {
    ...content,
    places: [
      ...places,
      { key: `place_new_${index}`, name: '', description: '', knownAtStart: true },
    ],
  };
}

/** Keep the old scene asset and every other place intact; immutable drafts may still refer to it. */
export function attachPlaceImage(
  content: Draft,
  placeKey: string,
  upload: UploadedSceneImage,
): Draft {
  const places = rows(content.places ?? []);
  const index = placeIndex(places, placeKey);
  if (
    upload.kind !== 'image' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(upload.assetId)
  )
    throw new Error('图片上传未完成，请重试。');
  return {
    ...content,
    places: places.map((place, position) => {
      if (position !== index) return place;
      const next: Row = { ...place, sceneImage: { assetId: upload.assetId } };
      delete next.sceneMediaKey;
      return next;
    }),
  };
}

/** Detach only this place. Existing media rows and other references are deliberately retained. */
export function detachPlaceImage(content: Draft, placeKey: string): Draft {
  const places = rows(content.places ?? []);
  const index = placeIndex(places, placeKey);
  return {
    ...content,
    places: places.map((place, position) => {
      if (position !== index) return place;
      const next = { ...place };
      delete next.sceneMediaKey;
      delete next.sceneImage;
      return next;
    }),
  };
}

export function placeImageUrl(
  content: Draft,
  place: Row,
  previewSceneImage?: (assetId: string) => string,
): string | undefined {
  const sceneImage = place.sceneImage;
  if (sceneImage && typeof sceneImage === 'object' && !Array.isArray(sceneImage)) {
    const assetId = (sceneImage as Row).assetId;
    if (typeof assetId === 'string') return previewSceneImage?.(assetId) || undefined;
  }
  if (typeof place.sceneMediaKey !== 'string') return undefined;
  const media = Array.isArray(content.media) ? content.media : [];
  const entry = media.find(
    (item): item is Row =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      item.key === place.sceneMediaKey,
  );
  return entry && typeof entry.url === 'string' && entry.url ? entry.url : undefined;
}

export type PlaceReference = { path: string; label: string };

const PLACE_FIELDS = new Set(['placeKey', 'startPlaceKey', 'fromPlaceKey', 'toPlaceKey']);
const PLACE_LABELS: Record<string, string> = {
  startPlaceKey: '世界起点',
  routes: '路线',
  candidates: '事件',
  history: '背景',
  nodes: '触发条件',
  extensions: '扩展',
};

function referenceLabel(path: readonly string[]): string {
  const field = path[path.length - 1] ?? '';
  const root = PLACE_LABELS[field] ?? (path[0] ? (PLACE_LABELS[path[0]] ?? path[0]) : '内容');
  return `${root}（${path.join('.')}）`;
}

/** Every place the authored content still points at, so deleting never silently rewrites the manuscript. */
export function placeReferences(content: Draft, key: string): PlaceReference[] {
  const found: PlaceReference[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
      const next = [...path, field];
      if (PLACE_FIELDS.has(field) && child === key) {
        found.push({ path: next.join('.'), label: referenceLabel(next) });
        continue;
      }
      walk(child, next);
    }
  };
  walk(content, []);
  return found;
}

/** Never delete silently: unresolved references must be adjusted or replaced by the author first. */
export function removePlace(content: Draft, key: string): Draft {
  const places = rows(content.places ?? []);
  const index = placeIndex(places, key);
  if (places.length <= 1) throw new Error('至少要保留 1 个地点。');
  const references = placeReferences(content, key);
  if (references.length) {
    const head = references
      .slice(0, 3)
      .map((reference) => reference.label)
      .join('；');
    const rest = references.length > 3 ? ` 等 ${references.length} 处` : '';
    throw new Error(`这个地点仍被引用：${head}${rest}。请先调整或替换相关内容，再删除。`);
  }
  return {
    ...content,
    places: places.filter((_, position) => position !== index),
  };
}
