import type { PublicationIssue } from './publication-content.ts';
import { mergePublicationPreparation } from './publication-preparation.ts';
import { preparationCharacterNames } from './publication-preparation-scope.ts';

type RecordValue = Record<string, unknown>;
type Source = { filename: string; content: string };
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (v: unknown): RecordValue[] => (Array.isArray(v) ? v.filter(record) : []);
const validKey = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function validCharacterPreviewTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    return false;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 19) === value.slice(0, 19);
}
export function characterPreviewReferenceAt(
  content: RecordValue,
  scheduling?: { referenceAt: string },
) {
  const authored = record(content.world) ? content.world.startAt : undefined;
  return validCharacterPreviewTime(authored)
    ? authored
    : validCharacterPreviewTime(scheduling?.referenceAt)
      ? scheduling!.referenceAt
      : undefined;
}
/** Supply the requested subjects and their existing phone entries, never another person's private context. */
export function characterPreparationContext(content: RecordValue, sources: readonly Source[]) {
  const names = new Set(preparationCharacterNames(sources));
  const actors = rows(content.actors).filter(
    (a) => typeof a.name === 'string' && names.has(a.name),
  );
  const keys = new Set(actors.map((a) => a.key));
  const context: RecordValue = Object.hasOwn(content, 'actors') ? { actors } : {};
  const phone = record(content.phone) ? content.phone : {};
  const messages = rows(phone.messages)
    .filter((m) => keys.has(m.actorKey))
    .map((m) => ({
      key: m.key,
      actorKey: m.actorKey,
      origin: m.origin,
      text: m.text,
      at: m.at,
      ...(Object.hasOwn(m, 'speaker') ? { speaker: m.speaker } : {}),
    }));
  const moments = rows(phone.moments)
    .filter((m) => keys.has(m.actorKey))
    .map((m) => ({ key: m.key, actorKey: m.actorKey, text: m.text, at: m.at }));
  if (messages.length || moments.length)
    context.phone = {
      ...(messages.length ? { messages } : {}),
      ...(moments.length ? { moments } : {}),
    };
  return context;
}

/** Only an explicitly labeled public introduction can be lifted from the source document. */
export function explicitCharacterIntroductions(sources: readonly Source[]) {
  const found = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (name: string | undefined, value: string) => {
    const clean = value.trim();
    if (!name || !text(clean, 1600) || ambiguous.has(name)) return;
    if (found.has(name) && found.get(name) !== clean) {
      found.delete(name);
      ambiguous.add(name);
    } else found.set(name, clean);
  };
  const label =
    '(?:给玩家看的(?:角色)?介绍|给用户展示的(?:一段)?(?:角色)?介绍|玩家可见(?:的)?介绍|公开介绍|角色介绍)';
  for (const source of sources) {
    const names = preparationCharacterNames([source]);
    let current = names.length === 1 ? names[0] : undefined;
    const lines = source.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.replace(/\*\*/g, '').trim();
      const named = line.match(
        /^(?:#{1,6}\s*)?(?:姓名|名字|人物(?:\s*\d+)?|角色(?:\s*\d+)?|name)\s*[:：]\s*(.+)$/i,
      );
      if (named) current = names.find((name) => name === named[1]!.trim());
      else if (/^#\s+/.test(line)) {
        const heading = line.replace(/^#\s+/, '').trim();
        if (names.includes(heading)) current = heading;
      }
      const inline = line.match(new RegExp(`^(?:#{1,6}\\s*|[-*]\\s*)?${label}\\s*[:：]\\s*(.+)$`));
      const table = line.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*([^|]+)\\|`));
      if (inline || table) {
        add(current, (inline ?? table)![1]!);
        continue;
      }
      if (!new RegExp(`^#{1,6}\\s+${label}\\s*[:：]?\\s*$`).test(line)) continue;
      const paragraph: string[] = [];
      while (i + 1 < lines.length && !/^\s{0,3}#{1,6}\s/.test(lines[i + 1]!)) {
        const next = lines[++i]!;
        if (!next.trim() && paragraph.length) break;
        if (next.trim()) paragraph.push(next);
      }
      add(current, paragraph.join('\n'));
    }
  }
  return found;
}
export function protectCharacterIntroduction(
  actor: RecordValue,
  baseline: RecordValue,
  introductions: ReadonlyMap<string, string>,
) {
  const card = record(actor.publicCard) ? actor.publicCard : undefined;
  if (!card) return { actor, review: false };
  const old = rows(baseline.actors).find((a) => a.key === actor.key);
  if (old && record(old.publicCard) && text(old.publicCard.introduction, 1600))
    return { actor, review: false };
  const explicit = typeof actor.name === 'string' ? introductions.get(actor.name) : undefined;
  if (explicit)
    return {
      actor: { ...actor, publicCard: { ...card, introduction: explicit } },
      review: card.introduction !== explicit,
    };
  const { introduction: _unconfirmed, ...publicCard } = card;
  return {
    actor: Object.hasOwn(card, 'introduction') ? { ...actor, publicCard } : actor,
    review: true,
  };
}

/** Character-only proposals may append verified history/daily posts for these subjects. The world is immutable here. */
export function mergeCharacterPreviewProposal(
  baseline: RecordValue,
  proposal: RecordValue,
  allowedActorKeys: ReadonlySet<string>,
  referenceAt?: string,
) {
  const issues: PublicationIssue[] = [];
  const reviews: PublicationIssue[] = [];
  const priorPhone = record(baseline.phone) ? baseline.phone : {};
  const nextPhone = record(proposal.phone) ? proposal.phone : {};
  const actors = rows(baseline.actors);
  const phone: RecordValue = {};
  const add = (path: (string | number)[], code: string) => issues.push({ path, code });
  const oldEntries = [...rows(priorPhone.messages), ...rows(priorPhone.moments)];
  for (const kind of ['messages', 'moments'] as const) {
    if (!Object.hasOwn(nextPhone, kind)) continue;
    const values = nextPhone[kind];
    if (!Array.isArray(values)) {
      add(['phone', kind], 'character_preview_shape_invalid');
      continue;
    }
    if (Object.hasOwn(baseline, 'phone') && !record(baseline.phone)) {
      add(['phone', kind], 'character_preview_existing_collection_invalid');
      continue;
    }
    if (Object.hasOwn(priorPhone, kind) && !Array.isArray(priorPhone[kind])) {
      add(['phone', kind], 'character_preview_existing_collection_invalid');
      continue;
    }
    const prior = rows(priorPhone[kind]);
    const accepted: RecordValue[] = [];
    const max = kind === 'messages' ? 40 : 48;
    const keys = new Map<unknown, number>();
    for (const entry of values)
      if (record(entry)) keys.set(entry.key, (keys.get(entry.key) ?? 0) + 1);
    for (const [index, entry] of values.entries()) {
      const path: (string | number)[] = ['phone', kind, index];
      if (record(entry) && validKey(entry.key) && validKey(entry.actorKey)) {
        if (oldEntries.some((old) => old.key === entry.key && old.actorKey !== entry.actorKey)) {
          add([...path, 'key'], 'character_preview_key_conflict');
          continue;
        }
        const original = prior.find(
          (old) => old.key === entry.key && old.actorKey === entry.actorKey,
        );
        if (original) {
          // In particular, an old message without speaker is still an actor message.
          // Filling that blank with player would silently change who originally spoke.
          if (JSON.stringify(original) !== JSON.stringify(entry))
            reviews.push({ path, code: 'authored_value_preserved' });
          continue;
        }
      }
      const fields =
        kind === 'messages'
          ? ['key', 'actorKey', 'origin', 'speaker', 'text', 'at']
          : ['key', 'actorKey', 'text', 'at'];
      if (
        !record(entry) ||
        !validKey(entry.key) ||
        !validKey(entry.actorKey) ||
        !text(entry.text, kind === 'messages' ? 500 : 1600) ||
        Object.keys(entry).some((k) => !fields.includes(k)) ||
        (kind === 'messages' &&
          (entry.origin !== 'history' ||
            (entry.speaker !== undefined &&
              entry.speaker !== 'actor' &&
              entry.speaker !== 'player')))
      ) {
        add(path, 'character_preview_shape_invalid');
        continue;
      }
      if ((keys.get(entry.key) ?? 0) !== 1) {
        add([...path, 'key'], 'character_preview_duplicate_key');
        continue;
      }
      const subject = actors.filter((a) => a.key === entry.actorKey);
      if (!allowedActorKeys.has(entry.actorKey) || subject.length !== 1) {
        add([...path, 'actorKey'], 'character_preview_subject_unconfirmed');
        continue;
      }
      if (subject[0]!.knownAtStart !== true) {
        add([...path, 'actorKey'], 'character_preview_relationship_unconfirmed');
        continue;
      }
      if (oldEntries.some((old) => old.key === entry.key && old.actorKey !== entry.actorKey)) {
        add([...path, 'key'], 'character_preview_key_conflict');
        continue;
      }
      if (!validCharacterPreviewTime(entry.at)) {
        add([...path, 'at'], 'character_preview_invalid_time');
        continue;
      }
      if (!validCharacterPreviewTime(referenceAt)) {
        add([...path, 'at'], 'character_preview_time_reference_required');
        continue;
      }
      if (
        Date.parse(entry.at) > Date.parse(referenceAt) ||
        (kind === 'messages' && Date.parse(entry.at) === Date.parse(referenceAt))
      ) {
        add([...path, 'at'], 'character_preview_not_history');
        continue;
      }
      if (
        !prior.some((old) => old.key === entry.key) &&
        prior.length + accepted.filter((a) => !prior.some((old) => old.key === a.key)).length >= max
      ) {
        add(path, 'character_preview_collection_budget');
        continue;
      }
      accepted.push(entry);
    }
    // Old actors-only responses and empty collections do not manufacture phone fields.
    if (accepted.length) phone[kind] = accepted;
  }
  if (!Object.keys(phone).length) return { updatedContent: baseline, issues, reviews };
  const merged = mergePublicationPreparation(baseline, { phone });
  return { ...merged, reviews: [...reviews, ...merged.reviews], issues };
}

/** A confirmed familiar relationship provides enough fictional context for ordinary preview content.
 * This checks completeness of the proposal, never fabricates lines or changes an author's dates. */
export function characterPreviewCompletenessIssues(
  baseline: RecordValue,
  updated: RecordValue,
  sources: readonly Source[],
  referenceAt?: string,
  allAuthoredActors = false,
): PublicationIssue[] {
  if (!validCharacterPreviewTime(referenceAt)) return [];
  const names = new Set(preparationCharacterNames(sources));
  const actors = rows(baseline.actors);
  const phone = record(updated.phone) ? updated.phone : {};
  const issues: PublicationIssue[] = [];
  for (const [index, actor] of actors.entries()) {
    const modules = record(actor.lifeModules) ? actor.lifeModules : {};
    if (
      !validKey(actor.key) ||
      typeof actor.name !== 'string' ||
      (!allAuthoredActors && !names.has(actor.name)) ||
      actor.knownAtStart !== true ||
      !text(modules.relationships, 4000) ||
      actors.filter((a) => a.key === actor.key).length !== 1
    )
      continue;
    const history = rows(phone.messages).filter(
      (m) =>
        m.actorKey === actor.key &&
        m.origin === 'history' &&
        text(m.text, 500) &&
        validCharacterPreviewTime(m.at) &&
        Date.parse(m.at) < Date.parse(referenceAt),
    );
    const hasActor = history.some((m) => m.speaker === undefined || m.speaker === 'actor');
    const hasPlayer = history.some((m) => m.speaker === 'player');
    if (!hasActor || !hasPlayer)
      issues.push({
        path: ['actors', index, 'historyPreview'],
        code: 'character_preview_history_missing',
      });
    if (
      !rows(phone.moments).some(
        (m) =>
          m.actorKey === actor.key &&
          text(m.text, 1600) &&
          validCharacterPreviewTime(m.at) &&
          Date.parse(m.at) <= Date.parse(referenceAt),
      )
    )
      issues.push({
        path: ['actors', index, 'momentsPreview'],
        code: 'character_preview_moments_missing',
      });
  }
  return issues;
}
