/** Only remap an already-authorized picture from the exact trial world's social response. */
export function trialMomentImageUrl(url: string, worldId: string, trialId: string): string {
  const prefix = `/api/v1/worlds/${encodeURIComponent(worldId)}/media/`;
  if (!url.startsWith(prefix)) return url;
  const assetId = url.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(assetId)) return url;
  return `/api/v1/publisher/trials/${encodeURIComponent(trialId)}/world/media/${assetId}`;
}
