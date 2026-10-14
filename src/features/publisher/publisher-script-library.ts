/** Deterministic manuscript recognition only. No model, scheduling or world mutations. */
export type ScriptSource = { start: number; end: number; text: string };
export type ScriptIssue = { reason: string; source: ScriptSource };
export type ScriptPlace = {
  key: string;
  name: string;
  sources: ScriptSource[];
  eventKeys: string[];
  existing: boolean;
};
export type ScriptEvent = {
  key: string;
  title: string;
  number?: string;
  opening: boolean;
  body: string;
  source: ScriptSource;
  sceneText: string;
  placeKeys: string[];
};
export type ScriptUnassigned = { key: string; source: ScriptSource };
export type ScriptLibraryPreview = {
  original: string;
  places: ScriptPlace[];
  events: ScriptEvent[];
  unassigned: ScriptUnassigned[];
  issues: ScriptIssue[];
  mergeSuggestions: { leftKey: string; rightKey: string }[];
};
export const SCRIPT_DOCUMENT_MAX_BYTES = 1_048_576;
const cleanName = (text: string) => text.replace(/\*\*/g, '').trim();
const presentation = new Set([
  '手机聊天界面',
  '微信聊天界面',
  '手机界面',
  '微信界面',
  '聊天界面',
  '消息界面',
  '微信聊天',
  '线上聊天',
  '手机聊天',
  '微信',
  '短信界面',
  '视频通话界面',
  '电话通话',
  '手机通话',
]);
function hash(text: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export const scriptLibraryKey = (kind: 'place' | 'event' | 'unassigned', value: string) =>
  `${kind}_${hash(value)}`;
const source = (text: string, start: number, end: number): ScriptSource => ({
  start,
  end,
  text: text.slice(start, end),
});
function lines(text: string) {
  return [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)]
    .filter((m) => m[0])
    .map((m) => ({
      text: m[0].replace(/(?:\r\n|\r|\n)$/, ''),
      start: m.index!,
      end: m.index! + m[0].length,
    }));
}
function locationNames(text: string) {
  return text
    .split(/[、，,；;\r\n]|与/u)
    .map((v) =>
      cleanName(v)
        .replace(/^[ \t]*(?:[-*+] |\d+[.、]\s*)/, '')
        .replace(/[…]+$/u, '')
        .trim(),
    )
    .filter((v) => v && !presentation.has(v));
}
/** Similar spellings are suggestions only; the caller must ask the author before merging. */
function similar(a: string, b: string) {
  if (a === b) return false;
  const left = a.replace(/[的\s]/g, ''),
    right = b.replace(/[的\s]/g, '');
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4) return false;
  const table = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = table[0]!;
    table[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const old = table[j]!;
      table[j] = Math.min(
        table[j]! + 1,
        table[j - 1]! + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return table[right.length]! <= 1;
}
export function parseScriptLibraryMarkdown(
  text: string,
  existingPlaces: { key: string; name: string }[] = [],
): ScriptLibraryPreview {
  const p: ScriptLibraryPreview = {
    original: text,
    places: [],
    events: [],
    unassigned: [],
    issues: [],
    mergeSuggestions: [],
  };
  if (new TextEncoder().encode(text).length > SCRIPT_DOCUMENT_MAX_BYTES) {
    p.issues.push({
      reason: '这份文稿超过本次可识别的 1 MiB 上限，原文没有截断，请拆成多份文稿。',
      source: source(text, 0, text.length),
    });
    return p;
  }
  if (text.includes('\0')) {
    p.issues.push({
      reason: '原稿包含无法识别的字符，请确认是 UTF-8 文字。',
      source: source(text, 0, text.length),
    });
    return p;
  }
  const ls = lines(text),
    heads: {
      index: number;
      start: number;
      end: number;
      title: string;
      number?: string;
      opening: boolean;
    }[] = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!,
      v = cleanName(l.text).replace(/^\uFEFF/, '');
    // Indented body lists are not event headings.
    if (/^[ \t]/.test(l.text)) continue;
    const heading = v.replace(/^#{1,6}[ \t]+/, '');
    const opening = /^开场事件(?:[：:][ \t]*(.*))?$/.exec(heading);
    if (opening) {
      heads.push({
        index: i,
        start: l.start,
        end: l.end,
        title: opening[1]?.trim() || '开场事件',
        opening: true,
      });
      continue;
    }
    const numbered = /^(\d{1,3})[.．、][ \t]*(.*)$/.exec(heading);
    if (!numbered) continue;
    if (numbered[2]) {
      heads.push({
        index: i,
        start: l.start,
        end: l.end,
        title: numbered[2].trim(),
        number: numbered[1],
        opening: false,
      });
      continue;
    }
    let j = i + 1;
    while (j < ls.length && !ls[j]!.text.trim()) j++;
    const next = ls[j],
      title = next && /^#{1,6}[ \t]+(.+)$/.exec(cleanName(next.text));
    if (title && !/^(场景|地址汇总)[：:]/.test(title[1]!)) {
      heads.push({
        index: i,
        start: l.start,
        end: next!.end,
        title: title[1]!.trim(),
        number: numbered[1],
        opening: false,
      });
      i = j;
    }
  }
  const consumed: { start: number; end: number }[] = [];
  const addPlace = (name: string, s: ScriptSource, eventKey?: string) => {
    if (!name || presentation.has(name)) return;
    if (name.length > 100) {
      p.issues.push({ reason: '地点名称超过 100 字符，请核对；没有截断或替换。', source: s });
      return;
    }
    const old = p.places.find((v) => v.name === name);
    if (old) {
      if (!old.sources.some((v) => v.start === s.start && v.end === s.end)) old.sources.push(s);
      if (eventKey && !old.eventKeys.includes(eventKey)) old.eventKeys.push(eventKey);
      return;
    }
    const matches = existingPlaces.filter((v) => cleanName(v.name) === name);
    if (matches.length > 1)
      p.issues.push({
        reason: `地点“${name}”在当前草稿中有多个同名条目，请先核对合并。`,
        source: s,
      });
    const key = matches.length === 1 ? matches[0]!.key : scriptLibraryKey('place', name);
    if (p.places.some((v) => v.key === key && v.name !== name))
      p.issues.push({ reason: '这两个地点的标识冲突，请分别核对后导入。', source: s });
    p.places.push({
      key,
      name,
      sources: [s],
      eventKeys: eventKey ? [eventKey] : [],
      existing: matches.length === 1,
    });
  };
  // Read address summaries before scenes, preserving the author's address-list order.
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]!,
      label = /^(?:#{1,6}[ \t]+)?地址汇总[：:][ \t]*(.*)$/.exec(cleanName(line.text));
    if (!label) continue;
    const inEvent = heads.some(
      (h, j) => line.start >= h.start && line.start < (heads[j + 1]?.start ?? text.length),
    );
    if (label[1])
      for (const name of locationNames(label[1]))
        addPlace(name, source(text, line.start, line.end));
    if (!inEvent) consumed.push({ start: line.start, end: line.end });
    for (let j = i + 1; j < ls.length; j++) {
      const next = ls[j]!,
        v = cleanName(next.text);
      if (
        heads.some((h) => h.start === next.start) ||
        /^#{1,6}[ \t]+/.test(v) ||
        /^[^：:]{1,16}[：:]/.test(v)
      )
        break;
      if (!v) {
        if (!inEvent) consumed.push({ start: next.start, end: next.end });
        continue;
      }
      // Sentences are not silently promoted into place names.
      if (/[。！？!?：:]/.test(v) || v.length > 400) break;
      const names = locationNames(v);
      if (!names.length) continue;
      for (const name of names) addPlace(name, source(text, next.start, next.end));
      if (!inEvent) consumed.push({ start: next.start, end: next.end });
      i = j;
    }
  }
  const duplicates = new Map<string, number>();
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!,
      end = heads[i + 1]?.start ?? text.length;
    const n = (duplicates.get(h.title) ?? 0) + 1;
    duplicates.set(h.title, n);
    const key = scriptLibraryKey('event', h.title + '\0' + n);
    const event: ScriptEvent = {
      key,
      title: h.title,
      ...(h.number ? { number: h.number } : {}),
      opening: h.opening,
      body: text.slice(h.start, end),
      source: source(text, h.start, end),
      sceneText: '',
      placeKeys: [],
    };
    if (h.title.length > 120)
      p.issues.push({
        reason: '事件标题超过 120 字符，请核对；原文完整保留。',
        source: source(text, h.start, h.end),
      });
    const scenes: string[] = [];
    for (const line of ls.filter((l) => l.start >= h.end && l.start < end)) {
      const scene = /^(?:#{1,6}[ \t]+)?场景[：:][ \t]*(.*)$/.exec(cleanName(line.text));
      if (!scene) continue;
      scenes.push(scene[1]!);
      for (const name of locationNames(scene[1]!))
        addPlace(name, source(text, line.start, line.end), key);
    }
    event.sceneText = scenes.join('\n');
    event.placeKeys = p.places.filter((v) => v.eventKeys.includes(key)).map((v) => v.key);
    p.events.push(event);
    consumed.push({ start: h.start, end });
  }
  if (p.events.filter((e) => e.opening).length > 1)
    p.issues.push({
      reason: '原稿标明了多个开场事件，请核对后只保留一个开场指定。',
      source: source(text, 0, text.length),
    });
  consumed.sort((a, b) => a.start - b.start);
  let cursor = 0;
  const orphan = (start: number, end: number) => {
    if (text.slice(start, end).trim())
      p.unassigned.push({
        key: scriptLibraryKey('unassigned', `${start}:${text.slice(start, end)}`),
        source: source(text, start, end),
      });
  };
  for (const c of consumed) {
    if (c.start > cursor) orphan(cursor, c.start);
    cursor = Math.max(cursor, c.end);
  }
  orphan(cursor, text.length);
  for (let i = 0; i < p.places.length; i++)
    for (let j = i + 1; j < p.places.length; j++)
      if (similar(p.places[i]!.name, p.places[j]!.name))
        p.mergeSuggestions.push({ leftKey: p.places[i]!.key, rightKey: p.places[j]!.key });
  return p;
}
/** Author-confirmed preview edits. No existing draft is touched here. */
export function reviseScriptLibraryPreview(
  p: ScriptLibraryPreview,
  merges: Record<string, string>,
  assignments: Record<string, string>,
): ScriptLibraryPreview {
  const next = structuredClone(p);
  const canonical = (key: string) => {
    const seen = new Set<string>();
    while (merges[key] && merges[key] !== key) {
      if (seen.has(key)) return undefined;
      seen.add(key);
      key = merges[key]!;
    }
    return key;
  };
  for (const [from, to] of Object.entries(merges))
    if (
      !next.places.some((v) => v.key === from) ||
      !next.places.some((v) => v.key === to) ||
      !canonical(from)
    )
      next.issues.push({
        reason: '地点合并目标无效或形成循环，请重新核对。',
        source: source(p.original, 0, p.original.length),
      });
  if (next.issues.length) return next;
  for (const item of next.unassigned) {
    const target = assignments[item.key];
    if (!target) continue;
    const event = next.events.find((v) => v.key === target);
    if (!event) {
      next.issues.push({ reason: '这段原文选择的事件已不存在，请重新核对。', source: item.source });
      continue;
    }
    event.body += '\n\n' + item.source.text;
  }
  next.unassigned = next.unassigned.filter((v) => !assignments[v.key]);
  for (const event of next.events)
    event.placeKeys = [...new Set(event.placeKeys.map((k) => canonical(k)!))];
  const places: ScriptPlace[] = [];
  for (const place of next.places) {
    const key = canonical(place.key)!,
      target = next.places.find((v) => v.key === key)!;
    const old = places.find((v) => v.key === key);
    if (old) {
      old.sources.push(...place.sources);
      old.eventKeys = [...new Set([...old.eventKeys, ...place.eventKeys])];
    } else places.push({ ...target, sources: [...place.sources], eventKeys: [...place.eventKeys] });
  }
  next.places = places;
  return next;
}
