import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import type { AppointmentWaitScene } from '../domain/appointment-wait.ts';
import { SceneRuntimeSessionSchema } from '../../../contracts/scenes.ts';
import { scenePresent } from '../domain/scene-runtime.ts';

/** Read only under the caller's world lock. No input/model assertion can certify a scene. */
export async function readSceneWaitContext(
  sql: SqlClient,
  ownerId: string,
  world: WorldState,
  sceneId: string,
): Promise<AppointmentWaitScene | null> {
  const row = (
    await sql.query(
      `SELECT s.document,e.version,e.payload FROM parallel_life.scene_sessions s
 JOIN parallel_life.player_experiences x ON x.world_id=s.world_id AND x.owner_id=s.owner_id AND x.current_scene_id=s.id AND x.document->>'currentSceneId'=s.id AND x.document->>'worldId'=s.world_id AND x.document->>'ownerId'=s.owner_id
 JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 WHERE s.world_id=$1 AND s.owner_id=$2 AND s.id=$3`,
      [world.id, ownerId, sceneId],
    )
  ).rows[0];
  if (!row) return null;
  const parsed = SceneRuntimeSessionSchema.safeParse(row.document);
  if (!parsed.success) return null;
  const scene = parsed.data;
  if (
    scene.worldId !== world.id ||
    scene.ownerId !== ownerId ||
    scene.id !== sceneId ||
    scene.sourceVersion !== row.version ||
    scene.sourceEventId !== row.payload.id ||
    row.version > world.version ||
    row.payload.type !== 'scene.entered' ||
    row.payload.data?.sceneId !== sceneId
  )
    return null;
  const position = (
    await sql.query(
      "SELECT document FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND owner_id=$2 AND subject_key='player'",
      [world.id, ownerId],
    )
  ).rows[0]?.document;
  const playerAt = position
    ? position.worldId === world.id &&
      position.subject?.kind === 'player' &&
      position.status === 'at' &&
      position.placeId === scene.placeId &&
      position.worldVersion <= world.version
    : world.space?.currentPlaceId === scene.placeId;
  const pending = !!(
    await sql.query(
      `SELECT 1 FROM parallel_life.scene_items WHERE world_id=$1 AND owner_id=$2 AND scene_id=$3 AND kind='action' AND document->>'status'<>'resolved'
 UNION ALL SELECT 1 FROM parallel_life.actor_agent_states a CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.document->'questions','[]'::jsonb)) q WHERE a.world_id=$1 AND a.owner_id=$2 AND q->>'channel'='scene' AND q->>'threadId'=$3 AND q->>'status'='open' LIMIT 1`,
      [world.id, ownerId, sceneId],
    )
  ).rowCount;
  const ready = !!(
    await sql.query(
      `SELECT 1 FROM parallel_life.scene_items i JOIN parallel_life.world_events e ON e.world_id=i.world_id AND e.owner_id=i.owner_id AND e.id=i.source_event_id JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE i.world_id=$1 AND i.owner_id=$2 AND i.scene_id=$3 AND i.kind='entry' AND i.document->>'kind'='time_place' AND e.version<=$4 LIMIT 1`,
      [world.id, ownerId, sceneId, world.version],
    )
  ).rowCount;
  return {
    id: scene.id,
    ownerId: scene.ownerId,
    worldId: scene.worldId,
    status: scene.status,
    placeId: scene.placeId ?? null,
    appointmentId: scene.appointmentId ?? null,
    playerPresent: playerAt && scenePresent(scene, world.version).some((p) => p.kind === 'player'),
    pending: pending || !ready,
  };
}
