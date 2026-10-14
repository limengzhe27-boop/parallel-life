const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A scene picture URL is only built from the database-authorized asset ID. */
export function publicationSceneImageUrl(worldId: string, assetId: string): string {
  if (!uuid.test(worldId) || !uuid.test(assetId)) throw new Error('INVALID_SCENE_IMAGE_REFERENCE');
  return `/api/v1/worlds/${worldId}/media/${assetId}`;
}

/** Scope an already-authorized player URL to the exact staff trial proxy. */
export function trialSceneImageUrl(url: string, worldId: string, trialId: string): string {
  if (!uuid.test(worldId) || !uuid.test(trialId)) return url;
  const prefix = `/api/v1/worlds/${worldId}/media/`;
  if (!url.startsWith(prefix)) return url;
  const assetId = url.slice(prefix.length);
  if (!uuid.test(assetId)) return url;
  return `/api/v1/publisher/trials/${trialId}/world/media/${assetId}`;
}
