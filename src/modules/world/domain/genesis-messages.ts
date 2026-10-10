import type { Message } from './types.ts';
import { isoInstant } from './validation.ts';

export type MessageHistoryProposal = {
  version: 1;
  messages: {
    key: string;
    actorKey: string;
    text: string;
    minutesBeforeStart: number;
    replyToKey?: string;
  }[];
};
const keyPattern = /^[a-z0-9_]{1,32}$/;
const invalid = (): never => {
  throw new Error('INVALID_MESSAGE_HISTORY');
};

/** Validate model references again at the write boundary, before assigning any stored ID. */
export function validateMessageHistory(
  history: MessageHistoryProposal | undefined,
  actorKeys: readonly string[],
): asserts history is MessageHistoryProposal {
  if (!history) return invalid();
  if (
    history.version !== 1 ||
    !Array.isArray(history.messages) ||
    Object.keys(history).some((key) => !['version', 'messages'].includes(key)) ||
    history.messages.length < actorKeys.length ||
    history.messages.length > 48 ||
    actorKeys.length < 2 ||
    actorKeys.length > 8 ||
    actorKeys.some((key) => typeof key !== 'string' || !/^[a-z0-9_]{1,24}$/.test(key)) ||
    new Set(actorKeys).size !== actorKeys.length
  )
    invalid();
  const actors = new Set(actorKeys),
    entries = new Map<string, MessageHistoryProposal['messages'][number]>(),
    counts = new Map<string, number>(),
    instants = new Set<string>();
  for (const entry of history.messages) {
    if (
      !entry ||
      Object.keys(entry).some(
        (key) => !['key', 'actorKey', 'text', 'minutesBeforeStart', 'replyToKey'].includes(key),
      ) ||
      typeof entry.key !== 'string' ||
      !keyPattern.test(entry.key) ||
      entries.has(entry.key) ||
      !actors.has(entry.actorKey) ||
      typeof entry.text !== 'string' ||
      !entry.text.trim() ||
      entry.text.length > 160 ||
      !Number.isInteger(entry.minutesBeforeStart) ||
      entry.minutesBeforeStart < 60 ||
      entry.minutesBeforeStart > 43200 ||
      (entry.replyToKey !== undefined &&
        (typeof entry.replyToKey !== 'string' || !keyPattern.test(entry.replyToKey)))
    )
      invalid();
    const instant = `${entry.actorKey}:${entry.minutesBeforeStart}`;
    if (instants.has(instant)) invalid();
    instants.add(instant);
    entries.set(entry.key, entry);
    counts.set(entry.actorKey, (counts.get(entry.actorKey) ?? 0) + 1);
  }
  for (const actor of actors) if (!counts.get(actor) || counts.get(actor)! > 6) invalid();
  for (const entry of history.messages) {
    if (entry.replyToKey === undefined) continue;
    const previous = entries.get(entry.replyToKey);
    // Strictly earlier, same conversation: this also rules out self-reference and cycles.
    if (
      !previous ||
      previous.actorKey !== entry.actorKey ||
      previous.minutesBeforeStart <= entry.minutesBeforeStart
    )
      invalid();
  }
}

/** One immutable, NPC-only baseline. Time and IDs come exclusively from the runtime. */
export function genesisMessages(input: {
  worldId: string;
  startAt: string;
  actors: ReadonlyMap<string, string>;
  history: MessageHistoryProposal | undefined;
  current: readonly { actorKey: string; text: string }[];
  newId: () => string;
}): Message[] {
  validateMessageHistory(input.history, [...input.actors.keys()]);
  const startAt = isoInstant(input.startAt),
    start = Date.parse(startAt);
  if (
    input.current.length < 1 ||
    input.current.length > 4 ||
    input.current.some(
      (entry) =>
        !input.actors.has(entry.actorKey) ||
        typeof entry.text !== 'string' ||
        !entry.text.trim() ||
        entry.text.length > 160,
    )
  )
    invalid();
  const ids = new Map(input.history.messages.map((entry) => [entry.key, input.newId()]));
  const sourceEventId = `genesis:${input.worldId}`;
  const history: Message[] = input.history.messages.map((entry) => ({
    id: ids.get(entry.key)!,
    actorId: input.actors.get(entry.actorKey)!,
    role: 'assistant',
    text: entry.text,
    at: new Date(start - entry.minutesBeforeStart * 60_000).toISOString(),
    sourceEventId,
    initialRead: true,
    history: {
      version: 1,
      key: entry.key,
      ...(entry.replyToKey ? { replyToMessageId: ids.get(entry.replyToKey)! } : {}),
    },
  }));
  const current: Message[] = input.current.map((entry, index) => ({
    id: input.newId(),
    actorId: input.actors.get(entry.actorKey)!,
    role: 'assistant',
    text: entry.text,
    at: new Date(start - (input.current.length - index - 1) * 1000).toISOString(),
    sourceEventId,
    initialRead: false,
  }));
  const messages = [...history, ...current].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (new Set(messages.map((entry) => entry.id)).size !== messages.length) invalid();
  return messages;
}
