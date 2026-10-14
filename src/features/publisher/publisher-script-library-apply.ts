import type { ScriptLibraryPreview } from './publisher-script-library.ts';
import { scriptLibraryKey } from './publisher-script-library.ts';

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] =>
  Array.isArray(v)
    ? v.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r))
    : [];
const title = (v: unknown) =>
  typeof v === 'string' ? v.replace(/^\s*\d+[.．、]\s*/, '').trim() : '';
export type ScriptImportChoice = { targetKey?: string; replace?: boolean; skip?: boolean };
export function scriptEventMatches(content: Row, eventTitle: string) {
  return rows(content.candidates).filter((event) => title(event.title) === title(eventTitle));
}
export function scriptLibraryFingerprint(content: Row) {
  return JSON.stringify(content);
}
/** Format recognition produces draft changes only, without model calls or story conditions. */
export function applyScriptLibraryPreview(
  content: Row,
  preview: ScriptLibraryPreview,
  choices: Record<string, ScriptImportChoice> = {},
) {
  for (const field of ['places', 'candidates'] as const) {
    const value = content[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) ||
        value.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    )
      return {
        ok: false as const,
        message: '当前草稿包含尚不能直接合并的旧内容，原稿已保留，请先核对对应列表。',
      };
  }
  if (preview.issues.length) return { ok: false as const, message: preview.issues[0]!.reason };
  if (preview.unassigned.length)
    return {
      ok: false as const,
      message: '还有原文未归入事件，请选择归入的事件，或先保留这段原文再导入。',
    };
  const next = structuredClone(content),
    places = rows(next.places),
    events = rows(next.candidates);
  let addedPlaces = 0,
    addedEvents = 0,
    updatedEvents = 0;
  const references = new Map<string, string>();
  for (const place of preview.places) {
    const exact = places.filter((p) => p.name === place.name);
    const byKey = places.find((p) => p.key === place.key);
    if (exact.length > 1 || (byKey && byKey.name !== place.name))
      return {
        ok: false as const,
        message: `地点“${place.name}”与当前草稿有重名或标识冲突，请先核对。`,
      };
    if (exact[0] || byKey) {
      const existing = (exact[0] ?? byKey)!;
      if (place.aliases?.length)
        existing.aliases = [
          ...new Set([
            ...(Array.isArray(existing.aliases) ? existing.aliases : []),
            ...place.aliases,
          ]),
        ];
      references.set(place.key, String(existing.key));
    } else {
      places.push({
        key: place.key,
        name: place.name,
        ...(place.aliases?.length ? { aliases: [...place.aliases] } : {}),
        description: place.name,
        knownAtStart: false,
      });
      references.set(place.key, place.key);
      addedPlaces++;
    }
  }
  let importedOpening: string | undefined;
  for (const event of preview.events) {
    const choice = choices[event.key] ?? {};
    if (choice.skip) continue;
    if (event.body.length > 16384)
      return {
        ok: false as const,
        message: `“${event.title}”超过单个事件容量，原稿没有截断，请拆分后导入。`,
      };
    const matches = scriptEventMatches(next, event.title);
    let existing = choice.targetKey
      ? events.find((e) => e.key === choice.targetKey)
      : matches.length === 1
        ? matches[0]
        : events.find((e) => e.key === event.key);
    if (choice.targetKey && !existing)
      return { ok: false as const, message: '对应的已有事件发生了变化，请重新识别。' };
    if (matches.length > 1 && !choice.targetKey)
      return {
        ok: false as const,
        message: `“${event.title}”对应多条已有事件，请选择要保留或更新的一条。`,
      };
    const scenePlaceKeys = event.placeKeys.map((key) => references.get(key)!);
    if (scenePlaceKeys.some((key) => !key))
      return { ok: false as const, message: '有场景尚未关联到地点，请重新识别。' };
    if (!existing) {
      let key = event.key;
      if (events.some((e) => e.key === key))
        key = scriptLibraryKey('event', event.title + '\0' + event.body);
      if (events.some((e) => e.key === key))
        return { ok: false as const, message: '这条事件与已有内容冲突，请选择更新已有事件。' };
      const actorKeys = rows(next.actors)
        .filter(
          (a) => typeof a.name === 'string' && a.name.length > 0 && event.body.includes(a.name),
        )
        .map((a) => a.key);
      existing = {
        key,
        kind: 'candidate',
        title: event.title,
        editorialIntent: event.body,
        script: event.body,
        sceneText: event.sceneText,
        scenePlaceKeys,
        actorKeys,
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
        direction: { mode: 'optional' },
      };
      events.push(existing);
      addedEvents++;
    } else if (choice.replace) {
      existing.title = event.title;
      existing.editorialIntent = event.body;
      existing.script = event.body;
      existing.sceneText = event.sceneText;
      existing.scenePlaceKeys = scenePlaceKeys;
      // Authored actors, hard conditions, pacing and fixed speakers remain intact.
      updatedEvents++;
    }
    if (event.opening) importedOpening = String(existing.key);
  }
  if (places.length > 24 || events.length > 32)
    return { ok: false as const, message: '本批超过地点或事件容量，当前草稿未修改，请分批整理。' };
  next.places = places;
  next.candidates = events;
  // A different existing opening is retained until the author explicitly chooses the new one.
  if (importedOpening && !next.openingEventKey) next.openingEventKey = importedOpening;
  return {
    ok: true as const,
    content: next,
    addedPlaces,
    addedEvents,
    updatedEvents,
    importedOpening,
    unchanged: JSON.stringify(next) === JSON.stringify(content),
  };
}
