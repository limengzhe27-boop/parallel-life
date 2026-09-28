import type { ProfileFact } from './types.ts';

export const BASIC_FIELDS = ['姓名', '生日', '出生时间', '所在城市', '职业', '家乡'] as const;
export type BasicField = (typeof BASIC_FIELDS)[number];
/** Structural Profile input; domain does not import the API or validation framework. */
export type ProfileViewInput = {
  id: string;
  version: number;
  facts: readonly ProfileFact[];
  events: readonly {
    id: string;
    title: string;
    date: string | null;
    sourceMessageIds: readonly string[];
  }[];
  people: readonly { id: string; name: string; relationship: string; assetId: string | null }[];
};
export type ProfileViewItem = {
  ref: { kind: 'fact' | 'event' | 'person'; id: string; basicField?: BasicField };
  text: string;
  category: string;
  storedStatus: 'suggested' | 'confirmed' | 'unspecified';
  sourceMessageIds: string[];
  evidence: 'source_refs_only' | 'unspecified';
  time?: { value: string | null; precision: 'year' | 'month' | 'day' | 'unknown' };
};
export type ProfileView = {
  profileId: string;
  profileVersion: number;
  current: ProfileViewItem[];
  interestsAndWishes: ProfileViewItem[];
  experiences: ProfileViewItem[];
  people: ProfileViewItem[];
  unresolved: ProfileViewItem[];
};

export function readBasicInfo(value: string) {
  const values: Partial<Record<BasicField, string>> = {};
  const remaining: string[] = [];
  for (const line of value.split('\n').slice(1)) {
    const field = BASIC_FIELDS.find((label) => line.startsWith(`${label}：`));
    // Preserve unknown and duplicate lines, rather than silently overwriting history.
    if (!field || values[field] !== undefined || !line.slice(field.length + 1).trim()) {
      remaining.push(line);
    } else values[field] = line.slice(field.length + 1);
  }
  return { values, remaining };
}

export function writeBasicInfo(
  original: string | undefined,
  values: Partial<Record<BasicField, string>>,
  reviewedBirthday = false,
) {
  const remaining = original ? readBasicInfo(original).remaining : [];
  return [
    '个人资料',
    ...BASIC_FIELDS.filter((field) => values[field]?.trim()).map(
      (field) => `${field}：${values[field]!.trim()}`,
    ),
    ...remaining.filter((line) => !reviewedBirthday || !legacyBirthday(line)),
  ].join('\n');
}

/** Legacy AI facts can contain a birthday outside the basic-info record. They are
 * evidence to review, never an authority to overwrite the user's current card. */
export function legacyBirthday(value: string): string | null {
  const raw = value.trim();
  const match = raw.match(
    /^(?:出生年月日|出生日期|生日)[：:]\s*(.+)$|^(?:我)?(?:出生于|生于|的生日是)\s*(.+)$/u,
  );
  if (!match) return null;
  const text = (match[1] ?? match[2] ?? '')
    .replace(/年|月/g, '-')
    .replace(/[日号]$/u, '')
    .replace(/-$/u, '')
    .trim();
  const parts = text.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/u);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = parts[2] ? Number(parts[2]) : null;
  const day = parts[3] ? Number(parts[3]) : null;
  if (year < 1900 || year > 2100 || (month !== null && (month < 1 || month > 12))) return null;
  if (day !== null) {
    const date = new Date(Date.UTC(year, month! - 1, day));
    if (date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  }
  return `${year}${month === null ? '' : `-${String(month).padStart(2, '0')}`}${day === null ? '' : `-${String(day).padStart(2, '0')}`}`;
}

export function collectBasicInfo(profile: Pick<ProfileViewInput, 'facts'>) {
  const facts = profile.facts.filter(
    (fact) => fact.category === 'identity' && fact.status === 'confirmed',
  );
  const canonical = facts
    .filter((fact) => fact.value.startsWith('个人资料\n'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
  const values = readBasicInfo(canonical?.value ?? '个人资料\n').values;
  const birthdays = new Set<string>();
  if (values['生日']) birthdays.add(values['生日']);
  for (const line of readBasicInfo(canonical?.value ?? '个人资料\n').remaining) {
    const date = legacyBirthday(line);
    if (date) birthdays.add(date);
  }
  for (const fact of facts) {
    if (fact.id === canonical?.id) continue;
    if (fact.value.startsWith('个人资料\n')) {
      const date = readBasicInfo(fact.value).values['生日'];
      if (date) birthdays.add(date);
    } else {
      const date = legacyBirthday(fact.value);
      if (date) birthdays.add(date);
    }
  }
  const birthdateClaims = [...birthdays];
  const birthdayConflict = birthdateClaims.some((a, i) =>
    birthdateClaims
      .slice(i + 1)
      .some((b) => a !== b && !a.startsWith(`${b}-`) && !b.startsWith(`${a}-`)),
  );
  return { canonical, values, birthdateClaims, birthdayConflict };
}

/** The only identity record downstream Agents may read or carry into a world. */
export function usableProfileFact(profile: Pick<ProfileViewInput, 'facts'>, fact: ProfileFact) {
  if (fact.status !== 'confirmed') return null;
  if (fact.category !== 'identity') return { category: fact.category, value: fact.value };
  const basic = collectBasicInfo(profile);
  if (fact.id !== basic.canonical?.id) return null;
  const values = { ...basic.values };
  if (basic.birthdayConflict) delete values['生日'];
  if (!Object.keys(values).length) return null;
  return { category: fact.category, value: writeBasicInfo(undefined, values) };
}

function time(value: string | null): NonNullable<ProfileViewItem['time']> {
  return {
    value,
    precision:
      value === null
        ? 'unknown'
        : /^\d{4}$/.test(value)
          ? 'year'
          : /^\d{4}-\d{2}$/.test(value)
            ? 'month'
            : /^\d{4}-\d{2}-\d{2}$/.test(value)
              ? 'day'
              : 'unknown',
  };
}

/** Lossless categorization, not semantic extraction or a claim of verified truth. */
export function projectProfileView(profile: ProfileViewInput): ProfileView {
  const basicInfo = collectBasicInfo(profile);
  const view: ProfileView = {
    profileId: profile.id,
    profileVersion: profile.version,
    current: [],
    interestsAndWishes: [],
    experiences: [],
    people: [],
    unresolved: [],
  };
  for (const fact of profile.facts) {
    if (fact.status === 'rejected') continue;
    const item: ProfileViewItem = {
      ref: { kind: 'fact', id: fact.id },
      text: fact.value,
      category: fact.category,
      storedStatus: fact.status,
      sourceMessageIds: [...fact.sourceMessageIds],
      evidence: fact.sourceMessageIds.length ? 'source_refs_only' : 'unspecified',
    };
    if (fact.category === 'identity' && fact.id === basicInfo.canonical?.id) {
      const basic = readBasicInfo(fact.value);
      for (const field of BASIC_FIELDS) {
        const value = basic.values[field];
        if (value !== undefined && !(field === '生日' && basicInfo.birthdayConflict))
          view.current.push({
            ...item,
            ref: { ...item.ref, basicField: field },
            sourceMessageIds: [...item.sourceMessageIds],
            text: value,
            ...(field === '生日' ? { time: time(value) } : {}),
          });
      }
      if (basic.remaining.length || !Object.keys(basic.values).length)
        view.unresolved.push({ ...item, text: basic.remaining.join('\n') || fact.value });
    } else if (fact.category === 'identity') view.unresolved.push(item);
    else if (['interest', 'wish', 'personality'].includes(fact.category))
      view.interestsAndWishes.push(item);
    else if (fact.category === 'experience') view.experiences.push(item);
    else if (fact.category === 'relationship') view.people.push(item);
    else view.unresolved.push(item);
  }
  for (const event of profile.events)
    view.experiences.push({
      ref: { kind: 'event', id: event.id },
      text: event.title,
      category: 'experience',
      storedStatus: 'unspecified',
      sourceMessageIds: [...event.sourceMessageIds],
      evidence: event.sourceMessageIds.length ? 'source_refs_only' : 'unspecified',
      time: time(event.date),
    });
  for (const person of profile.people)
    view.people.push({
      ref: { kind: 'person', id: person.id },
      text: `${person.name} · ${person.relationship}`,
      category: 'relationship',
      storedStatus: 'unspecified',
      sourceMessageIds: [],
      evidence: 'unspecified',
    });
  return view;
}
