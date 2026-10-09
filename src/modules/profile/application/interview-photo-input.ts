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

/** Quoted/reported/negated requests do not authorize sending historical pixels. */
function photoIntent(text: string) {
  const unquoted = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"\n]*"|'[^'\n]*'/gu, '');
  const refusesRead =
    /(?:不要|别|不用|不必|无需|不需要|先不|不想|禁止).{0,5}(?:看|读|识别|分析)(?:图|照片|图片|这张|那张|任何|这些|这两张)/u.test(
      unquoted,
    );
  const requested = unquoted
    .split(/[，,。；;！!\n]/u)
    .filter(
      (clause) =>
        !/(?:转述|引用|据说|听说)/u.test(clause) &&
        !/^\s*(?:他|她|朋友|同事|别人|对方|有人)(?:说|提到|要求|让我|叫我)/u.test(clause) &&
        !/(?:不要|别|不用|不必|无需|不需要|先不|不想|禁止).{0,5}(?:比较|对比|看|读|识别|分析)/u.test(
          clause,
        ),
    )
    .join('，');
  return { refusesRead, requested };
}
/** Selection uses only this interview's saved user messages, never the shared album. */
export function selectInterviewPhotos(messages: Interview['messages']) {
  const users = messages.filter((message) => message.role === 'user');
  const latest = users.at(-1);
  if (!latest) return [];
  const history = users.slice(0, -1);
  const intent = photoIntent(latest.text);
  if (intent.refusesRead) return [];
  const wantsPair =
    /(?:这|刚才(?:的)?)(?:两|2)张(?:图|照片|图片)?|(?:比较|对比).{0,10}(?:两|2)张/u.test(
      intent.requested,
    ) &&
    /(?:比较|对比|看看|看一下|看(?:这|刚才)|分别(?:看|描述|分析)|有什么不同|有何不同|有什么区别|有何区别|区别是什么)/u.test(
      intent.requested,
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
    if (!/这张|刚才那张|刚上传的(?:图|照片)|刚发的(?:图|照片)/u.test(intent.requested)) return [];
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
