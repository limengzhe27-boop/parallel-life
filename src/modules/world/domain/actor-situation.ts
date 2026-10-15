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

/** Keep intact authored units. Never rewrite the manuscript or silently omit a whole persona. */
export function selectActorPersona(
  modules: Modules | undefined,
  topic: string,
): Modules | undefined {
  if (!modules) return undefined;
  const selected: Modules = {};
  const words = [...new Set(topic.match(/[\p{Script=Han}]{2}|[a-zA-Z]{3,}/gu) ?? [])];
  for (const key of Object.keys(moduleLimits) as (keyof Modules)[]) {
    const value: string | undefined = modules[key];
    if (!value?.trim()) continue;
    const limit = moduleLimits[key];
    if (value.length <= limit) {
      selected[key] = value;
      continue;
    }
    const units: { text: string; index: number }[] = value
      .split(/\n\s*\n|\n/u)
      .flatMap((unit) => (unit.length > limit ? unit.split(/(?<=[。！？；.!?;])/u) : [unit]))
      .map((text, index) => ({ text: text.trim(), index }))
      .filter((unit) => unit.text.length > 0);
    const ranked: { text: string; index: number; score: number }[] = units
      .map((unit) => ({ ...unit, score: words.filter((w) => unit.text.includes(w)).length }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen: { text: string; index: number; score: number }[] = [];
    let size = 0;
    // Anchor the opening identity/trait unit even when later paragraphs match the event.
    const anchor = ranked.find((unit) => unit.index === 0);
    if (anchor && anchor.text.length <= limit) {
      chosen.push(anchor);
      size = anchor.text.length;
    }
    for (const unit of ranked) {
      if (chosen.some((x) => x.index === unit.index) || size + unit.text.length + 1 > limit)
        continue;
      chosen.push(unit);
      size += unit.text.length + 1;
    }
    if (!chosen.length) throw Error('ACTOR_PERSONA_UNIT_EXCEEDS_BUDGET');
    selected[key] = chosen
      .sort((a, b) => a.index - b.index)
      .map((x) => x.text)
      .join('\n');
  }
  return Object.keys(selected).length ? selected : undefined;
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
  },
>(context: T, userText: string): T {
  const next = structuredClone(context);
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
    else throw Error('ACTOR_REQUIRED_CONTEXT_EXCEEDS_BUDGET');
  }
  return next;
}
