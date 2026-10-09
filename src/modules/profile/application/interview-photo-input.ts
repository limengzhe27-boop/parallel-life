import type { Interview } from '../../../contracts/api.ts';
import type { ModelImage } from '../../ai/application/ports.ts';
import { explicitPhotoPeople, resolvePhotoReference } from './person-extraction.ts';
export type InterviewPhotoInput = ModelImage & { sourceMessageId: string };
export type InterviewPhotoReadRequest = {
  ownerId: string;
  interviewId: string;
  sourceMessageId: string;
  assetId: string;
};
export interface InterviewPhotoReaderPort {
  read(input: InterviewPhotoReadRequest): Promise<InterviewPhotoInput>;
}

/** Selection uses only this interview's saved user messages, never the shared album. */
export function selectInterviewPhotos(messages: Interview['messages']) {
  const users = messages.filter((message) => message.role === 'user');
  const latest = users.at(-1);
  if (!latest) return [];
  const history = users.slice(0, -1);
  const wantsPair =
    /(?:这|刚才(?:的)?)(?:两|2)张(?:图|照片|图片)?|(?:比较|对比).{0,10}(?:两|2)张/u.test(
      latest.text,
    );
  if (latest.photoAssetId && !wantsPair) return [latest];
  if (!latest.photoAssetId && !wantsPair) {
    const references = explicitPhotoPeople(latest.text, latest.id)
      .map((p) => resolvePhotoReference(latest, history, p.quote, p.subject))
      .filter((m): m is NonNullable<typeof m> => !!m);
    if (references.length) {
      const unique = [...new Map(references.map((message) => [message.id, message])).values()];
      return unique.length <= 2 && new Set(unique.map((m) => m.photoAssetId)).size === unique.length
        ? unique
        : [];
    }
    // Questions may ask visible details, but never establish identity or photo ownership.
    if (!/这张|刚才那张|刚上传的(?:图|照片)|刚发的(?:图|照片)/u.test(latest.text)) return [];
  }
  const group: Interview['messages'] = latest.photoAssetId ? [latest] : [];
  let found = group.length > 0;
  for (const message of [...history].reverse()) {
    if (message.photoAssetId) {
      group.unshift(message);
      found = true;
      if (group.length > 2) return [];
    } else if (found) break;
    else {
      const clauses = message.text
        .split(/[，,。；;！!\n]/u)
        .map((c) => c.trim())
        .filter(Boolean);
      const labels = explicitPhotoPeople(message.text, message.id);
      if (!labels.length || labels.length !== clauses.length) return [];
    }
  }
  if (new Set(group.map((message) => message.photoAssetId)).size !== group.length) return [];
  return wantsPair ? (group.length === 2 ? group : []) : group.length === 1 ? group : [];
}
export async function readInterviewPhotos(
  reader: InterviewPhotoReaderPort | undefined,
  ownerId: string,
  interviewId: string,
  messages: Interview['messages'],
) {
  if (!reader) return [];
  const selected = selectInterviewPhotos(messages);
  const images: InterviewPhotoInput[] = [];
  for (const message of selected)
    images.push(
      await reader.read({
        ownerId,
        interviewId,
        sourceMessageId: message.id,
        assetId: message.photoAssetId!,
      }),
    );
  return images;
}
