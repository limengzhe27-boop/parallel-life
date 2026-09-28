import type { WorldState } from './types.ts';

/** The director can suggest a transfer only across an explicit directed link. */
export function shareableRecipients(state: WorldState, fromActorId: string) {
  const allowed = new Map(
    (state.actorTies ?? [])
      .filter((tie) => tie.fromActorId === fromActorId && tie.mayShare)
      .map((tie) => [tie.toActorId, tie.relationship]),
  );
  return state.actors.flatMap((actor) => {
    const relationship = allowed.get(actor.id);
    return relationship && actor.id !== fromActorId ? [{ actor, relationship }] : [];
  });
}

export function canShareWith(state: WorldState, fromActorId: string, toActorId: string): boolean {
  return shareableRecipients(state, fromActorId).some(({ actor }) => actor.id === toActorId);
}
