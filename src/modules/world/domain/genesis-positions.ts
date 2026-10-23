import type { OfficialOpeningDraft } from './official-genesis.ts';
import type { WorldState } from './types.ts';

/** A version-0 position is authored world state, never an observed model claim. */
export type GenesisPosition = {
  subjectKey: string;
  subject: { kind: 'player' } | { kind: 'actor'; actorId: string };
  status: 'at' | 'unknown';
  placeId: string | null;
};

/**
 * Official openings currently list actors and places in the same order. The
 * author may pin an actor to a place; everyone else starts with an unknown
 * location instead of being silently placed somewhere convenient.
 */
export function officialGenesisPositions(
  state: WorldState,
  opening: OfficialOpeningDraft,
): GenesisPosition[] {
  if (state.actors.length !== opening.actors.length) throw Error('INVALID_OFFICIAL_POSITIONS');
  const placeIds = new Set(state.space?.places.map((place) => place.id) ?? []);
  const playerPlaceId = state.space?.currentPlaceId ?? null;
  const rows: GenesisPosition[] = [
    {
      subjectKey: 'player',
      subject: { kind: 'player' },
      status: playerPlaceId ? 'at' : 'unknown',
      placeId: playerPlaceId,
    },
  ];
  state.actors.forEach((actor, index) => {
    const key = opening.actors[index]?.initialPlaceKey;
    if (key !== undefined && !placeIds.has(key)) throw Error('INVALID_OFFICIAL_POSITION_PLACE');
    rows.push({
      subjectKey: `actor:${actor.id}`,
      subject: { kind: 'actor', actorId: actor.id },
      status: key ? 'at' : 'unknown',
      placeId: key ?? null,
    });
  });
  return rows;
}
