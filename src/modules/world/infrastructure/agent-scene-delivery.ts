import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { SceneRuntimeSessionSchema } from '../../../contracts/scenes.ts';
import { scenePresent } from '../domain/scene-runtime.ts';

/** Only a current shared scene plus authoritative positions permits an in-person reply. */
export async function readActorSceneDelivery(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
) {
  const row = (
    await sql.query(
      `SELECT s.document,w.version FROM parallel_life.player_experiences x
     JOIN parallel_life.scene_sessions s ON s.world_id=x.world_id AND s.owner_id=x.owner_id AND s.id=x.current_scene_id
     JOIN parallel_life.worlds w ON w.id=s.world_id AND w.owner_id=s.owner_id
     WHERE x.world_id=$1 AND x.owner_id=$2 AND s.document->>'status'='active'
       AND (SELECT count(*) FROM parallel_life.world_authoritative_positions p
         WHERE p.world_id=x.world_id AND p.owner_id=x.owner_id
           AND p.subject_key=ANY($3::text[]) AND p.document->>'status'='at'
           AND p.document->>'placeId'=s.document->>'placeId')=2`,
      [worldId, ownerId, ['player', 'actor:' + actorId]],
    )
  ).rows[0];
  if (!row) return null;
  const scene = SceneRuntimeSessionSchema.parse(row.document);
  const present = scenePresent(scene, Number(row.version));
  if (
    !present.some((p) => p.kind === 'player') ||
    !present.some((p) => p.kind === 'actor' && p.actorId === actorId)
  )
    return null;
  const context: NonNullable<AgentSnapshot['sceneReplyContext']> = {
    sceneId: scene.id,
    placeName: scene.title,
    audienceActorIds: present.flatMap((p) => (p.kind === 'actor' ? [p.actorId] : [])),
  };
  return { context, scene, present };
}
