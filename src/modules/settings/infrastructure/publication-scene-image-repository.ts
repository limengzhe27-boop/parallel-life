import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { publicationSceneImageUrl } from '../domain/publication-scene-images.ts';

type SceneRow = { place_key: string; asset_id: string };

/**
 * Call inside the world's existing owner-scoped transaction. SQL returns only
 * ready pictures present in this owner's pinned publication and actual map.
 * The caller passes the places in its response as a second, defensive fence.
 */
export async function readPublicationSceneImages(
  sql: SqlClient,
  worldId: string,
  visiblePlaceIds: readonly string[],
): Promise<Map<string, string>> {
  if (visiblePlaceIds.length === 0) return new Map();
  const visible = new Set(visiblePlaceIds);
  const rows = (
    await sql.query(
      'SELECT place_key,asset_id FROM parallel_life.publication_scene_images_for_world($1)',
      [worldId],
    )
  ).rows as SceneRow[];
  return new Map(
    rows
      .filter((row) => visible.has(row.place_key))
      .map((row) => [row.place_key, publicationSceneImageUrl(worldId, row.asset_id)]),
  );
}
