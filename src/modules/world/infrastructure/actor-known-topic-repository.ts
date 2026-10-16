import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import type { ActorKnownTopic } from '../domain/actor-known-topic.ts';
import { authorizedAgentState } from '../domain/agent-kernel.ts';
import { authoredMaterialCanonicalJson } from '../domain/authored-agent-material.ts';
import { actorStateContextPayload } from '../application/agent-state-context.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';

const hash = (value: unknown) =>
  createHash('sha256').update(authoredMaterialCanonicalJson(value)).digest('hex');

/** Uses the same source authorization and model state projection as the NPC; no global prose. */
export async function readActorKnownTopicsInTransaction(
  sql: SqlClient,
  owner: string,
  state: ActorAgentState,
  worldVersion: number,
  storyAt: string,
): Promise<ActorKnownTopic[]> {
  // Do not recursively turn an earlier director intent into fresh authority for another one.
  const sources = await readActorStrategyBasis(sql, owner, state, worldVersion, storyAt, {
    omitEpisodeIntents: true,
  });
  const view = actorStateContextPayload(
    authorizedAgentState(state, new Set(sources.map((s) => s.id))).viewState,
  );
  const topics: ActorKnownTopic[] = [];
  const append = (
    kind: ActorKnownTopic['kind'],
    items: { id: string; summary: string; status: string; sourceIds: string[] }[],
    statuses: string[],
  ) => {
    for (const item of items) {
      if (!statuses.includes(item.status) || !item.summary.trim() || item.summary.length > 2000)
        continue;
      const identity = { worldId: state.worldId, actorId: state.actorId, kind, itemId: item.id };
      const proofs = sources
        .filter((s) => item.sourceIds.includes(s.id))
        .map(({ at: _at, usage: _usage, ...proof }) => proof)
        .sort((a, b) => a.id.localeCompare(b.id));
      topics.push({
        id: 'known-topic:' + hash(identity),
        actorId: state.actorId,
        kind,
        itemId: item.id,
        summary: item.summary,
        status: item.status,
        proofSourceIds: [...new Set(sources.flatMap((s) => [s.id, s.recordId]))].sort(),
        // Include the authorized dependency graph; exclude ambient clock/world revision.
        contentHash: hash({
          identity,
          item,
          proofs,
          dependencies: {
            goals: view.goals,
            plans: view.plans,
            actions: view.actions,
            responsibilities: view.responsibilities,
            decisions: view.decisions,
          },
        }),
      });
    }
  };
  append('goal', view.goals, ['active', 'deferred']);
  append('plan', view.plans, ['active', 'waiting', 'blocked']);
  append('responsibility', view.responsibilities, ['open', 'waiting', 'deferred']);
  return topics.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 24);
}
