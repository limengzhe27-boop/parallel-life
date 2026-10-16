import { PublishedWorldContentSchema } from '../../contracts/published-world-content.ts';
import { PublisherDraftContentSchema } from '../../contracts/world-publisher.ts';
import { publicationStorageIssues } from '../../modules/settings/domain/publication-content.ts';

type Content = Record<string, unknown>;
type Row = Record<string, unknown>;
export const CHARACTER_PASTE_MAX_BYTES = 1_048_576;
const NOTE_NAMESPACE = 'parallel_life.character_paste';
const modules: Record<string, string> = {
  人生背景: 'lifeContext',
  人格特质: 'traits',
  动机与价值观: 'drives',
  行为模式: 'behavior',
  关系模型: 'relationships',
};
export type PasteSource = { start: number; end: number; text: string };
export type CharacterPasteIssue = { reason: string; source: PasteSource };
export type CharacterPasteField = {
  id: string;
  label: string;
  container: 'publicCard' | 'lifeModules';
  field: string;
  value: string;
  existing: string;
  limit: number;
  source: PasteSource;
};
export type CharacterPasteChat = {
  speaker: 'actor' | 'player';
  text: string;
  day?: string;
  interval: boolean;
  at: string;
  source: PasteSource;
};
export type CharacterPasteMoment = {
  text: string;
  day?: string;
  at: string;
  imageNotes: string[];
  source: PasteSource;
};
export type CharacterPastePreview = {
  actorKey: string;
  actorName: string;
  baseline: string;
  referenceAt: string;
  source: string;
  fields: CharacterPasteField[];
  messages: CharacterPasteChat[];
  moments: CharacterPasteMoment[];
  issues: CharacterPasteIssue[];
  notices: string[];
};
export type CharacterPasteResult =
  | { ok: true; content: Content; addedMessages: number; addedMoments: number; unchanged: boolean }
  | { ok: false; issues: CharacterPasteIssue[] };
const record = (v: unknown): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(record) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
/** Read the actual publication contract, so preview and save never invent a separate capacity. */
export function characterPasteFieldLimit(
  container: 'publicCard' | 'lifeModules',
  field: string,
): number {
  const actor = PublishedWorldContentSchema.out.shape.actors.element.shape;
  if (container === 'lifeModules') {
    const fields = actor.lifeModules.unwrap().shape;
    return field in fields ? (fields[field as keyof typeof fields].unwrap().maxLength ?? 0) : 0;
  }
  return field === 'identity'
    ? (actor.publicCard.shape.identity.unwrap().maxLength ?? 0)
    : field === 'introduction'
      ? (actor.publicCard.shape.introduction.unwrap().maxLength ?? 0)
      : 0;
}
export function characterPasteFingerprint(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(characterPasteFingerprint).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + characterPasteFingerprint((v as Row)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v) ?? 'undefined';
}
function hash(text: string) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const source = (text: string, start: number, end: number): PasteSource => ({
  start,
  end,
  text: text.slice(start, end),
});
function lines(text: string, start = 0) {
  const result: { text: string; start: number; end: number }[] = [];
  const expression = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const m of text.matchAll(expression)) {
    if (!m[0]) continue;
    result.push({
      text: m[0].replace(/(?:\r\n|\r|\n)$/, ''),
      start: start + m.index!,
      end: start + m.index! + m[0].length,
    });
  }
  return result;
}
function dayBounds(day: string): [number, number] | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const t = Date.parse(day + 'T00:00:00+08:00');
  if (!Number.isFinite(t) || new Date(t + 8 * 3600000).toISOString().slice(0, 10) !== day) return;
  return [t, t + 86400000 - 1];
}
function draftStart(content: Content, referenceAt: string) {
  const t = Date.parse(str(record(content.world).startAt));
  return Number.isFinite(t) ? t : Date.parse(referenceAt);
}
function noteEnvelope(content: Content) {
  const value = content.extensions;
  if (value !== undefined && !Array.isArray(value)) return undefined;
  const all = (value ?? []) as Row[];
  if (all.some((v) => !v || typeof v !== 'object' || Array.isArray(v))) return undefined;
  const matches = all.filter((v) => v.namespace === NOTE_NAMESPACE);
  if (matches.length > 1) return undefined;
  const existing = matches[0];
  if (
    existing &&
    (existing.version !== 1 ||
      existing.purpose !== 'editorial' ||
      !Array.isArray(record(existing.data).imageNotes) ||
      (record(existing.data).imageNotes as unknown[]).some(
        (v) =>
          !v ||
          typeof v !== 'object' ||
          ['actorKey', 'momentKey', 'text'].some((k) => typeof record(v)[k] !== 'string'),
      ) ||
      Object.keys(record(existing.data)).some((k) => k !== 'imageNotes'))
  )
    return undefined;
  return { all, existing, notes: existing ? (record(existing.data).imageNotes as Row[]) : [] };
}
export function characterPasteImageNotes(content: Content, actorKey: string) {
  return (noteEnvelope(content)?.notes ?? [])
    .filter((v) => v.actorKey === actorKey)
    .map((v) => ({ momentKey: str(v.momentKey), text: str(v.text) }));
}

/** Deterministic bounded format recognition. Every unknown or invalid piece remains visible. */
export function parseCharacterPaste(
  text: string,
  content: Content,
  actorKey: string,
  referenceAt: string,
): CharacterPastePreview {
  const actors = rows(content.actors).filter((a) => a.key === actorKey),
    actor = actors.length === 1 ? actors[0] : undefined;
  const p: CharacterPastePreview = {
    actorKey,
    actorName: str(actor?.name),
    baseline: characterPasteFingerprint(content),
    referenceAt,
    source: text,
    fields: [],
    messages: [],
    moments: [],
    issues: [],
    notices: [],
  };
  const issue = (reason: string, start = 0, end = text.length) =>
    p.issues.push({ reason, source: source(text, start, end) });
  if (new TextEncoder().encode(text).length > CHARACTER_PASTE_MAX_BYTES) {
    issue('原文超过本次可识别的 1 MiB 上限，完整文字仍在输入框，请分章节导入。');
    return p;
  }
  if (!actor) {
    issue('当前人物不存在或有重复条目，请重新选择后识别。');
    return p;
  }
  if (text.includes('\0')) {
    issue('文档包含无法识别的字符，请确认使用 UTF-8 Markdown。');
    return p;
  }
  const all = lines(text),
    sections: { title: string; start: number; end: number; headerStart: number }[] = [];
  let names = 0,
    current: (typeof sections)[number] | undefined;
  let prefixStart = 0;
  const titles = new Set(['玩家可见资料', ...Object.keys(modules), '历史聊天', '朋友圈']);
  for (const line of all) {
    const value = line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text;
    const name = /^#[ \t]+人物[：:][ \t]*(.*?)[ \t]*$/.exec(value);
    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(value);
    if (name || (heading && titles.has(heading[1]!))) {
      if (current) current.end = line.start;
      else if (text.slice(prefixStart, line.start).trim())
        issue('这些文字未归入约定章节，请加入对应的章节标题。', prefixStart, line.start);
      if (name) {
        if (++names > 1)
          issue('人物标题出现多次，一份文档只能对应当前一个人物。', line.start, line.end);
        if (!name[1] || name[1] !== p.actorName.trim())
          issue(
            `原文姓名“${name[1] || '未填写'}”与当前人物“${p.actorName || '未命名'}”不同，请先核对当前人物姓名。`,
            line.start,
            line.end,
          );
        current = undefined;
        prefixStart = line.end;
      } else {
        current = {
          title: heading![1]!,
          start: line.end,
          end: text.length,
          headerStart: line.start,
        };
        sections.push(current);
      }
    }
  }
  if (!current && text.slice(prefixStart).trim())
    issue('这些文字未归入约定章节，请加入对应的章节标题。', prefixStart);
  const seen = new Set<string>();
  for (const section of sections) {
    const raw = source(text, section.start, section.end),
      body = raw.text;
    if (seen.has(section.title))
      issue(`“${section.title}”章节出现多次，请合并后重新识别。`, section.headerStart, section.end);
    seen.add(section.title);
    for (const line of lines(body, section.start))
      if (/^#{1,6}[ \t]+/.test(line.text))
        issue('这个标题不在约定格式中，请核对章节名称；不会忽略其正文。', line.start, section.end);
    if (!body.trim()) {
      p.notices.push(`${section.title}为空，保留已有内容。`);
      continue;
    }
    function field(
      label: string,
      container: 'publicCard' | 'lifeModules',
      key: string,
      value: string,
      s: PasteSource,
    ) {
      if (!value.trim()) {
        p.notices.push(`${label}为空，保留已有内容。`);
        return;
      }
      const parent = actor![container],
        old = record(parent)[key];
      if (
        (parent !== undefined &&
          (!parent || typeof parent !== 'object' || Array.isArray(parent))) ||
        (old !== undefined && typeof old !== 'string')
      )
        issue(`${label}的已有内容需要核对，不能直接替换。`, s.start, s.end);
      p.fields.push({
        id: container + '.' + key,
        label,
        container,
        field: key,
        value,
        existing: str(old),
        limit: characterPasteFieldLimit(container, key),
        source: s,
      });
    }
    if (modules[section.title])
      field(section.title, 'lifeModules', modules[section.title]!, body, raw);
    else if (section.title === '玩家可见资料') {
      for (const line of lines(body, section.start)) {
        if (/^[\p{L}\p{N}_]{1,16}[：:]/u.test(line.text) && !/^(身份|介绍)[：:]/.test(line.text))
          issue('这项玩家资料没有约定的填入位置，请核对；不会并入介绍。', line.start, line.end);
      }
      const labels = lines(body, section.start).filter((l) => /^(身份|介绍)[：:]/.test(l.text));
      if (!labels.length) {
        issue('玩家可见资料需要以“身份：”或“介绍：”开头。', raw.start, raw.end);
        continue;
      }
      if (text.slice(raw.start, labels[0]!.start).trim())
        issue('这些玩家可见资料尚未对应身份或介绍。', raw.start, labels[0]!.start);
      const used = new Set<string>();
      labels.forEach((line, i) => {
        const m = /^(身份|介绍)[：:][ \t]?/.exec(line.text)!;
        const end = labels[i + 1]?.start ?? raw.end;
        const s = source(text, line.start, end);
        if (used.has(m[1]!)) issue(`${m[1]}重复出现，请合并。`, line.start, end);
        used.add(m[1]!);
        const v = text.slice(line.start + m[0].length, end).replace(/(?:\r\n|\r|\n)$/, '');
        field(
          m[1] === '身份' ? '公开身份' : '公开介绍',
          'publicCard',
          m[1] === '身份' ? 'identity' : 'introduction',
          v,
          s,
        );
      });
    } else if (section.title === '历史聊天') {
      let chat: CharacterPasteChat | undefined,
        day: string | undefined,
        interval = false;
      const finish = (end: number) => {
        if (chat) {
          chat.source = source(text, chat.source.start, end);
          chat.text = chat.text.replace(/(?:\r\n|\r|\n)$/, '');
          if (!chat.text.trim()) issue('这条消息没有正文。', chat.source.start, end);
          p.messages.push(chat);
          chat = undefined;
        }
      };
      for (const line of lines(body, section.start)) {
        const date = /^日期[：:][ \t]*(.*?)[ \t]*$/.exec(line.text);
        if (date) {
          finish(line.start);
          day = date[1];
          if (!dayBounds(day!))
            issue('聊天日期无效，请使用真实的年月日（例如 2024-05-11）。', line.start, line.end);
          continue;
        }
        if (line.text.trim() === '——隔一段时间——') {
          finish(line.start);
          if (interval || !p.messages.length)
            issue('这个时间分段前后缺少可识别消息，请核对。', line.start, line.end);
          interval = true;
          continue;
        }
        const speaker = /^([^：:]+)[：:][ \t]?/.exec(line.text);
        if (speaker) {
          finish(line.start);
          const name = speaker[1]!.trim();
          if (name !== p.actorName.trim() && !['主角', '玩家'].includes(name)) {
            issue(
              `无法确定“${name}”是谁；这里只能填写当前人物或主角的消息。`,
              line.start,
              line.end,
            );
            continue;
          }
          chat = {
            speaker: name === p.actorName.trim() ? 'actor' : 'player',
            text: text.slice(line.start + speaker[0].length, line.end),
            ...(day ? { day } : {}),
            interval,
            at: '',
            source: source(text, line.start, line.end),
          };
          interval = false;
        } else if (chat) chat.text += text.slice(line.start, line.end);
        else if (line.text.trim())
          issue('这段聊天没有明确发送人，请以人物姓名或“主角：”开头。', line.start, line.end);
      }
      finish(section.end);
      if (interval) issue('最后的时间分段后没有消息。', section.start, section.end);
    } else if (section.title === '朋友圈') {
      const markers = lines(body, section.start).filter((l) => l.text.trim() === '【一条动态】');
      if (!markers.length) {
        issue('朋友圈需要用单独一行“【一条动态】”分篇。', raw.start, raw.end);
        continue;
      }
      if (text.slice(raw.start, markers[0]!.start).trim())
        issue('这些朋友圈文字没有归入某一条动态。', raw.start, markers[0]!.start);
      markers.forEach((marker, i) => {
        const end = markers[i + 1]?.start ?? section.end,
          part = source(text, marker.start, end),
          ls = lines(text.slice(marker.end, end), marker.end);
        let day: string | undefined,
          bodyText = '',
          active: 'text' | 'image' | undefined;
        const imageNotes: string[] = [];
        let foundText = false;
        for (const line of ls) {
          const d = /^日期[：:][ \t]*(.*?)[ \t]*$/.exec(line.text),
            copy = /^文案[：:][ \t]?/.exec(line.text),
            img = /^图片说明[：:][ \t]?/.exec(line.text);
          if (d) {
            if (day !== undefined) issue('同一条动态出现了多个日期。', line.start, line.end);
            day = d[1];
            if (!dayBounds(day!))
              issue(
                '朋友圈日期无效，请使用真实的年月日（例如 2024-05-11）。',
                line.start,
                line.end,
              );
            active = undefined;
          } else if (copy) {
            if (foundText) issue('同一条动态出现了多个文案开头，请核对。', line.start, line.end);
            foundText = true;
            active = 'text';
            bodyText += text.slice(line.start + copy[0].length, line.end);
          } else if (img) {
            active = 'image';
            imageNotes.push(text.slice(line.start + img[0].length, line.end));
          } else if (/^[\p{L}\p{N}_]{1,16}[：:]/u.test(line.text)) {
            issue('这项动态资料没有约定的填入位置，请核对；不会并入文案。', line.start, line.end);
            active = undefined;
          } else if (/^!\[[^\]]*\]\([^)]+\)[ \t]*$/.test(line.text)) {
            imageNotes.push(line.text);
            active = undefined;
          } else if (active === 'text') bodyText += text.slice(line.start, line.end);
          else if (active === 'image')
            imageNotes[imageNotes.length - 1] += text.slice(line.start, line.end);
          else if (line.text.trim())
            issue('这段动态文字没有对应文案或图片说明，请核对。', line.start, line.end);
        }
        bodyText = bodyText
          .replace(/!\[[^\]]*\]\([^)]+\)/g, (match) => {
            imageNotes.push(match);
            return '';
          })
          .replace(/(?:\r\n|\r|\n)$/, '');
        if (!bodyText.trim()) issue('这条朋友圈没有可填入的文字文案。', part.start, part.end);
        p.moments.push({
          text: bodyText,
          ...(day ? { day } : {}),
          at: '',
          imageNotes: imageNotes.filter((v) => v.trim()),
          source: part,
        });
      });
    }
  }
  if (!sections.length && !p.issues.length)
    issue('尚未识别到约定章节，请使用“## 人生背景”等章节标题。');
  // Timestamp-only storage: retain day constraints and source order, with actual separate segments.
  const start = draftStart(content, referenceAt);
  let next = Number.isFinite(start) ? start - 60000 : NaN;
  for (let i = p.messages.length - 1; i >= 0; i--) {
    const m = p.messages[i]!,
      bounds = m.day ? dayBounds(m.day) : undefined;
    const at = Math.min(next, bounds?.[1] ?? Infinity);
    if (!Number.isFinite(at) || (bounds && at < bounds[0]))
      issue(
        '聊天日期或先后分段无法安排在故事开场之前，原消息未填入。',
        m.source.start,
        m.source.end,
      );
    else m.at = new Date(at).toISOString();
    next = at - (m.interval ? 12 * 3600000 : 60000);
  }
  for (const m of p.moments) {
    const bounds = m.day ? dayBounds(m.day) : undefined;
    const at = Math.min(
      Number.isFinite(start) ? start - 60000 : NaN,
      bounds?.[1] ?? start - 3600000,
    );
    if (!Number.isFinite(at) || (bounds && at < bounds[0]))
      issue('这条动态的日期晚于故事开场，或尚未取得可用的故事时间。', m.source.start, m.source.end);
    else m.at = new Date(at).toISOString();
  }
  const simulated = applyCharacterPaste(
    content,
    actorKey,
    p,
    p.fields.map((f) => f.id),
    true,
  );
  if (!simulated.ok)
    for (const found of simulated.issues)
      if (!p.issues.some((i) => i.reason === found.reason && i.source.start === found.source.start))
        p.issues.push(found);
  return p;
}

/** One complete private-draft change, or no change at all. This never calls a model or saves. */
export function applyCharacterPaste(
  content: Content,
  actorKey: string,
  p: CharacterPastePreview,
  selectedFields: string[],
  validationOnly = false,
): CharacterPasteResult {
  const issues: CharacterPasteIssue[] = [...p.issues],
    fail = (reason: string, s: PasteSource = source(p.source, 0, p.source.length)) =>
      issues.push({ reason, source: s });
  if (p.actorKey !== actorKey || p.baseline !== characterPasteFingerprint(content))
    fail('当前人物或草稿已变化，请重新识别后再确认。');
  const matches = rows(content.actors).filter((a) => a.key === actorKey),
    actor = matches.length === 1 ? matches[0] : undefined;
  if (!actor || str(actor.name) !== p.actorName) fail('当前人物姓名或选择已变化，请重新核对。');
  if (issues.length) return { ok: false, issues };
  let next: Content = {
    ...content,
    actors: (content.actors as unknown[]).map((a) => (a === actor ? { ...actor } : a)),
  };
  const index = (content.actors as unknown[]).indexOf(actor),
    updated = (next.actors as Row[])[index]!;
  for (const f of p.fields.filter((f) => selectedFields.includes(f.id))) {
    updated[f.container] = { ...record(updated[f.container]), [f.field]: f.value };
  }
  const phone = record(content.phone);
  if ((p.messages.length || p.moments.length) && actor!.knownAtStart !== true)
    fail('导入聊天和朋友圈前，请先确认这位人物与主角开场已经认识。');
  for (const collection of ['messages', 'moments'] as const)
    if (
      phone[collection] !== undefined &&
      (!Array.isArray(phone[collection]) ||
        (phone[collection] as unknown[]).some(
          (v) => !v || typeof v !== 'object' || Array.isArray(v),
        ))
    )
      fail('原有聊天或朋友圈需要先核对，本次没有替换它们。');
  let messages = [...rows(phone.messages)],
    moments = [...rows(phone.moments)],
    addedMessages = 0,
    addedMoments = 0;
  const notes = noteEnvelope(content);
  let imageNotes = notes?.notes.map((v) => ({ ...v })) ?? [];
  function append<T extends CharacterPasteChat | CharacterPasteMoment>(
    items: T[],
    all: Row[],
    kind: 'chat' | 'moment',
  ) {
    const seen = new Map<string, number>();
    for (const item of items) {
      const signature = characterPasteFingerprint([
        actorKey,
        'speaker' in item ? item.speaker : undefined,
        item.text,
        item.day ?? null,
        'interval' in item ? item.interval : undefined,
      ]);
      const occurrence = characterPasteFingerprint([
        actorKey,
        'speaker' in item ? item.speaker : undefined,
        item.text,
        item.day ?? null,
      ]);
      const n = (seen.get(occurrence) ?? 0) + 1;
      seen.set(occurrence, n);
      const key = `paste_${kind}_${hash(signature)}_${n.toString(36)}`;
      const old = all.find((row) => row.key === key);
      const matching = all.filter(
        (row) =>
          row.actorKey === actorKey &&
          str(row.text) === item.text &&
          (kind !== 'chat' ||
            (row.origin === 'history' &&
              (row.speaker ?? 'actor') === (item as CharacterPasteChat).speaker)) &&
          (!item.day ||
            (Number.isFinite(Date.parse(str(row.at))) &&
              new Date(Date.parse(str(row.at)) + 8 * 3600000).toISOString().slice(0, 10) ===
                item.day)),
      );
      let adoptedKey = key;
      if (old) {
        if (
          old.actorKey !== actorKey ||
          old.text !== item.text ||
          (kind === 'chat' && (old.speaker ?? 'actor') !== (item as CharacterPasteChat).speaker)
        )
          fail('同一份导入记录中的条目后来有改动，请核对，未重复追加。', item.source);
      } else if (matching.length >= n) adoptedKey = str(matching[n - 1]!.key);
      else {
        if (!item.text.trim() || item.text.length > (kind === 'chat' ? 500 : 1600))
          fail(
            kind === 'chat'
              ? '这条聊天超过 500 字或没有正文，全文保留，请拆分后再导入。'
              : '这条朋友圈超过 1600 字或没有正文，全文保留，请精简后再导入。',
            item.source,
          );
        all.push({
          key,
          actorKey,
          text: item.text,
          at: item.at,
          ...(kind === 'chat'
            ? { origin: 'history', speaker: (item as CharacterPasteChat).speaker }
            : {}),
        });
        if (kind === 'chat') addedMessages++;
        else addedMoments++;
      }
      if (kind === 'moment')
        for (const note of (item as CharacterPasteMoment).imageNotes)
          if (
            !imageNotes.some(
              (v) => v.actorKey === actorKey && v.momentKey === adoptedKey && v.text === note,
            )
          )
            imageNotes.push({ actorKey, momentKey: adoptedKey, text: note });
    }
  }
  append(p.messages, messages, 'chat');
  append(p.moments, moments, 'moment');
  if (messages.length > 200) fail('填入后聊天会超过 200 条上限；请分批核对或先整理已有消息。');
  if (moments.length > 48) fail('填入后朋友圈会超过 48 条上限；请先整理已有动态。');
  if (p.messages.length || p.moments.length)
    next = {
      ...next,
      phone: {
        ...phone,
        ...(p.messages.length ? { messages } : {}),
        ...(p.moments.length ? { moments } : {}),
      },
    };
  if (
    imageNotes.length &&
    characterPasteFingerprint(imageNotes) !== characterPasteFingerprint(notes?.notes ?? [])
  ) {
    if (!notes) fail('已有配图说明需要核对，本次没有覆盖。');
    else {
      const entry = notes.existing
        ? { ...notes.existing, data: { imageNotes } }
        : {
            namespace: NOTE_NAMESPACE,
            version: 1,
            purpose: 'editorial',
            description: '角色导入时保留的待配图文字说明',
            data: { imageNotes },
          };
      const extensions = notes.existing
        ? notes.all.map((v) => (v === notes.existing ? entry : v))
        : [...notes.all, entry];
      if (
        extensions.length > 8 ||
        bytes(entry.data) > 8192 ||
        extensions.reduce((sum, v) => sum + bytes(v.data), 0) > 16384
      )
        fail('待配图说明超出当前可保存容量，完整原文仍保留，请分批或精简说明。');
      else next = { ...next, extensions };
    }
  }
  const shape = PublishedWorldContentSchema.safeParse(next);
  if (!shape.success)
    for (const e of shape.error.issues) {
      const isTarget =
        e.path[0] === 'actors' &&
        e.path[1] === index &&
        p.fields.some(
          (f) =>
            e.path[2] === f.container &&
            e.path[3] === f.field &&
            (validationOnly || selectedFields.includes(f.id)),
        );
      if (isTarget) {
        const f = p.fields.find((f) => e.path[2] === f.container && e.path[3] === f.field)!;
        const max = 'maximum' in e ? Number(e.maximum) : undefined;
        fail(
          max
            ? `${f.label}超出当前可保存的 ${max} 字符上限，全文已保留；请调整这一章节后重新识别，不会截断。`
            : `${f.label}暂不能按当前内容规则保存，请核对原文。`,
          f.source,
        );
      }
    }
  if (!PublisherDraftContentSchema.safeParse(next).success || publicationStorageIssues(next).length)
    fail('填入后的草稿超过容量或结构限制，原稿未修改；请分章节导入。');
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    content: next,
    addedMessages,
    addedMoments,
    unchanged: characterPasteFingerprint(next) === p.baseline,
  };
}
