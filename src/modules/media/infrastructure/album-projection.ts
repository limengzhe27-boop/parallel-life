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
    ...(row.sourcePersonId ? { sourcePersonId: row.sourcePersonId } : {}),
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
  const imported = await sql.query(
    "SELECT b.asset_id,b.world_id,b.person_id,b.person_snapshot,a.created_at AS story_at,b.created_at,a.origin,a.width,a.height,a.revision FROM parallel_life.world_person_bindings b JOIN parallel_life.assets a ON a.id=b.asset_id AND a.owner_id=b.owner_id AND a.revision=b.asset_revision WHERE b.world_id=$1 AND a.status='ready' ORDER BY b.created_at DESC,b.asset_id LIMIT 100",
    [worldId],
  );
  const references = imported.rows.map((row) =>
    albumPhoto({
      ...row,
      title: '用户带入的照片 · ' + String(row.person_snapshot.name).slice(0, 60),
      sourcePersonId: row.person_id,
    }),
  );
  return [
    ...rows.rows.map(albumPhoto),
    ...references.filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i),
  ];
}

/** Only original immutable person bindings; a current avatar is not a history photo. */
export async function historyPersonPhotos(sql: SqlClient, worldId: string) {
  const rows = await sql.query(
    "SELECT b.actor_id,b.asset_id FROM parallel_life.world_person_bindings b JOIN parallel_life.assets a ON a.id=b.asset_id AND a.owner_id=b.owner_id AND a.revision=b.asset_revision WHERE b.world_id=$1 AND a.status='ready' AND a.origin='upload' AND a.world_id IS NULL ORDER BY b.actor_id,b.asset_id",
    [worldId],
  );
  return new Map<string, string[]>(rows.rows.map((r) => [r.actor_id, [r.asset_id]]));
}
