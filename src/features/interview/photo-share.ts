import { ApiFailure } from '../api/client.ts';

type ReferencePhotoProfile = { version: number; referenceAssetIds: string[] };
type InterviewPhotoMessage = {
  id?: string;
  role: 'user' | 'assistant';
  text: string;
  photoAssetId?: string | null;
};
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

/** The stored asset reference is authoritative. Historic app markers are only
 * stripped from their captions after the migration has linked a real asset. */
export function parseInterviewPhotoMessage(message: InterviewPhotoMessage) {
  if (message.role !== 'user' || !message.photoAssetId) return null;
  const match = photoMessagePattern.exec(message.text);
  const caption =
    match?.[1]?.toLowerCase() === message.photoAssetId.toLowerCase()
      ? (match[2] ?? '').trim()
      : message.text.trim();
  return { assetId: message.photoAssetId.toLowerCase(), caption };
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
export async function confirmInterviewPhotoMessage<
  Workspace extends {
    interview: { messages: InterviewPhotoMessage[] };
  },
>(
  read: () => Promise<Workspace>,
  ready: Workspace,
  assetId: string,
  send: (workspace: Workspace) => Promise<void>,
): Promise<Workspace> {
  if (hasInterviewPhotoMessage(ready.interview.messages, assetId)) return ready;
  let sendError: unknown;
  try {
    await send(ready);
  } catch (error) {
    // A stream can fail after the user message commits. Read before deciding
    // whether this photo still needs sending; never pay for a second reply here.
    sendError = error;
  }
  const after = await read();
  if (hasInterviewPhotoMessage(after.interview.messages, assetId)) return after;
  if (sendError) throw sendError;
  throw new ApiFailure('UNAVAILABLE', '照片已保存，但消息还没有确认发送。请重试这张照片。');
}
