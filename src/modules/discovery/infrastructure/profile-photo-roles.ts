import type { Profile } from '../../../contracts/api.ts';
import { ProfilePhotoRolesSchema } from '../../../contracts/profile-photo-roles.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
/** Only resolves owned saved message metadata, never image recognition or private text. */
export async function profilePhotoRoles(sql: SqlClient, owner: string, profile: Profile) {
  const sourceIds = [...new Set(profile.people.flatMap((p) => p.sourceMessageIds ?? []))];
  const history = sourceIds.length
    ? (
        await sql.query(
          "SELECT photo_asset_id FROM parallel_life.interview_messages WHERE owner_id=$1 AND role='user' AND id=ANY($2::uuid[]) AND photo_asset_id IS NOT NULL",
          [owner, sourceIds],
        )
      ).rows
    : [];
  const bound = new Set([
    ...profile.people.flatMap((p) => (p.assetId ? [p.assetId] : [])),
    ...history.map((r) => String(r.photo_asset_id)),
  ]);
  const registered = [
    ...new Set(
      [
        profile.portraitAssetId,
        ...profile.referenceAssetIds,
        ...profile.people.map((p) => p.assetId),
      ].filter((id): id is string => !!id),
    ),
  ];
  const available = registered.length
    ? new Set(
        (
          await sql.query(
            "SELECT id FROM parallel_life.assets WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND world_id IS NULL AND origin='upload' AND status='ready'",
            [owner, registered],
          )
        ).rows.map((r) => String(r.id)),
      )
    : new Set<string>();
  return ProfilePhotoRolesSchema.parse({
    profileId: profile.id,
    profileVersion: profile.version,
    portraitAssetId:
      profile.portraitAssetId &&
      available.has(profile.portraitAssetId) &&
      !bound.has(profile.portraitAssetId)
        ? profile.portraitAssetId
        : null,
    sharedAssetIds: registered.filter((id) => available.has(id)),
    referenceAssetIds: profile.referenceAssetIds.filter(
      (id) => available.has(id) && !bound.has(id),
    ),
    personAssets: profile.people.flatMap((p) =>
      p.assetId && available.has(p.assetId) ? [{ personId: p.id, assetId: p.assetId }] : [],
    ),
  });
}
