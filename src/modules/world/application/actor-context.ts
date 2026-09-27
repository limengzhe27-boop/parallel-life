import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import type { ActorContext } from './ports.ts';
import { rankAndBudgetMemories } from '../../memory/domain/algorithms.ts';
import type { MemoryRecord } from '../../memory/domain/types.ts';

// Serialized character limits, not a claim about a model's tokenizer. The planner must
// reserve additional space for its instructions and output. Source records stay intact.
export const ACTOR_INPUT_LIMIT = 24_000;
export const ACTOR_CONTEXT_LIMIT = 18_000;
const RECENT_LIMIT = 12;
const HISTORICAL_LIMIT = 8;

function terms(query: string): string[] {
  const matches = query.toLocaleLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) ?? [];
  return [
    ...new Set(
      matches.flatMap((part) =>
        /^[\p{Script=Han}]+$/u.test(part)
          ? Array.from({ length: Math.max(0, part.length - 1) }, (_, i) => part.slice(i, i + 2))
          : [part],
      ),
    ),
  ].slice(0, 128);
}
function relevance(text: string, words: string[]): number {
  const normalized = text.toLocaleLowerCase();
  return words.reduce((score, word) => score + (normalized.includes(word) ? 1 : 0), 0);
}

/** Filter before ranking; private records cannot influence retrieval or consume its budget. */
export function actorContext(
  state: WorldState,
  actorId: string,
  userText = '',
  memoryRecords: MemoryRecord[] = [],
  blockedSources: Set<string> = new Set(),
): ActorContext {
  const actor = state.actors.find((item) => item.id === actorId);
  if (!actor || userText.length > 4000) throw new DomainError('INVALID_COMMAND');
  const context: ActorContext = {
    worldId: state.id,
    worldVersion: state.version,
    worldTitle: state.title,
    time: state.time,
    actor: {
      id: actor.id,
      name: actor.name,
      relationship: (actor as { relationship?: string }).relationship,
      persona: actor.persona,
    },
    facts: [],
    messages: [],
    appointments: [],
    retrievedMemories: [],
  };
  const fits = () =>
    JSON.stringify(context).length <= ACTOR_CONTEXT_LIMIT &&
    JSON.stringify({ context, userText }).length <= ACTOR_INPUT_LIMIT;
  if (!fits())
    throw new DomainError('INVALID_COMMAND', 'Character identity exceeds context budget');
  const words = terms(userText);
  const messages = state.messages.filter(
    (message) =>
      message.actorId === actorId &&
      !blockedSources.has(message.id) &&
      !blockedSources.has(message.sourceEventId),
  );
  const recent = messages.slice(-RECENT_LIMIT);
  // Keep the newest exchanges first in the budget; no silent truncation of their content.
  for (const message of [...recent].reverse()) {
    context.messages.unshift(structuredClone(message));
    if (
      !fits() ||
      (context.messages.length > 1 && JSON.stringify(context.messages).length > 7000)
    ) {
      context.messages.shift();
      if (!context.messages.length)
        throw new DomainError('INVALID_COMMAND', 'Latest message exceeds context budget');
      break;
    }
  }
  const append = <T>(items: T[], candidate: T, limit: number) => {
    items.push(structuredClone(candidate));
    if (!fits() || JSON.stringify(items).length > limit) items.pop();
  };
  const facts = state.facts.filter(
    (fact) =>
      !blockedSources.has(fact.id) &&
      !blockedSources.has(fact.sourceEventId) &&
      (fact.visibility.kind === 'world' ||
        (fact.visibility.kind === 'actors' && fact.visibility.actorIds.includes(actorId))),
  );
  // 开局核心事实（主角身份、世界情境）优先注入，确保角色时刻感知主角的身份与世界全貌
  const genesisFacts = facts.filter((f) => f.sourceEventId?.startsWith('genesis:'));
  for (const item of genesisFacts) append(context.facts, item, 4000);
  const remainingFacts = facts.filter((f) => !f.sourceEventId?.startsWith('genesis:'));
  const rank = <T>(items: T[], text: (item: T) => string) =>
    items
      .map((item, index) => ({ item, index, score: relevance(text(item), words) }))
      .sort((a, b) => b.score - a.score || b.index - a.index);
  for (const { item } of rank(remainingFacts, (fact) => fact.text))
    append(context.facts, item, 4000);
  const appointments = state.appointments.filter(
    (item) =>
      item.participantIds.includes(actorId) &&
      !blockedSources.has(item.id) &&
      !blockedSources.has(item.sourceEventId),
  );
  for (const { item } of rank(appointments, (item) => item.title))
    append(context.appointments, item, 1500);
  const historical = rank(messages.slice(0, -RECENT_LIMIT), (item) => item.text)
    .filter((item) => item.score > 0)
    .slice(0, HISTORICAL_LIMIT);
  for (const { item } of historical) append(context.messages, item, 11500);
  const order = new Map(messages.map((message, index) => [message.id, index]));
  context.messages.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  if (memoryRecords.length > 0) {
    const scoped = memoryRecords.filter((record) => {
      if (record.ownerId !== state.ownerId) return false;
      if (record.branchId && record.branchId !== state.id) return false;
      if (record.scopeType === 'branch') return record.scopeId === state.id;
      if (record.scopeType === 'character')
        return (
          record.scopeId === actorId && (!record.characterId || record.characterId === actorId)
        );
      return false; // Real profile and unknown scopes never become NPC context.
    });

    const budgeted = rankAndBudgetMemories({
      records: scoped,
      blockedSources,
      query: userText,
      charBudget: 3000,
    });

    for (const mem of budgeted) {
      append(context.retrievedMemories!, mem, 3000);
    }
  }

  return context;
}
