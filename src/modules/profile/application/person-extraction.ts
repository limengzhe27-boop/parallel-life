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
};

/** Ambiguity stays in the conversation; a label/name/photo alone cannot merge people. */
export function groundPersonProposal(
  proposal: PersonProposal,
  source: string,
  people: Person[],
): GroundedPerson | null {
  const { subject, quote } = proposal;
  if (!source.includes(quote) || !relationships.has(subject)) return null;
  if (/[？?]/u.test(quote) || /[“”「」『』"]/u.test(source)) return null;
  if (new RegExp('(?:不是|并非)我(?:的)?' + escape(subject), 'u').test(quote)) return null;
  // Conservative whole-message boundary: mixing fictional and real narration needs clarification.
  if (/如果|假如|假设|要是|设想|平行|剧本|虚构|故事里|角色|算命|星座/u.test(source)) return null;
  if (/另一个|另一位|两个|两位|同名|不确定|不知道是谁|可能是/u.test(source)) return null;
  if (!new RegExp(`我(?:的)?${escape(subject)}`, 'u').test(quote)) return null;
  if (
    [...relationships].filter((r) => new RegExp('我(?:的)?' + escape(r), 'u').test(quote))
      .length !== 1
  )
    return null;
  const matches = people.filter((p) => p.relationship === subject);
  // Identity resolution requires an explicit relation, not a name-only lookup.
  if (matches.length > 1) return null;
  const existing = matches[0];
  if (proposal.personId && proposal.personId !== existing?.id) return null;
  if (existing && !('knownName' in existing) && existing.name !== subject) return null;
  if (!existing && people.some((p) => p.name === subject || p.temporaryLabel === subject))
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
  const photoClaim = new RegExp(
    `(?:这是|这张|上传).{0,20}我(?:的)?${escape(subject)}.{0,8}(?:照片|头像)`,
    'u',
  ).test(quote);
  return {
    existingId: existing?.id,
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
    associatePhoto: Boolean(proposal.associatePhoto && photoClaim),
  };
}
