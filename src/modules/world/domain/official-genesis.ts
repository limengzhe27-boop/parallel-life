import type { WorldState } from './types.ts';
import { isoInstant, validateEventId } from './validation.ts';

/** Trusted editorial inputs still require reference, time and visibility validation. */
export type OfficialOpeningDraft = {
  startAt: string;
  identity: string;
  setting: string;
  actors: { key: string; name: string; relationship: string; persona: string }[];
  actorTies: { fromKey: string; toKey: string; relationship: string; mayShare: boolean }[];
  facts: {
    key: string;
    text: string;
    visibility: { kind: 'owner' } | { kind: 'world' } | { kind: 'actors'; actorKeys: string[] };
  }[];
  messages: {
    key: string;
    actorKey: string;
    text: string;
    minutesBeforeStart: number;
    history: boolean;
  }[];
  invitations: {
    key: string;
    title: string;
    minutesAfterStart: number;
    actorKeys: string[];
    sourceMessageKey: string;
  }[];
  /** Read-only player-known material excerpts. No hidden plot or fabricated file links. */
  notes: { key: string; title: string; text: string }[];
};

const keyPattern = /^[a-z0-9_]{1,32}$/;
function invalid(): never {
  throw Error('INVALID_OFFICIAL_OPENING');
}
function text(value: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid();
}
function keys(items: { key: string }[]) {
  if (
    items.some((item) => !keyPattern.test(item.key)) ||
    new Set(items.map((i) => i.key)).size !== items.length
  )
    invalid();
}
export function officialGenesis(input: {
  opening: OfficialOpeningDraft;
  presetId: string;
  contentVersion: number;
  worldId: string;
  ownerId: string;
  title: string;
  newId: () => string;
}): WorldState {
  const o = input.opening;
  validateEventId(input.worldId);
  if (!input.ownerId || !Number.isInteger(input.contentVersion) || input.contentVersion < 1)
    invalid();
  text(input.title, 80);
  text(o.identity, 400);
  text(o.setting, 500);
  const time = isoInstant(new Date(o.startAt).toISOString()),
    start = Date.parse(time);
  if (
    o.actors.length !== 6 ||
    o.facts.length > 32 ||
    o.messages.length > 48 ||
    o.invitations.length > 2 ||
    o.notes.length > 8 ||
    o.actorTies.length > 28
  )
    invalid();
  for (const list of [o.actors, o.facts, o.messages, o.invitations, o.notes]) keys(list);
  const ids = new Map(o.actors.map((a) => [a.key, input.newId()]));
  if (new Set(ids.values()).size !== ids.size) invalid();
  for (const id of ids.values()) validateEventId(id);
  const actors = o.actors.map((a) => {
    text(a.name, 80);
    text(a.relationship, 600);
    text(a.persona, 1200);
    return { id: ids.get(a.key)!, name: a.name, relationship: a.relationship, persona: a.persona };
  });
  const visibleActorIds = (actorKeys: string[]) => {
    if (
      !actorKeys.length ||
      new Set(actorKeys).size !== actorKeys.length ||
      actorKeys.some((k) => !ids.has(k))
    )
      invalid();
    return actorKeys.map((k) => ids.get(k)!);
  };
  const sourceEventId = 'genesis:' + input.worldId;
  const historyCounts = new Map<string, number>();
  const messageIds = new Map(o.messages.map((m) => [m.key, input.newId()]));
  const current = o.messages.filter((m) => !m.history);
  if (current.length !== 3 || new Set(current.map((m) => m.actorKey)).size !== 3) invalid();
  const instants = new Set<string>();
  const messages = o.messages
    .map((m) => {
      if (
        !ids.has(m.actorKey) ||
        !Number.isInteger(m.minutesBeforeStart) ||
        m.minutesBeforeStart < (m.history ? 60 : 0) ||
        m.minutesBeforeStart > (m.history ? 525600 : 119)
      )
        invalid();
      text(m.text, 160);
      const instant = m.actorKey + ':' + m.minutesBeforeStart;
      if (instants.has(instant)) invalid();
      instants.add(instant);
      if (m.history) historyCounts.set(m.actorKey, (historyCounts.get(m.actorKey) ?? 0) + 1);
      return {
        id: messageIds.get(m.key)!,
        actorId: ids.get(m.actorKey)!,
        role: 'assistant' as const,
        text: m.text,
        at: new Date(start - m.minutesBeforeStart * 60000).toISOString(),
        sourceEventId,
        initialRead: m.history,
        ...(m.history ? { history: { version: 1 as const, key: m.key } } : {}),
      };
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (o.actors.some((a) => !historyCounts.get(a.key) || historyCounts.get(a.key)! > 6)) invalid();
  const state: WorldState = {
    schemaVersion: 1,
    id: input.worldId,
    ownerId: input.ownerId,
    version: 0,
    title: input.title,
    time,
    messageHistory: { version: 1, startAt: time, timeZone: 'UTC+08:00' },
    actors,
    actorTies: o.actorTies.map((t) => {
      if (
        t.fromKey === t.toKey ||
        !ids.has(t.fromKey) ||
        !ids.has(t.toKey) ||
        typeof t.mayShare !== 'boolean'
      )
        invalid();
      text(t.relationship, 200);
      return {
        fromActorId: ids.get(t.fromKey)!,
        toActorId: ids.get(t.toKey)!,
        relationship: t.relationship,
        mayShare: t.mayShare,
      };
    }),
    facts: o.facts.map((f) => {
      text(f.text, 1000);
      const visibility =
        f.visibility.kind === 'actors'
          ? { kind: 'actors' as const, actorIds: visibleActorIds(f.visibility.actorKeys) }
          : f.visibility.kind === 'owner' || f.visibility.kind === 'world'
            ? { kind: f.visibility.kind }
            : invalid();
      return {
        id: input.newId(),
        text: f.text,
        kind: 'canonical' as const,
        visibility,
        sourceEventId,
      };
    }),
    messages,
    appointments: o.invitations.map((i) => {
      text(i.title, 120);
      const source = o.messages.find((m) => m.key === i.sourceMessageKey);
      if (
        !source ||
        !i.actorKeys.includes(source.actorKey) ||
        !Number.isInteger(i.minutesAfterStart) ||
        i.minutesAfterStart < 1 ||
        i.minutesAfterStart > 10080
      )
        invalid();
      return {
        id: input.newId(),
        title: i.title,
        at: new Date(start + i.minutesAfterStart * 60000).toISOString(),
        participantIds: visibleActorIds(i.actorKeys),
        sourceEventId,
        sourceMessageId: messageIds.get(i.sourceMessageKey)!,
        status: 'proposed' as const,
      };
    }),
    officialLife: {
      presetId: input.presetId,
      version: input.contentVersion,
      contacts: actors.map((a) => ({ actorId: a.id, relationship: a.relationship })),
      notes: o.notes.map((n) => {
        text(n.title, 80);
        text(n.text, 1000);
        return { ...n };
      }),
    },
    mediaRequests: [],
  };
  const allIds = [
    state.id,
    ...state.actors.map((a) => a.id),
    ...state.messages.map((m) => m.id),
    ...state.facts.map((f) => f.id),
    ...state.appointments.map((a) => a.id),
  ];
  if (new Set(allIds).size !== allIds.length) invalid();
  for (const id of allIds) validateEventId(id);
  if (JSON.stringify(state).length > 50000) invalid();
  return state;
}
