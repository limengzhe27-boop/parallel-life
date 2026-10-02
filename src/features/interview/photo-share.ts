import { ApiFailure } from '../api/client.ts';

type ReferencePhotoProfile = { version: number; referenceAssetIds: string[] };
type ReferencePhotoClient<Profile extends ReferencePhotoProfile> = {
  workspace(): Promise<{ profile: Profile }>;
  editProfile(input: {
    expectedVersion: number;
    operation: { kind: 'add-reference-photo'; assetId: string };
  }): Promise<Profile>;
};

/** An uploaded asset is not a shared interview photo until it belongs to the
 * real profile. Re-read after a version race so a lost response never attaches
 * it twice or asks the user to upload the same bytes again. */
export async function ensureInterviewPhotoSaved<Profile extends ReferencePhotoProfile>(
  client: ReferencePhotoClient<Profile>,
  assetId: string,
): Promise<Profile> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { profile } = await client.workspace();
    if (profile.referenceAssetIds.includes(assetId)) return profile;
    try {
      const saved = await client.editProfile({
        expectedVersion: profile.version,
        operation: { kind: 'add-reference-photo', assetId },
      });
      if (!saved.referenceAssetIds.includes(assetId))
        throw new ApiFailure('UNAVAILABLE', '照片还没有加入「我的」，请重试。');
      return saved;
    } catch (error) {
      if (!(error instanceof ApiFailure && error.code === 'VERSION_CONFLICT') || attempt === 1)
        throw error;
    }
  }
  throw new ApiFailure('VERSION_CONFLICT', '资料刚有变化，请重试保存照片。');
}
