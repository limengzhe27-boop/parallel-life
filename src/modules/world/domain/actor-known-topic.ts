import type { DirectorOpportunity } from './director-runtime.ts';

/** A reference to the NPC's own authorized strategy, not a new fact or an order. */
export type ActorKnownTopic = {
  id: string;
  actorId: string;
  kind: 'goal' | 'plan' | 'responsibility';
  itemId: string;
  summary: string;
  status: string;
  contentHash: string;
  /** Server-only denial lineage, never an invitation to read the underlying records. */
  proofSourceIds: string[];
};
export type ActorTopicSelection = {
  actorId: string;
  refs: { id: string; contentHash: string }[];
};

export function validActorTopicSelection(
  opportunity: DirectorOpportunity,
  catalog: readonly ActorKnownTopic[],
): boolean {
  if (opportunity.actorTopics === undefined) return true;
  const selected = opportunity.actorTopics;
  return (
    selected.length === opportunity.participantActorIds.length &&
    new Set(selected.map((s) => s.actorId)).size === selected.length &&
    selected.every(
      (s) =>
        opportunity.participantActorIds.includes(s.actorId) &&
        s.refs.length > 0 &&
        s.refs.length <= 4 &&
        new Set(s.refs.map((r) => r.id)).size === s.refs.length &&
        s.refs.every(
          (r) =>
            catalog.filter(
              (t) => t.actorId === s.actorId && t.id === r.id && t.contentHash === r.contentHash,
            ).length === 1,
        ),
    )
  );
}

/** Each staging task is addressed to exactly one actual participant. It grants no factual knowledge. */
export function validActorStagingIntents(opportunity: DirectorOpportunity): boolean {
  if (opportunity.stagingIntents === undefined) return true; // Saved pre-staging decisions.
  const intents = opportunity.stagingIntents;
  return (
    intents.length === opportunity.participantActorIds.length &&
    new Set(intents.map((intent) => intent.actorId)).size === intents.length &&
    intents.every(
      (intent) =>
        opportunity.participantActorIds.includes(intent.actorId) &&
        intent.kind === 'future_task' &&
        typeof intent.task === 'string' &&
        intent.task.trim().length > 0 &&
        intent.task.length <= 600,
    )
  );
}
