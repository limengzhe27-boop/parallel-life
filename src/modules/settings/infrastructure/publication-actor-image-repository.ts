import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { publicationSceneImageUrl } from '../domain/publication-scene-images.ts';

/** Read inside the existing owner-scoped scene transaction. Never reveal a
 * hidden person's image, nor substitute the work's newer draft for its binding. */
export async function readPublicationActorImages(
  sql: SqlClient,
  worldId: string,
  visibleActorIds: readonly string[],
): Promise<Map<string, string>> {
  if (!visibleActorIds.length) return new Map();
  const visible = new Set(visibleActorIds);
  const rows = (
    await sql.query(
      'SELECT actor_id,asset_id FROM parallel_life.publication_actor_stage_images_for_world($1)',
      [worldId],
    )
  ).rows as { actor_id: string; asset_id: string }[];
  return new Map(
    rows
      .filter((row) => visible.has(row.actor_id))
      .map((row) => [row.actor_id, publicationSceneImageUrl(worldId, row.asset_id)]),
  );
}
