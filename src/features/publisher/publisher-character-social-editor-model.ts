import { characterPreview } from './publisher-character-model.ts';

type Draft = Record<string, unknown>;
type Entry = Record<string, unknown>;
export type Speaker = 'actor' | 'player';

function record(value: unknown): Draft {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Draft) : {};
}
function list(value: unknown): Entry[] {
  return Array.isArray(value)
    ? value.filter((v): v is Entry => v !== null && typeof v === 'object' && !Array.isArray(v))
    : [];
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function actor(content: Draft, actorKey: string): Entry | undefined {
  const matches = list(content.actors).filter((item) => item.key === actorKey);
  return matches.length === 1 ? matches[0] : undefined;
}
function nextKey(entries: Entry[], prefix: string): string {
  const keys = new Set(entries.map((entry) => entry.key));
  for (let i = 1; i < 100000; i++) {
    const key = `${prefix}_${i.toString(36)}`;
    if (!keys.has(key)) return key;
  }
  throw new Error('条目已达到上限');
}
function withPhoneEntries(
  content: Draft,
  collection: 'messages' | 'moments',
  entries: Entry[],
): Draft {
  return { ...content, phone: { ...record(content.phone), [collection]: entries } };
}
function startTime(content: Draft, referenceAt?: string): number {
  const authoredStart = Date.parse(str(record(content.world).startAt));
  if (Number.isFinite(authoredStart)) return authoredStart;
  return Date.parse(referenceAt ?? '');
}
function chooseHistoryTime(
  content: Draft,
  actorKey: string,
  interval: boolean,
  referenceAt?: string,
): string | undefined {
  const start = startTime(content, referenceAt);
  if (!Number.isFinite(start)) return undefined;
  const times = list(record(content.phone).messages)
    .filter((item) => item.actorKey === actorKey && item.origin === 'history')
    .map((item) => Date.parse(str(item.at)))
    .filter(Number.isFinite);
  const last = times.length ? Math.max(...times) : start - 7 * 86400000;
  const next = last + (interval ? 86400000 : 60000);
  return next < start ? new Date(next).toISOString() : undefined;
}

/** The saved schema has timestamps rather than editor-only separators. An interval becomes a stable day gap. */
export function addHistoryMessage(
  content: Draft,
  actorKey: string,
  speaker: Speaker,
  text: string,
  interval = false,
  referenceAt?: string,
): { content: Draft; error?: string } {
  const subject = actor(content, actorKey);
  if (!subject || subject.knownAtStart !== true)
    return { content, error: '请先确认这位人物与主角开场已经认识。' };
  if (!text.trim() || text.trim().length > 500)
    return { content, error: '消息请填写 1 至 500 字。' };
  const all = list(record(content.phone).messages);
  if (all.length >= 40) return { content, error: '历史聊天已达到 40 条上限。' };
  const at = chooseHistoryTime(content, actorKey, interval, referenceAt);
  if (!at)
    return {
      content,
      error: Number.isFinite(startTime(content, referenceAt))
        ? '现有聊天已接近开场，请核对原稿时间后再添加。'
        : '尚未取得作品的创建时间，请先保存草稿后重试。',
    };
  const added = {
    key: nextKey(all, 'chat'),
    actorKey,
    origin: 'history',
    speaker,
    text: text.trim(),
    at,
  };
  return { content: withPhoneEntries(content, 'messages', [...all, added]) };
}

export function editHistoryMessage(
  content: Draft,
  actorKey: string,
  key: string,
  speaker: Speaker,
  text: string,
): { content: Draft; error?: string } {
  if (!text.trim() || text.trim().length > 500)
    return { content, error: '消息请填写 1 至 500 字。' };
  const all = list(record(content.phone).messages);
  if (
    !all.some((item) => item.key === key && item.actorKey === actorKey && item.origin === 'history')
  )
    return { content, error: '这条历史消息已不存在，请刷新后重试。' };
  return {
    content: withPhoneEntries(
      content,
      'messages',
      all.map((item) =>
        item.key === key && item.actorKey === actorKey
          ? { ...item, text: text.trim(), speaker }
          : item,
      ),
    ),
  };
}

export function removeHistoryMessage(
  content: Draft,
  actorKey: string,
  key: string,
): { content: Draft; error?: string } {
  const all = list(record(content.phone).messages);
  if (
    !all.some((item) => item.key === key && item.actorKey === actorKey && item.origin === 'history')
  )
    return { content, error: '这条历史消息已不存在，请刷新后重试。' };
  if (list(record(content.phone).invitations).some((item) => item.messageKey === key))
    return { content, error: '这条消息关联了邀约，请先调整邀约。' };
  return {
    content: withPhoneEntries(
      content,
      'messages',
      all.filter((item) => !(item.key === key && item.actorKey === actorKey)),
    ),
  };
}

export function historySegments(content: Draft, actorKey: string) {
  const preview = characterPreview(content, actorKey);
  const historyKeys = new Set(
    list(record(content.phone).messages)
      .filter((entry) => entry.actorKey === actorKey && entry.origin === 'history')
      .map((entry) => entry.key),
  );
  const messages = (preview?.messages ?? []).filter((item) => historyKeys.has(item.key));
  return messages.map((item, index) => ({
    ...item,
    intervalBefore:
      index > 0 && Date.parse(item.at) - Date.parse(messages[index - 1]!.at) >= 12 * 3600000,
  }));
}

/** An empty day uses the stable latest available instant before the authored start or work creation. */
function momentTime(content: Draft, day?: string, referenceAt?: string): string | undefined {
  const start = startTime(content, referenceAt);
  if (!Number.isFinite(start)) return undefined;
  if (!day) return new Date(start - 3600000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const at = Date.parse(`${day}T12:00:00+08:00`);
  return Number.isFinite(at) &&
    new Date(at + 8 * 3600000).toISOString().slice(0, 10) === day &&
    at <= start
    ? new Date(at).toISOString()
    : undefined;
}

export function addMoment(
  content: Draft,
  actorKey: string,
  text: string,
  day?: string,
  referenceAt?: string,
): { content: Draft; error?: string } {
  const subject = actor(content, actorKey);
  if (!subject || subject.knownAtStart !== true)
    return { content, error: '请先确认这位人物与主角开场已经认识。' };
  if (!text.trim() || text.trim().length > 1600)
    return { content, error: '朋友圈正文请填写 1 至 1600 字。' };
  const all = list(record(content.phone).moments);
  if (all.length >= 48) return { content, error: '朋友圈已达到 48 条上限。' };
  const at = momentTime(content, day, referenceAt);
  if (!at)
    return {
      content,
      error: Number.isFinite(startTime(content, referenceAt))
        ? '发布日期需要早于或等于故事开场。'
        : '尚未取得作品的创建时间，请先保存草稿后重试。',
    };
  const added = { key: nextKey(all, 'moment'), actorKey, text: text.trim(), at };
  return { content: withPhoneEntries(content, 'moments', [...all, added]) };
}

export function editMoment(
  content: Draft,
  actorKey: string,
  key: string,
  text: string,
  day?: string,
  referenceAt?: string,
): { content: Draft; error?: string } {
  if (!text.trim() || text.trim().length > 1600)
    return { content, error: '朋友圈正文请填写 1 至 1600 字。' };
  const all = list(record(content.phone).moments);
  const existing = all.find((item) => item.key === key && item.actorKey === actorKey);
  if (!existing) return { content, error: '这条朋友圈已不存在，请刷新后重试。' };
  const at = day ? momentTime(content, day, referenceAt) : str(existing.at);
  if (!at) return { content, error: '发布日期需要早于或等于故事开场。' };
  return {
    content: withPhoneEntries(
      content,
      'moments',
      all.map((item) => (item === existing ? { ...item, text: text.trim(), at } : item)),
    ),
  };
}

export function removeMoment(content: Draft, actorKey: string, key: string): Draft {
  return withPhoneEntries(
    content,
    'moments',
    list(record(content.phone).moments).filter(
      (item) => !(item.key === key && item.actorKey === actorKey),
    ),
  );
}

/** Public profile editing changes only the allowed public card, never the private character modules. */
export function editPublicProfile(
  content: Draft,
  actorKey: string,
  field: 'identity' | 'introduction',
  value: string,
): Draft {
  const subject = actor(content, actorKey);
  if (!subject || value.length > (field === 'identity' ? 160 : 1600)) return content;
  const card = { ...record(subject.publicCard) };
  if (value.trim()) card[field] = value;
  else delete card[field];
  const actors = list(content.actors).map((item) =>
    item === subject ? { ...item, publicCard: card } : item,
  );
  return { ...content, actors };
}
