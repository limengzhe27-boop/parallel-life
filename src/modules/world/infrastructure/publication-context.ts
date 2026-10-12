import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import { readPublicationInvitationLinks } from '../../settings/infrastructure/publication-story-repository.ts';

/** Enrich only real, same-world offered invitations. A place link is never proof of presence. */
export async function publicationPlaceLinks(
  sql: SqlClient,
  state: WorldState,
): Promise<WorldState> {
  if (!state.space) return state;
  const links = await readPublicationInvitationLinks(sql, state.ownerId, state.id);
  if (!links.length) return state;
  const sources = (
    await sql.query(
      `SELECT p.document FROM parallel_life.world_appointments p
   JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.id=p.document->>'sourceEventId'
   WHERE p.world_id=$1 AND e.version<=$2`,
      [state.id, state.version],
    )
  ).rows.map((r) => r.document);
  const approved = links.filter((l) =>
    sources.some((a) => a.id === l.invitationId && a.sourceEventId === l.sourceEventId),
  );
  return {
    ...state,
    space: {
      ...state.space,
      places: state.space.places.map((p) => ({
        ...p,
        appointmentIds: [
          ...new Set([
            ...p.appointmentIds,
            ...approved.filter((l) => l.placeId === p.id).map((l) => l.invitationId),
          ]),
        ],
      })),
    },
  };
}
