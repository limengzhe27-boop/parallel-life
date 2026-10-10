import type { WorldState } from './types.ts';

/** Inputs must be verified owner/world projections, never assertions supplied by a model. */
export type SelectedPlayerPerson = {
  actorId: string;
  personId: string;
  name: string;
  relationship: string;
  photo?: { assetId: string; revision: number };
};
export type PlayerActor = {
  id: string;
  name: string;
  relationship: string;
  sourcePersonId?: string;
  photo?: { assetId: string; revision: number };
};
/**
 * A saved message/observable dialogue introduces its speaker, not their backstage biography.
 * Appointment participants are known only through an actual sourced invitation.
 * Legacy or new internal personas/relationships are never a public fallback.
 */
export function projectPlayerActors(
  state: WorldState,
  selected: SelectedPlayerPerson[],
  observableContactActorIds: readonly string[] = [],
): PlayerActor[] {
  const contacts = new Set(observableContactActorIds);
  for (const message of state.messages) {
    if (message.sourceEventId) contacts.add(message.actorId);
  }
  for (const appointment of state.appointments) {
    if (appointment.sourceEventId && appointment.status)
      for (const actorId of appointment.participantIds) contacts.add(actorId);
  }
  return state.actors.flatMap((actor) => {
    const person = selected.find(
      (person) => person.actorId === actor.id && person.personId === actor.sourcePersonId,
    );
    if (!person && !contacts.has(actor.id)) return [];
    return [
      {
        id: actor.id,
        name: person?.name ?? actor.name,
        relationship:
          person?.relationship ??
          state.officialLife?.contacts.find((c) => c.actorId === actor.id)?.relationship ??
          '',
        ...(person
          ? { sourcePersonId: person.personId, ...(person.photo ? { photo: person.photo } : {}) }
          : {}),
      },
    ];
  });
}
