/** Server-issued scope for one pending opportunity considered alongside a real private player turn. */
export type PlayerEpisodeManifest = {
  schemaVersion: 1;
  requestId: string;
  requestRevision: 0;
  episodeId: string;
  actorId: string;
  engineEpoch: number;
  createdAtVersion: number;
  sourceId: string;
  contentHash: string;
};
export function validPlayerEpisodeManifest(value: unknown): value is PlayerEpisodeManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as PlayerEpisodeManifest;
  return (
    Object.keys(m).sort().join(',') ===
      'actorId,contentHash,createdAtVersion,engineEpoch,episodeId,requestId,requestRevision,schemaVersion,sourceId' &&
    m.schemaVersion === 1 &&
    m.requestRevision === 0 &&
    [m.requestId, m.episodeId, m.actorId].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 240,
    ) &&
    Number.isSafeInteger(m.engineEpoch) &&
    m.engineEpoch >= 2 &&
    Number.isSafeInteger(m.createdAtVersion) &&
    m.createdAtVersion >= 0 &&
    m.sourceId === 'episode-intent:' + m.requestId &&
    /^[a-f0-9]{64}$/.test(m.contentHash)
  );
}
