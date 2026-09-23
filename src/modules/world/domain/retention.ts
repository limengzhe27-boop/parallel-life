import type { Fact } from './types.ts';

/**
 * How many facts the in-memory world state keeps.
 *
 * `worlds.state` has a hard 256KB limit. Facts used to accumulate there forever,
 * so a long conversation eventually made every commit fail and the world
 * unusable. Facts now live in the `world_facts` projection (nothing is
 * discarded); the state keeps the genesis facts plus the newest facts that fit
 * a character budget. The budget is expressed in characters rather than a count
 * because a single fact may be up to 4000 characters.
 */
export const FACTS_BUDGET_CHARS = 96_000;
/** The first facts come from the world build (identity/setting) and anchor the life. */
export const GENESIS_FACTS = 2;

export function retainFacts(facts: Fact[], budget = FACTS_BUDGET_CHARS): Fact[] {
  if (facts.length <= GENESIS_FACTS) return facts;
  const genesis = facts.slice(0, GENESIS_FACTS);
  let used = JSON.stringify(genesis).length;
  const kept: Fact[] = [];
  for (let index = facts.length - 1; index >= GENESIS_FACTS; index -= 1) {
    const fact = facts[index]!;
    const size = JSON.stringify(fact).length;
    if (used + size > budget) break;
    kept.unshift(fact);
    used += size;
  }
  return [...genesis, ...kept];
}
