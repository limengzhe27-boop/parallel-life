import { publisherArtUrl } from './publisher-art-model.ts';

export const CHARACTER_MODULES = [
  { key: 'lifeContext', label: '人生背景' },
  { key: 'traits', label: '人格特质' },
  { key: 'drives', label: '动机与价值观' },
  { key: 'behavior', label: '行为模式' },
  { key: 'relationships', label: '关系模型' },
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
/** Edit exactly one authored field. Preserve the other modules and all legacy settings. */
export function updateCharacterField(
  content: Record<string, unknown>,
  actorKey: string,
  field: CharacterModuleKey | 'introduction',
  value: string,
): Record<string, unknown> {
  const actor = uniqueActor(content, actorKey);
  if (!actor) return content;
  const container = field === 'introduction' ? 'publicCard' : 'lifeModules';
  const updated = { ...actor, [container]: { ...record(actor[container]), [field]: value } };
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
export type CharacterPreviewMoment = { key: string; text: string; at: string };
function chronological<T extends { at: string }>(entries: T[]) {
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
/** Public preview uses an explicit allowlist, never the private persona or five authored modules. */
export function characterPreview(content: Record<string, unknown>, actorKey: string) {
  const actor = uniqueActor(content, actorKey);
  if (!actor) return undefined;
  const card = record(actor.publicCard),
    phone = record(content.phone);
  const known = actor.knownAtStart !== false;
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
