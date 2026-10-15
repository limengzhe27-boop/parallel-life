import type { AuthoredAgentMaterial } from './authored-agent-material.ts';

export const ACTOR_EPISODE_INTENT_PREFIX = 'episode-intent:';

export function isActorEpisodeConsiderationInput(input: { origin: string; text: string }) {
  if (input.origin !== 'coordination') return false;
  try {
    return JSON.parse(input.text)?.type === 'npc_episode_consideration';
  } catch {
    return false;
  }
}

/** An author's explicit instruction to this actor, never evidence that it happened. */
export type ActorEpisodeDirective =
  | { kind: 'message_suggestion'; text: string }
  | { kind: 'task_suggestion'; text: string }
  | {
      kind: 'invitation_suggestion';
      title: string;
      earliestAt: string;
      placeId: string;
      placeName: string;
    };

/** Participation alone grants no knowledge of a global script or another actor's part. */
export function projectActorEpisodeDirective(
  material: AuthoredAgentMaterial,
  actorId: string,
  availablePlaces: readonly { id: string; name: string }[],
): ActorEpisodeDirective | null {
  const intent = material.node.intent;
  const actorKey =
    intent.kind === 'offer_message'
      ? intent.actorKey
      : intent.kind === 'offer_invitation' && intent.actorKeys.length === 1
        ? intent.actorKeys[0]
        : undefined;
  if (!actorKey || !material.node.actorKeys.includes(actorKey)) return null;
  const actors = material.participantRefs.filter((ref) => ref.actorKey === actorKey);
  if (actors.length !== 1 || actors[0]!.status !== 'resolved' || actors[0]!.actorId !== actorId)
    return null;
  if (intent.kind === 'offer_message') return { kind: 'message_suggestion', text: intent.text };
  if (intent.kind !== 'offer_invitation') return null;
  const refs = material.placeRefs.filter((ref) => ref.placeKey === intent.placeKey);
  if (refs.length !== 1 || refs[0]!.status !== 'resolved' || !refs[0]!.availableInWorld)
    return null;
  const places = availablePlaces.filter((place) => place.id === refs[0]!.placeId);
  if (places.length !== 1) return null;
  return {
    kind: 'invitation_suggestion',
    title: intent.title,
    earliestAt: intent.earliestAt,
    placeId: places[0]!.id,
    placeName: places[0]!.name,
  };
}
