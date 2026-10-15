import { authoredSourceExcerpt } from './authored-source-excerpt.ts';

/** Private direction for this actor, never a canonical fact or a player instruction. */
export type ActorSituation = {
  worldVersion: number;
  storyAt: string;
  opening: {
    nodeKey: string;
    direction: string;
    sourceMessageId: string;
    sourceEventId: string;
    deliveredAt: string;
    sourceVersion: number;
  };
  /** A shared runtime outcome, not an inference from an NPC's wording. */
  eventOutcome: string | null;
};

type Modules = Partial<
  Record<'lifeContext' | 'traits' | 'drives' | 'behavior' | 'relationships', string>
>;
const moduleLimits = {
  lifeContext: 1400,
  traits: 1600,
  drives: 1400,
  behavior: 2000,
  relationships: 1400,
};

/** Budgeted source excerpts, not the complete manuscript; preserve every supplied dimension. */
export function selectActorPersona(
  modules: Modules | undefined,
  topic: string,
): Modules | undefined {
  if (!modules) return undefined;
  const selected: Modules = {};
  for (const key of Object.keys(moduleLimits) as (keyof Modules)[]) {
    const value = modules[key];
    if (!value?.trim()) continue;
    selected[key] = authoredSourceExcerpt(value, topic, moduleLimits[key]);
  }
  return Object.keys(selected).length ? selected : undefined;
}

/** Legacy JSON personas retain valid structure, identity and authored boundaries. */
function legacyPersonaExcerpt(source: string, topic: string, budget: number): string {
  if (source.length <= budget) return source;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return authoredSourceExcerpt(source, topic, budget);
  }
  if (!parsed || typeof parsed !== 'object') return authoredSourceExcerpt(source, topic, budget);
  let textFields = 0;
  const visit = (value: unknown, textBudget?: number, key = ''): unknown => {
    if (/^(?:id|name|identity|boundaries|boundary|姓名|身份|边界)$/iu.test(key)) return value;
    if (typeof value === 'string') {
      textFields++;
      return textBudget === undefined ? value : authoredSourceExcerpt(value, topic, textBudget);
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, textBudget));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          visit(child, textBudget, childKey),
        ]),
      );
    return value;
  };
  visit(parsed);
  const fields = Math.max(1, textFields);
  // Structure and protected boundaries cannot be shortened safely. If they alone
  // cannot fit, the caller keeps the explicit budget failure instead of corrupt JSON.
  for (let size = Math.max(1, Math.floor(budget / fields)); ; size = Math.floor(size / 2)) {
    const selected = JSON.stringify(visit(parsed, size));
    if (selected.length <= budget || size <= 1) return selected;
  }
}

/** Identity and current direction precede expendable old recall and social posts. */
export function reserveActorContext<
  T extends {
    authoredPosts?: unknown[];
    retrievedMemories?: unknown[];
    messages: unknown[];
    presentedStoryThreads?: unknown[];
    facts: unknown[];
    matters?: unknown[];
    choices?: unknown[];
    actor?: { persona?: string };
    actorSituation?: ActorSituation;
    authoredLifeModules?: Modules;
    eventGoals?: { want: string; stance: string }[];
  },
>(context: T, userText: string): T {
  const next = structuredClone(context);
  let compactionPass = 0;
  const fits = () =>
    JSON.stringify(next).length <= 18_000 &&
    JSON.stringify({ context: next, userText }).length <= 24_000;
  while (!fits()) {
    if (next.authoredPosts?.length) next.authoredPosts.pop();
    else if (next.retrievedMemories?.length) next.retrievedMemories.shift();
    else if (next.messages.length > 2) next.messages.shift();
    else if (next.presentedStoryThreads?.length) next.presentedStoryThreads.pop();
    else if (next.facts.length) next.facts.pop();
    else if (next.matters?.length) next.matters.pop();
    else if (next.choices?.length) next.choices.pop();
    else if (compactionPass < 5) {
      // A legal long persona plus two full recent messages must not fail merely
      // because optional recall has already been exhausted. These are excerpts,
      // never edits to stored source. Identity, receipts, goal boundaries/status,
      // current user input and both latest messages remain untouched.
      const divisor = 2 ** compactionPass++;
      if (next.actor?.persona)
        next.actor.persona = legacyPersonaExcerpt(context.actor!.persona!, userText, 800 / divisor);
      if (next.actorSituation)
        next.actorSituation.opening.direction = authoredSourceExcerpt(
          context.actorSituation!.opening.direction,
          userText,
          600 / divisor,
        );
      for (const key of Object.keys(moduleLimits) as (keyof Modules)[]) {
        const value = context.authoredLifeModules?.[key];
        if (value)
          next.authoredLifeModules![key] = authoredSourceExcerpt(value, userText, 400 / divisor);
      }
      for (const [index, goal] of (next.eventGoals ?? []).entries()) {
        goal.want = authoredSourceExcerpt(
          context.eventGoals![index]!.want,
          userText,
          300 / divisor,
        );
        goal.stance = authoredSourceExcerpt(
          context.eventGoals![index]!.stance,
          userText,
          200 / divisor,
        );
      }
    } else throw Error('ACTOR_REQUIRED_CONTEXT_EXCEEDS_BUDGET');
  }
  return next;
}
