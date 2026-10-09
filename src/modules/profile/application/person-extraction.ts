import type { Person } from '../../../contracts/api.ts';

/** Proposals contain literal user evidence, never asset identifiers or diagnoses. */
export type PersonProposal = {
  personId?: string;
  subject: string;
  messageId: string;
  quote: string;
  knownName?: string;
  description?: string;
  experience?: string;
  associatePhoto?: boolean;
};
const relationships = new Set([
  '表姐',
  '表哥',
  '表妹',
  '表弟',
  '堂姐',
  '堂哥',
  '堂妹',
  '堂弟',
  '姐姐',
  '哥哥',
  '妹妹',
  '弟弟',
  '妈妈',
  '爸爸',
  '母亲',
  '父亲',
  '奶奶',
  '爷爷',
  '外婆',
  '外公',
  '妻子',
  '丈夫',
  '女朋友',
  '男朋友',
  '同事',
  '朋友',
  '同学',
  '室友',
  '老师',
  '班主任',
  '教导主任',
  '班主任女友',
  '班主任的女朋友',
  '领导',
  '老板',
  '下属',
  '邻居',
]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export type GroundedPerson = {
  existingId?: string;
  subject: string;
  knownName?: string;
  description?: string;
  experience?: string;
  quote: string;
  associatePhoto: boolean;
  photoLabel: boolean;
};

/** Ambiguity stays in the conversation; a label/name/photo alone cannot merge people. */
export function groundPersonProposal(
  proposal: PersonProposal,
  source: string,
  people: Person[],
  photoLabelsOnly = false,
): GroundedPerson | null {
  const { subject, quote } = proposal;
  if (
    !source.includes(quote) ||
    (!relationships.has(subject) && !explicitPhotoReference(quote, subject))
  )
    return null;
  if (/[？?]/u.test(quote) || /[“”「」『』"]/u.test(source)) return null;
  if (new RegExp('(?:不是|并非)我(?:的)?' + escape(subject), 'u').test(quote)) return null;
  // A conditional attribution is not an assertion. Explicit story captions may label photos only.
  if (/如果|假如|假设|要是|设想|算命|星座/u.test(source)) return null;
  const explicitStoryLabel = /平行|剧本|虚构|故事里|角色/u.test(source);
  if (explicitStoryLabel && !explicitPhotoReference(quote, subject)) return null;
  if (/另一个|另一位|两个|两位|同名|不确定|不知道是谁|可能是/u.test(source)) return null;
  const photoReference = explicitPhotoReference(quote, subject);
  const selfRelation = new RegExp(`我(?:的)?${escape(subject)}`, 'u').test(quote);
  const photoLabel = Boolean(
    photoReference &&
    (photoLabelsOnly || explicitStoryLabel || !selfRelation || !relationships.has(subject)),
  );
  if (photoLabelsOnly && !photoReference) return null;
  if (!new RegExp(`我(?:的)?${escape(subject)}`, 'u').test(quote) && !photoReference) return null;
  if (
    !photoReference &&
    [...relationships].filter((r) => new RegExp('我(?:的)?' + escape(r), 'u').test(quote))
      .length !== 1
  )
    return null;
  const matches = photoLabel ? [] : people.filter((p) => p.relationship === subject);
  // Identity resolution requires an explicit relation, not a name-only lookup.
  if (matches.length > 1) return null;
  const existing = matches[0];
  if (proposal.personId && proposal.personId !== existing?.id) return null;
  if (existing && !('knownName' in existing) && existing.name !== subject) return null;
  if (
    !photoLabel &&
    !existing &&
    people.some((p) => p.name === subject || p.temporaryLabel === subject)
  )
    return null;
  const knownName = proposal.knownName;
  if (
    knownName &&
    !new RegExp(`(?:叫|名字是|昵称是)${escape(knownName)}(?:[，。！；\\s]|$)`, 'u').test(quote)
  )
    return null;
  if (existing?.knownName && knownName && existing.knownName !== knownName) return null;
  // Exact excerpts keep opinions attributed to the user instead of rewriting them as facts.
  // Model summaries are never persisted. For descriptions use only the verified user quote.
  if (proposal.experience && !quote.includes(proposal.experience)) return null;
  if (!proposal.description && !proposal.experience && !knownName && !proposal.associatePhoto)
    return null;
  return {
    existingId: existing?.id,
    photoLabel,
    subject,
    knownName,
    // Keep the whole short description quote when no separate experience was extracted.
    // This preserves qualifications such as kindness + interference instead of only a negative label.
    description: proposal.description
      ? proposal.experience
        ? quote.replace(proposal.experience, '').replace(/^[，。；\s]+|[，；\s]+$/gu, '') ||
          undefined
        : quote
      : undefined,
    experience: proposal.experience,
    quote,
    associatePhoto: Boolean(proposal.associatePhoto && photoReference),
  };
}

/** User-authored photo labels are evidence of a label, never face recognition. */
export function explicitPhotoReference(
  quote: string,
  subject: string,
): { ordinal?: number } | null {
  if (
    !/^[\p{L}\p{N}· _-]{1,40}$/u.test(subject) ||
    /如果|假如|假设|要是|不是|并非|可能|不确定|不知道|[？?]/u.test(quote)
  )
    return null;
  const match = new RegExp(
    '(?:第([一二三四五六1-6])张(?:照片)?(?:是)?|这张(?:照片)?(?:是)?|这是|刚才那张(?:照片)?(?:是)?)(?:我(?:的)?)?' +
      escape(subject) +
      '(?:的)?(?:照片|头像)?(?:[，,。；;！!\\s]|$)',
    'u',
  ).exec(quote);
  if (!match) return null;
  const n = match[1];
  return n
    ? { ordinal: '一二三四五六'.includes(n) ? '一二三四五六'.indexOf(n) + 1 : Number(n) }
    : {};
}

/** A bounded literal extraction, supplementary to the one existing model call. */
export function explicitPhotoPeople(text: string, messageId: string): PersonProposal[] {
  if (/如果|假如|假设|要是|[“”「」『』"]/u.test(text)) return [];
  return text
    .split(/[，,。；;！!\n]/u)
    .flatMap((clause) => {
      const quote = clause.trim();
      const match =
        /(?:第[一二三四五六1-6]张(?:照片)?|这张(?:照片)?|刚才那张(?:照片)?|这是)(?:是)?\s*(.+)$/u.exec(
          quote,
        );
      if (!match) return [];
      const subject = match[1]!
        .replace(/^我(?:的)?/u, '')
        .replace(/(?:的)?(?:照片|头像)$/u, '')
        .trim();
      // A literal user name/label is permitted; it never becomes a guessed real relationship.
      return explicitPhotoReference(quote, subject)
        ? [{ subject, messageId, quote, associatePhoto: true }]
        : [];
    })
    .slice(0, 3);
}

export type PhotoEvidenceMessage = {
  id: string;
  text: string;
  photoAssetId: string | null;
  createdAt: string;
};
/** Ordinals need a distinguishable adjacent group; explicit recency selects the nearest group. */
export function resolvePhotoReference(
  source: PhotoEvidenceMessage,
  history: PhotoEvidenceMessage[],
  quote: string,
  subject: string,
): PhotoEvidenceMessage | null {
  const reference = explicitPhotoReference(quote, subject);
  if (!reference) return null;
  if (
    /不是.{0,12}(?:刚才|刚发|刚上传|这组)|不要.{0,12}(?:刚才|刚发|这组)|上一组|之前那组|最早那组/u.test(
      source.text,
    )
  )
    return null;
  if (source.photoAssetId) {
    if (!reference.ordinal) return source;
    const preceding: PhotoEvidenceMessage[] = [];
    for (const message of [...history].reverse()) {
      if (!message.photoAssetId) break;
      preceding.unshift(message);
    }
    const currentGroup = [...preceding, source];
    if (
      currentGroup.length > 6 ||
      new Set(currentGroup.map((m) => m.photoAssetId)).size !== currentGroup.length
    )
      return null;
    // A caption on an attached photo must point to that very upload, not a different historical item.
    return reference.ordinal === currentGroup.length ? source : null;
  }
  const recent = history.filter(
    (m) => m.id !== source.id && Date.parse(m.createdAt) <= Date.parse(source.createdAt),
  );
  const groups: PhotoEvidenceMessage[][] = [];
  let adjacent = false;
  for (const message of recent) {
    if (message.photoAssetId) {
      if (!adjacent) groups.push([]);
      groups.at(-1)!.push(message);
      adjacent = true;
    } else adjacent = false;
  }
  // Complete literal captions may continue a group; ordinary conversation never does.
  if (!adjacent) {
    const captions: PhotoEvidenceMessage[] = [];
    const uploads: PhotoEvidenceMessage[] = [];
    for (const message of [...recent].reverse()) {
      if (!message.photoAssetId && uploads.length) break;
      if (message.photoAssetId) uploads.unshift(message);
      else captions.unshift(message);
    }
    if (!uploads.length || !captions.length) return null;
    if (uploads.length > 6 || new Set(uploads.map((m) => m.photoAssetId)).size !== uploads.length)
      return null;
    const claims = new Map<string, string>();
    let established = false;
    for (const caption of captions) {
      const clauses = caption.text
        .split(/[，,。；;！!\n]/u)
        .map((c) => c.trim())
        .filter(Boolean);
      const labels = explicitPhotoPeople(caption.text, caption.id);
      if (!labels.length || labels.length !== clauses.length) return null;
      if (
        clauses.some(
          (clause) =>
            !/^(?:(?:故事里|故事中|剧本里|剧本中)\s*)?(?:刚才\s*)?(?:第[一二三四五六1-6]张|这张|刚才那张|这是)/u.test(
              clause,
            ),
        )
      )
        return null;
      if (labels.some((label, index) => label.quote !== clauses[index])) return null;
      if (/不是|并非|不要|上一组|之前那组|最早那组|另一个|另一位|同名|不确定/u.test(caption.text))
        return null;
      for (const label of labels) {
        const ref = explicitPhotoReference(label.quote, label.subject);
        if (!ref) return null;
        const recency = /刚才|刚发|刚上传|这两张|这几张/u.test(caption.text);
        const deictic = !ref.ordinal && /(?:这是|这张)/u.test(label.quote);
        if (!established && groups.length !== 1 && !recency && !deictic) return null;
        const photo = ref.ordinal
          ? uploads[ref.ordinal - 1]
          : uploads.length === 1
            ? uploads[0]
            : null;
        if (!photo || !uploads.some((upload) => upload.id === photo.id)) return null;
        if (claims.has(photo.id) && claims.get(photo.id) !== label.subject) return null;
        claims.set(photo.id, label.subject);
      }
      established = true;
    }
    const target = reference.ordinal
      ? uploads[reference.ordinal - 1]
      : uploads.length === 1
        ? uploads[0]
        : null;
    if (target && claims.has(target.id) && claims.get(target.id) !== subject) return null;
    return target ?? null;
  }
  const recentReference = /刚才|刚发|刚上传|这两张|这几张/u.test(source.text);
  // A direct deictic caption identifies one immediate upload, never a multi-photo group.
  const immediateSingle = !reference.ordinal && /(?:这是|这张)/u.test(quote);
  if (!recentReference && groups.length !== 1 && !immediateSingle) return null;
  const group = groups.at(-1)!;
  if (group.length > 6 || new Set(group.map((m) => m.photoAssetId)).size !== group.length)
    return null;
  return reference.ordinal
    ? (group[reference.ordinal - 1] ?? null)
    : group.length === 1
      ? group[0]!
      : null;
}

/** A story caption can label a photo without asserting a real relationship. */
export function isStoryPersonContext(text: string, earlierTexts: string[]): boolean {
  const creative = /想(?:成为|当|体验|试试)|虚构|故事|角色|平行|古惑仔|如果|假如/u;
  const reality = /现实(?:中|里的|人物|照片|关系)|真实(?:的)?人物|本人现实/u;
  if (creative.test(text)) return true;
  if (reality.test(text)) return false;
  const latestBoundary = [...earlierTexts]
    .reverse()
    .find((t) => creative.test(t) || reality.test(t));
  return Boolean(latestBoundary && creative.test(latestBoundary));
}
