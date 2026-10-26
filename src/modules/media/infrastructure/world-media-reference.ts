import { PUBLICATION_ART } from '../../../contracts/publication-assets.ts';
import type { SqlExecutor } from './character-reference-resolver.ts';

/** Reuse the first completed self-portrait only when no stronger binding exists. */
export async function ownGeneratedPortraitReference(
  sql: SqlExecutor,
  worldId: string,
  ownerId: string,
  actorId: string,
) {
  const row = (
    await sql.query(
      `SELECT a.id,a.revision FROM parallel_life.world_media_requests m
     JOIN parallel_life.assets a ON a.id::text=m.document->>'assetId' AND a.owner_id=m.owner_id AND a.world_id=m.world_id
     JOIN parallel_life.world_events e ON e.id=m.document->>'sourceEventId' AND e.world_id=m.world_id AND e.owner_id=m.owner_id
     WHERE m.world_id=$1 AND m.owner_id=$2 AND m.document->>'targetActorId'=$3
       AND EXISTS(SELECT 1 FROM parallel_life.worlds w WHERE w.id=m.world_id AND w.owner_id=m.owner_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.state->'actors') actor WHERE actor->>'id'=$3))
       AND m.document->>'purpose'='portrait' AND m.document->>'status'='ready'
       AND a.status='ready' AND a.origin='generated' AND a.mime_type LIKE 'image/%'
       AND e.payload->'data'->>'actorId'=$3 AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(e.payload->'data'->'effects','[]'::jsonb)) effect
         WHERE effect->>'type'='media.requested' AND effect->>'id'=m.id
           AND effect->>'targetActorId'=$3 AND effect->>'purpose'='portrait')
     ORDER BY a.created_at,a.id LIMIT 1`,
      [worldId, ownerId, actorId],
    )
  ).rows[0];
  return row ? { assetId: String(row.id), revision: Number(row.revision) } : null;
}

/** Only the exact actor's world-visible immutable publication avatar. */
export async function publicationActorReference(
  sql: SqlExecutor,
  worldId: string,
  ownerId: string,
  actorId: string,
) {
  const row = (
    await sql.query(
      `SELECT parallel_life.publication_story_source(w.id) AS source, parallel_life.publication_world_visuals(w.id) AS visual
     FROM parallel_life.worlds w
     WHERE w.id=$1 AND w.owner_id=$2 AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(w.state->'actors') a WHERE a->>'id'=$3)`,
      [worldId, ownerId, actorId],
    )
  ).rows[0];
  const contact =
    row?.source?.initialActorIds?.includes(actorId) &&
    row.source.contacts?.find((c: { actorId: string }) => c.actorId === actorId);
  if (!contact) return null;
  const link = row.visual?.actors?.find(
    (a: { actorKey: string }) => a.actorKey === contact.actorKey,
  );
  const media = row.visual?.media?.find((m: { key: string }) => m.key === link?.mediaKey);
  if (
    !media ||
    media.use !== 'avatar' ||
    media.visibility?.kind !== 'world' ||
    media.asset?.namespace !== 'publication'
  )
    return null;
  const art = PUBLICATION_ART.find(
    (a) =>
      a.key === media.asset.key && a.revision === media.asset.revision && a.uses.includes('avatar'),
  );
  if (art && (!media.url || media.url === art.url))
    return { assetId: `publication-art:${art.key}:${art.revision}`, revision: art.revision, art };
  // Work uploads are read through the original owner/world authorization function.
  if (/^[0-9a-f-]{36}$/.test(media.asset.key) && Number.isSafeInteger(media.asset.revision)) {
    const available = (
      await sql.query('SELECT * FROM parallel_life.publication_media_for_world($1,$2)', [
        worldId,
        media.asset.key,
      ])
    ).rows[0];
    if (!available || !String(available.mime_type).startsWith('image/')) return null;
    return {
      assetId: `publication-image:${media.asset.key}`,
      revision: media.asset.revision,
      art: null,
    };
  }
  return null;
}

/** SQL fences the owned pinned publication, ready image, and revealed map. */
export async function publicationPlaceReference(
  sql: SqlExecutor,
  worldId: string,
  placeId: string,
) {
  const row = (
    await sql.query(
      'SELECT asset_id,storage_key,mime_type FROM parallel_life.publication_scene_images_for_world($1) WHERE place_key=$2',
      [worldId, placeId],
    )
  ).rows[0];
  return row
    ? {
        assetId: String(row.asset_id),
        storageKey: String(row.storage_key),
        mimeType: String(row.mime_type),
      }
    : null;
}

/** Reuse the original receipt/channel/thread and scene place; no new model field. */
export async function sourceSceneReference(
  sql: SqlExecutor,
  worldId: string,
  ownerId: string,
  sourceEventId: string,
) {
  const row = (
    await sql.query(
      `SELECT s.document->>'placeId' AS place_id
    FROM parallel_life.world_events e
    JOIN parallel_life.agent_input_receipts r
      ON r.id=e.payload->'data'->'agentRuntime'->>'inputReceiptId'
      AND r.world_id=e.world_id AND r.owner_id=e.owner_id
    JOIN parallel_life.scene_sessions s
      ON s.id=r.document->>'threadId' AND s.world_id=e.world_id AND s.owner_id=e.owner_id
    WHERE e.id=$1 AND e.world_id=$2 AND e.owner_id=$3
      AND r.document->>'channel'='scene'`,
      [sourceEventId, worldId, ownerId],
    )
  ).rows[0];
  return row?.place_id ? publicationPlaceReference(sql, worldId, String(row.place_id)) : null;
}

/** An exact saved scene source and its presence intervals, not an appointment guest list. */
export async function sourceSceneComposition(
  sql: SqlExecutor,
  worldId: string,
  ownerId: string,
  sourceEventId: string,
) {
  const row = (
    await sql.query(
      `SELECT e.version,e.payload->>'storyAt' AS story_at,s.id AS scene_id,s.source_event_id,s.document,(SELECT p->>'name' FROM parallel_life.worlds w CROSS JOIN LATERAL jsonb_array_elements(w.state->'space'->'places') p WHERE w.id=e.world_id AND w.owner_id=e.owner_id AND p->>'id'=s.document->>'placeId') AS place_name FROM parallel_life.world_events e
     LEFT JOIN parallel_life.agent_input_receipts r ON r.id=e.payload->'data'->'agentRuntime'->>'inputReceiptId' AND r.world_id=e.world_id AND r.owner_id=e.owner_id
     JOIN parallel_life.scene_sessions s ON s.world_id=e.world_id AND s.owner_id=e.owner_id AND ((r.document->>'channel'='scene' AND s.id=r.document->>'threadId') OR (e.payload->>'type' IN ('scene.entered','scene.opened') AND s.id=e.payload->'data'->>'sceneId'))
     JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE e.id=$1 AND e.world_id=$2 AND e.owner_id=$3`,
      [sourceEventId, worldId, ownerId],
    )
  ).rows[0];
  if (!row) return null;
  const scene = row.document;
  if (
    scene.id !== row.scene_id ||
    scene.sourceEventId !== row.source_event_id ||
    scene.sourceVersion > row.version ||
    scene.worldId !== worldId ||
    scene.ownerId !== ownerId
  )
    return null;
  if (scene.status !== 'active')
    throw Object.assign(new Error('SCENE_REFERENCE_STALE'), {
      code: 'INVALID_STATE',
      responseOutcome: 'not_sent',
    });
  const present = (scene.presence ?? []).filter(
    (p: any) =>
      p.joinedVersion <= row.version &&
      (p.leftVersion === undefined || row.version < p.leftVersion),
  );
  if (!present.some((p: any) => p.participant?.kind === 'player')) return null;
  const current = (scene.presence ?? [])
    .filter((p: any) => p.leftVersion === undefined)
    .map(
      (p: any) =>
        `${p.participant?.kind === 'player' ? 'player' : p.participant?.actorId}:${p.joinedVersion}`,
    )
    .sort();
  const atSource = present
    .map(
      (p: any) =>
        `${p.participant?.kind === 'player' ? 'player' : p.participant?.actorId}:${p.joinedVersion}`,
    )
    .sort();
  if (
    current.length !== atSource.length ||
    current.some((id: string, i: number) => id !== atSource[i])
  )
    throw Object.assign(new Error('SCENE_REFERENCE_STALE'), {
      code: 'INVALID_STATE',
      responseOutcome: 'not_sent',
    });
  const actorIds = [
    ...new Set<string>(
      present
        .filter((p: any) => p.participant?.kind === 'actor')
        .map((p: any) => p.participant.actorId),
    ),
  ];
  return {
    sceneId: scene.id,
    placeId: scene.placeId as string | undefined,
    placeName: typeof row.place_name === 'string' ? row.place_name : undefined,
    storyAt: typeof row.story_at === 'string' ? row.story_at : undefined,
    version: Number(row.version),
    actorIds,
  };
}
