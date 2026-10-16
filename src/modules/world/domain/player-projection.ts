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
  summary?: string;
  publicProfile?: {
    identity?: string;
    traits?: string[];
    appearance?: string;
  };
  sourcePersonId?: string;
  photo?: { assetId: string; revision: number };
};
export type PlayerContactState = {
  actors: readonly Pick<WorldState['actors'][number], 'id' | 'name' | 'sourcePersonId'>[];
  messages: readonly Pick<WorldState['messages'][number], 'actorId' | 'sourceEventId'>[];
  appointments: readonly Pick<
    WorldState['appointments'][number],
    'participantIds' | 'sourceEventId' | 'status'
  >[];
};
/** Shared contact visibility, using verified projection metadata only; no persona or transcript read. */
export function projectPlayerContactActorIds(
  state: PlayerContactState,
  selected: readonly Pick<SelectedPlayerPerson, 'actorId' | 'personId'>[],
  observableContactActorIds: readonly string[] = [],
  publishedContacts: readonly { actorId: string; name: string }[] = [],
): string[] {
  const contacts = new Set(observableContactActorIds);
  for (const message of state.messages) if (message.sourceEventId) contacts.add(message.actorId);
  for (const appointment of state.appointments)
    if (appointment.sourceEventId && appointment.status)
      for (const actorId of appointment.participantIds) contacts.add(actorId);
  return state.actors
    .filter(
      (actor) =>
        contacts.has(actor.id) ||
        selected.some(
          (person) => person.actorId === actor.id && person.personId === actor.sourcePersonId,
        ) ||
        publishedContacts.some(
          (contact) => contact.actorId === actor.id && contact.name === actor.name,
        ),
    )
    .map((actor) => actor.id);
}
/**
 * A saved message/observable dialogue introduces its speaker, not their backstage biography.
 * Appointment participants are known only through an actual sourced invitation.
 * Legacy or new internal personas/relationships are never a public fallback.
 */
export function projectPlayerActors(
  state: WorldState,
  selected: SelectedPlayerPerson[],
  observableContactActorIds: readonly string[] = [],
  publishedContacts: readonly {
    actorId: string;
    name: string;
    relationship: string;
    introduction?: string;
    identity?: string;
    traits: string[];
    appearance?: string;
  }[] = [],
): PlayerActor[] {
  const contacts = new Set(
    projectPlayerContactActorIds(state, selected, observableContactActorIds, publishedContacts),
  );
  return state.actors.flatMap((actor) => {
    const person = selected.find(
      (person) => person.actorId === actor.id && person.personId === actor.sourcePersonId,
    );
    const authored = publishedContacts.find((c) => c.actorId === actor.id && c.name === actor.name);
    if (!contacts.has(actor.id)) return [];
    return [
      {
        id: actor.id,
        name: person?.name ?? actor.name,
        relationship:
          person?.relationship ??
          authored?.relationship ??
          state.officialLife?.contacts.find((c) => c.actorId === actor.id)?.relationship ??
          '',
        ...(authored
          ? {
              summary: [
                authored.introduction,
                authored.identity,
                ...authored.traits,
                authored.appearance,
              ]
                .filter(Boolean)
                .join(' · '),
              ...(authored.identity || (authored.traits && authored.traits.length > 0) || authored.appearance
                ? {
                    publicProfile: {
                      ...(authored.identity ? { identity: authored.identity } : {}),
                      ...(authored.traits && authored.traits.length > 0 ? { traits: [...authored.traits] } : {}),
                      ...(authored.appearance ? { appearance: authored.appearance } : {}),
                    },
                  }
                : {}),
            }
          : {}),
        ...(person
          ? { sourcePersonId: person.personId, ...(person.photo ? { photo: person.photo } : {}) }
          : {}),
      },
    ];
  });
}
