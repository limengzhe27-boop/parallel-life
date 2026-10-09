import { z } from 'zod';
import { Id, Version } from './api.ts';
/** Upload access registration and reference purpose are separate. */
export const ProfilePhotoRolesSchema = z.strictObject({
  profileId: Id,
  profileVersion: Version,
  portraitAssetId: Id.nullable(),
  sharedAssetIds: z.array(Id).max(37),
  referenceAssetIds: z.array(Id).max(6),
  personAssets: z.array(z.strictObject({ personId: Id, assetId: Id })).max(30),
});
export type ProfilePhotoRoles = z.infer<typeof ProfilePhotoRolesSchema>;
