import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AuthoritativePosition } from '../domain/world-awareness.ts';
import { applyAgentScenePosition } from '../domain/agent-scene-arrival.ts';
import { SceneRuntimeSessionSchema } from '../../../contracts/scenes.ts';

/** Called only by the original position/arrival commit UoW, after its validated
 * event is saved. It never creates a scene, a position or a model task. */
export async function joinCurrentAgentSceneInTransaction(
  sql: SqlClient,
  ownerId: string,
  position: AuthoritativePosition,
): Promise<void> {
  const currentScene = (
    await sql.query(
      `SELECT s.document FROM parallel_life.scene_sessions s
       JOIN parallel_life.player_experiences x ON x.world_id=s.world_id AND x.owner_id=s.owner_id
         AND x.current_scene_id=s.id
       WHERE s.world_id=$1 AND s.owner_id=$2 AND s.document->>'status'='active'
         AND s.document->>'placeId'=$3
         AND EXISTS(SELECT 1 FROM parallel_life.scene_items i
           WHERE i.world_id=s.world_id AND i.owner_id=s.owner_id AND i.scene_id=s.id
             AND i.kind='entry' AND i.document->>'kind'='time_place')
       FOR UPDATE OF s`,
      [position.worldId, ownerId, position.placeId],
    )
  ).rows[0]?.document;
  // A not-yet-opened scene will independently read the committed position
  // when its existing environment task runs; do not alter that task's input roster.
  if (!currentScene) return;
  const playerPosition = (
    await sql.query(
      `SELECT document FROM parallel_life.world_authoritative_positions
       WHERE world_id=$1 AND owner_id=$2 AND subject_key='player'`,
      [position.worldId, ownerId],
    )
  ).rows[0]?.document as AuthoritativePosition | undefined;
  const scene = SceneRuntimeSessionSchema.parse(currentScene);
  const joined = applyAgentScenePosition(scene, {
    ownerId,
    position,
    playerPosition: playerPosition ?? null,
  });
  if (joined !== scene)
    await sql.query(
      'UPDATE parallel_life.scene_sessions SET document=$3 WHERE world_id=$1 AND owner_id=$2 AND id=$4',
      [position.worldId, ownerId, SceneRuntimeSessionSchema.parse(joined), scene.id],
    );
}
