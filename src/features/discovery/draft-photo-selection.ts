import type { LifeDraft } from '../../contracts/life-drafts.ts';
import type { ProfilePhotoRoles } from '../../contracts/profile-photo-roles.ts';
type Selection = LifeDraft['selection'];

/** Friend photos have one selection control: the person, never a second photo checkbox. */
export function optionalDraftPhotos(roles?: ProfilePhotoRoles): string[] {
  if (!roles) return [];
  const personPhotos = new Set(roles.personAssets.map((item) => item.assetId));
  return [
    ...new Set([
      ...roles.referenceAssetIds,
      ...(roles.portraitAssetId ? [roles.portraitAssetId] : []),
    ]),
  ].filter((id) => !personPhotos.has(id));
}

/** For editable selections only; confirmed snapshots never enter this synchronization path. */
export function synchronizeDraftPhotos(
  selection: Selection,
  roles: ProfilePhotoRoles,
  previousRoles?: ProfilePhotoRoles,
): Selection {
  const optional = new Set(optionalDraftPhotos(roles));
  // Only a previously verified mapping proves that these were automatic photos.
  // Historical selections without that provenance keep their explicit references.
  const previousPersonPhotos = new Set(
    previousRoles?.profileId === roles.profileId
      ? previousRoles.personAssets.map((item) => item.assetId)
      : [],
  );
  const automatic = roles.personAssets
    .filter((item) => selection.personIds.includes(item.personId))
    .map((item) => item.assetId);
  const assetIds = [
    ...new Set([
      ...selection.assetIds.filter((id) => optional.has(id) && !previousPersonPhotos.has(id)),
      ...automatic,
    ]),
  ];
  const portraitAssetId =
    selection.portraitAssetId === roles.portraitAssetId &&
    selection.portraitAssetId &&
    assetIds.includes(selection.portraitAssetId)
      ? selection.portraitAssetId
      : null;
  if (
    JSON.stringify(assetIds) === JSON.stringify(selection.assetIds) &&
    portraitAssetId === selection.portraitAssetId
  )
    return selection;
  return { ...selection, assetIds, portraitAssetId };
}
