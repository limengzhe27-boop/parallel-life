import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { AlbumPhotoSchema } from '../../../contracts/album.ts';
export function albumPhoto(row: Record<string, unknown>) {
  return AlbumPhotoSchema.parse({
    id: row.asset_id,
    worldId: row.world_id,
    title: row.title,
    date: new Date(String(row.story_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    kind: row.origin,
    width: row.width,
    height: row.height,
    revision: row.revision,
  });
}
export async function albumPhotos(sql: SqlClient, worldId: string) {
  const rows = await sql.query(
    "SELECT p.*,a.origin,a.width,a.height,a.revision FROM parallel_life.world_album p JOIN parallel_life.assets a ON a.id=p.asset_id AND a.owner_id=p.owner_id AND a.world_id=p.world_id WHERE p.world_id=$1 AND a.status='ready' ORDER BY p.created_at DESC,p.asset_id LIMIT 100",
    [worldId],
  );
  return rows.rows.map(albumPhoto);
}
