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
) {
  const remaining = original ? readBasicInfo(original).remaining : [];
  return [
    '个人资料',
    ...BASIC_FIELDS.filter((field) => values[field]?.trim()).map(
      (field) => `${field}：${values[field]!.trim()}`,
    ),
    ...remaining,
  ].join('\n');
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
    if (fact.category === 'identity' && fact.value.startsWith('个人资料\n')) {
      const basic = readBasicInfo(fact.value);
      for (const field of BASIC_FIELDS) {
        const value = basic.values[field];
        if (value !== undefined)
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
    } else if (fact.category === 'identity') view.current.push(item);
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
