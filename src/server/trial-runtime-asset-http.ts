import { Id } from '../contracts/api.ts';
import { isValidMediaMagicBytes } from '../modules/media/domain/magic-bytes.ts';
import type { AssetRepository } from '../modules/media/infrastructure/asset-repository.ts';
import { PublisherHttpError } from './publisher-http.ts';

/** Staff authorization and the exact private-trial binding must be resolved by the caller.
 * Reuse player runtime asset ownership/world/revision checks; never fall back to publication media.
 */
export async function readTrialRuntimeAsset(
  ownerId: string,
  worldId: string,
  assetId: string,
  requestedRevision: string | null,
  assets: Pick<AssetRepository, 'readForWorld'>,
) {
  const revision = Number(requestedRevision);
  if (
    !Id.safeParse(ownerId).success ||
    !Id.safeParse(worldId).success ||
    !Id.safeParse(assetId).success ||
    requestedRevision === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    throw new PublisherHttpError('NOT_FOUND');
  const bytes = await assets.readForWorld(ownerId, worldId, assetId, revision);
  const magic = isValidMediaMagicBytes(bytes);
  if (!magic.valid || !magic.mimeType) throw new PublisherHttpError('NOT_FOUND');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': magic.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
