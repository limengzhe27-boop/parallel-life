import { ApiFailure } from '../api/client.ts';

type ReferencePhotoProfile = { version: number; referenceAssetIds: string[] };
type InterviewPhotoMessage = { id?: string; role: 'user' | 'assistant'; text: string };
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

const assetIdPattern =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const photoMessagePattern = new RegExp(
  `^\\[照片:/api/v1/assets/(${assetIdPattern})\\](?:\\r?\\n([\\s\\S]*))?$`,
);

/** Legacy photo messages are text. Only this exact, same-origin asset marker
 * may become an image in the UI; never trust a model-provided URL. */
export function parseInterviewPhotoMessage(message: InterviewPhotoMessage) {
  if (message.role !== 'user') return null;
  const match = photoMessagePattern.exec(message.text);
  const assetId = match?.[1];
  if (!assetId) return null;
  return { assetId: assetId.toLowerCase(), caption: (match[2] ?? '').trim() };
}

export function hasInterviewPhotoMessage(messages: InterviewPhotoMessage[], assetId: string) {
  return messages.some(
    (message) =>
      !message.id?.startsWith('temp-') &&
      parseInterviewPhotoMessage(message)?.assetId === assetId.toLowerCase(),
  );
}

/** Re-read before and after sending because a streaming request can fail after
 * the user message committed. A retry never sends again once that photo is
 * present in the saved interview. */
export async function confirmInterviewPhotoMessage<Workspace extends {
  interview: { messages: InterviewPhotoMessage[] };
}>(
  read: () => Promise<Workspace>,
  ready: Workspace,
  assetId: string,
  send: (workspace: Workspace) => Promise<void>,
): Promise<Workspace> {
  if (hasInterviewPhotoMessage(ready.interview.messages, assetId)) return ready;
  await send(ready);
  const after = await read();
  if (!hasInterviewPhotoMessage(after.interview.messages, assetId))
    throw new ApiFailure('UNAVAILABLE', '照片已保存，但消息还没有确认发送。请重试这张照片。');
  return after;
}
