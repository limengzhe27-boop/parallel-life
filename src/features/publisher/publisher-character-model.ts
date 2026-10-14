import { publisherArtUrl } from './publisher-art-model.ts';

export const CHARACTER_MODULES = [
  { key: 'lifeContext', label: '人生背景', hint: '成长背景与经历' },
  { key: 'traits', label: '人格特质', hint: '性格特征与说话方式' },
  { key: 'drives', label: '动机与价值观', hint: '核心动机与在乎的事' },
  { key: 'behavior', label: '行为模式', hint: '处事习惯与行动准则' },
  { key: 'relationships', label: '关系模型', hint: '相处模式、知情差异与底线' },
] as const;
export type CharacterModuleKey = (typeof CHARACTER_MODULES)[number]['key'];
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}
function uniqueActor(content: Record<string, unknown>, key: string) {
  const matches = rows(content.actors).filter((a) => a.key === key);
  return matches.length === 1 ? matches[0] : undefined;
}
export function characterModuleText(
  content: Record<string, unknown>,
  actorKey: string,
  module: CharacterModuleKey,
) {
  return string(record(uniqueActor(content, actorKey)?.lifeModules)[module]);
}
export function characterIntroductionText(content: Record<string, unknown>, actorKey: string) {
  return string(record(uniqueActor(content, actorKey)?.publicCard).introduction);
}
/** Legacy prose is a read-only reference, not a replacement for the five authored dimensions. */
export function characterLegacyModuleText(
  content: Record<string, unknown>,
  actorKey: string,
  module: CharacterModuleKey,
) {
  const actor = uniqueActor(content, actorKey);
  if (Object.hasOwn(record(actor?.lifeModules), module)) return '';
  const legacy = record(actor?.privatePersona);
  const field = {
    lifeContext: 'background',
    traits: 'voice',
    drives: 'motivation',
    behavior: undefined,
    relationships: 'boundaries',
  }[module];
  return field ? string(legacy[field]) : '';
}
export function characterFieldEditable(
  content: Record<string, unknown>,
  actorKey: string,
  field: CharacterModuleKey | 'introduction',
) {
  const actor = uniqueActor(content, actorKey);
  if (!actor) return false;
  const raw = actor[field === 'introduction' ? 'publicCard' : 'lifeModules'];
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) return false;
  const value = record(raw)[field];
  return value === undefined || typeof value === 'string';
}
/** Edit exactly one authored field. Preserve the other modules and all legacy settings. */
export function updateCharacterField(
  content: Record<string, unknown>,
  actorKey: string,
  field: CharacterModuleKey | 'introduction',
  value: string,
): Record<string, unknown> {
  const actor = uniqueActor(content, actorKey);
  if (!actor || !characterFieldEditable(content, actorKey, field)) return content;
  const container = field === 'introduction' ? 'publicCard' : 'lifeModules';
  const fields = { ...record(actor[container]) };
  if (value.trim()) fields[field] = value;
  else delete fields[field];
  const updated = { ...actor, [container]: fields };
  return {
    ...content,
    actors: (content.actors as unknown[]).map((a) => (a === actor ? updated : a)),
  };
}
export type CharacterPreviewMessage = {
  key: string;
  text: string;
  at: string;
  speaker: 'actor' | 'player';
};
export type CharacterPreviewMoment = { key: string; text: string; at: string; image?: string };
function chronological<T extends { at: string }>(entries: T[]) {
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
/** Public preview uses an explicit allowlist, never the private persona or five authored modules. */
export function characterPreview(content: Record<string, unknown>, actorKey: string) {
  const actor = uniqueActor(content, actorKey);
  if (!actor) return undefined;
  const card = record(actor.publicCard),
    phone = record(content.phone);
  const known = actor.knownAtStart === true;
  const start = Date.parse(string(record(content.world).startAt));
  const occurred = (entry: Record<string, unknown>) => {
    const at = Date.parse(string(entry.at));
    return Number.isFinite(at) && (!Number.isFinite(start) || at <= start);
  };
  const messages: CharacterPreviewMessage[] = known
    ? rows(phone.messages)
        .filter(
          (m) =>
            m.actorKey === actorKey &&
            string(m.text).trim() &&
            occurred(m) &&
            (m.speaker === undefined || m.speaker === 'actor' || m.speaker === 'player'),
        )
        .map((m, index) => ({
          key: string(m.key) || `message-${index}`,
          text: string(m.text),
          at: string(m.at),
          speaker: m.speaker === 'player' ? 'player' : 'actor',
        }))
    : [];
  const moments: CharacterPreviewMoment[] = known
    ? rows(phone.moments)
        .filter((m) => m.actorKey === actorKey && string(m.text).trim() && occurred(m))
        .map((m, index) => ({
          key: string(m.key) || `moment-${index}`,
          text: string(m.text),
          at: string(m.at),
          ...(typeof m.image === 'string' && m.image ? { image: m.image } : {}),
        }))
    : [];
  return {
    name: string(actor.name),
    identity: string(card.identity),
    introduction: string(card.introduction),
    avatar: publisherArtUrl(content, string(card.avatarMediaKey) || undefined, 'avatar'),
    knownAtStart: known,
    messages: chronological(messages),
    moments: chronological(moments).reverse(),
  };
}
export function characterPreviewTime(at: string) {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return '';
  const local = new Date(time + 8 * 60 * 60 * 1000).toISOString();
  return `${Number(local.slice(5, 7))}月${Number(local.slice(8, 10))}日 ${local.slice(11, 16)}`;
}
