import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { SceneEntry, SceneSession } from '../domain/experience-rules.ts';

/** A ready media result is a visual projection of its actual source, never new world activity. */
export async function readSceneMediaEntries(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  scene: SceneSession | null,
  worldVersion: number,
): Promise<SceneEntry[]> {
  if (!scene || scene.ownerId !== ownerId || scene.worldId !== worldId) return [];
  const intervalsAt = (version: number) =>
    scene.presence
      .filter(
        (p) =>
          p.joinedVersion <= version && (p.leftVersion === undefined || version < p.leftVersion),
      )
      .map(
        (p) =>
          `${p.participant.kind === 'player' ? 'player' : p.participant.actorId}:${p.joinedVersion}`,
      )
      .sort();
  const current = intervalsAt(worldVersion);
  if (!current.some((k) => k.startsWith('player:'))) return [];
  const rows = (
    await sql.query(
      `SELECT m.id,m.document,a.id AS asset_id,e.id AS event_id,e.version
     FROM parallel_life.world_media_requests m
     JOIN parallel_life.assets a ON a.id::text=m.document->>'assetId' AND a.owner_id=m.owner_id AND a.world_id=m.world_id AND a.status='ready' AND a.origin='generated' AND a.mime_type LIKE 'image/%'
     JOIN parallel_life.world_events e ON e.id=m.document->>'sourceEventId' AND e.world_id=m.world_id AND e.owner_id=m.owner_id
     JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
     JOIN parallel_life.scene_sessions ss ON ss.id=$3 AND ss.world_id=m.world_id AND ss.owner_id=m.owner_id AND ss.document->>'sourceEventId'=ss.source_event_id
     JOIN parallel_life.world_events entered ON entered.id=ss.source_event_id AND entered.world_id=ss.world_id AND entered.owner_id=ss.owner_id AND entered.payload->>'type'='scene.entered' AND entered.payload->'data'->>'sceneId'=ss.id AND entered.version=(ss.document->>'sourceVersion')::bigint
     JOIN parallel_life.commands ec ON ec.id=entered.command_id AND ec.world_id=entered.world_id AND ec.owner_id=entered.owner_id AND ec.status='succeeded' AND ec.result_event_id=entered.id
     LEFT JOIN parallel_life.agent_input_receipts r ON r.id=e.payload->'data'->'agentRuntime'->>'inputReceiptId' AND r.world_id=e.world_id AND r.owner_id=e.owner_id
     WHERE m.world_id=$1 AND m.owner_id=$2 AND m.document->>'status'='ready' AND m.document->>'purpose'='scene' AND e.version<=$4
       AND ((r.document->>'channel'='scene' AND r.document->>'threadId'=$3) OR (e.payload->>'type'='scene.opened' AND e.payload->'data'->>'sceneId'=$3 AND e.payload->'data'->'environment'->'renderRequest'->>'id'=m.id))
       AND m.document->'deliveryDecision'->>'approved'='true'
       AND ((e.payload->>'type'='scene.opened' AND e.payload->'data'->'environment'->'renderRequest'->>'id'=m.id AND e.payload->'data'->'environment'->'renderRequest'->>'purpose'='scene') OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e.payload->'data'->'effects','[]'::jsonb)) effect WHERE effect->>'type'='media.requested' AND effect->>'id'=m.id AND effect->>'purpose'='scene'))
     ORDER BY e.version DESC,m.id LIMIT 20`,
      [worldId, ownerId, scene.id, worldVersion],
    )
  ).rows;
  return rows
    .filter((row) => {
      const before = intervalsAt(Number(row.version));
      return before.length === current.length && before.every((k, i) => k === current[i]);
    })
    .reverse()
    .map((row) => ({
      id: String(row.id),
      ownerId,
      worldId,
      sceneId: scene.id,
      sourceEventId: String(row.event_id),
      sourceVersion: Number(row.version),
      observableTo: [{ kind: 'player' }],
      kind: 'media_reference',
      media: {
        ownerId,
        worldId,
        sourceEventId: String(row.event_id),
        sourceVersion: Number(row.version),
        assetId: String(row.asset_id),
        purpose: 'scene_illustration',
      },
    }));
}
