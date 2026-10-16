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
