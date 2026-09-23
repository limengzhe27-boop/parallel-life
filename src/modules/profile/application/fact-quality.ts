import type { LifeEvent, ProfileFact } from '../../../contracts/api.ts';

/**
 * Decides what an interview turn may write into the real profile.
 *
 * Two failures motivated this: the model recorded almost everything it heard
 * (greetings, moods, the assistant's own wording), and it re-recorded what the
 * user had already filled in the basic-info card, so 我的 filled up with
 * near-duplicates. Extraction stays a model job; this keeps the deterministic
 * part of the decision testable.
 */
const TRANSIENT = /(正在|刚刚|刚才|今天|昨天|明天|这会儿|此刻)/;
const META = /(你想|你可以|建议你|需要我|要不要我|我可以帮你)/;
const HYPOTHETICAL = /(如果|假如|要是|假如说|万一)/;
const QUESTION = /[?？]\s*$/;

/** The six fields of the 我的 basic-info card, stored as one labelled blob. */
export function basicInfoPairs(blob: string): { label: string; value: string }[] {
  if (!blob.startsWith('个人资料\n')) return [];
  return blob
    .split('\n')
    .slice(1)
    .map((line) => {
      const separator = line.indexOf('：');
      if (separator < 0) return null;
      const label = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      return label && value ? { label, value } : null;
    })
    .filter((pair): pair is { label: string; value: string } => Boolean(pair));
}

/**
 * True when the statement only repeats the basic-info card (city, job, birthday,
 * hometown …). Detail beyond the card still gets recorded, so "在杭州做产品设计"
 * is dropped while "在杭州做产品设计，负责 B 端结算" is kept.
 */
export function coveredByBasicInfo(text: string, pairs: { label: string; value: string }[]): boolean {
  if (!pairs.length) return false;
  let remaining = text;
  let matched = false;
  for (const pair of pairs) {
    if (pair.value.length < 2 || !remaining.includes(pair.value)) continue;
    matched = true;
    remaining = remaining.split(pair.value).join('');
  }
  if (!matched) return false;
  const rest = remaining.replace(/[\s，,。.、；;：:的是在做有和与及了]/g, '');
  return rest.length < 4;
}

export type RecordableInput = {
  category: 'identity' | 'interest' | 'personality' | 'relationship' | 'wish' | 'experience';
  text: string;
  eventDate?: string | null;
};

export type ExistingProfile = {
  facts: Pick<ProfileFact, 'category' | 'value' | 'status'>[];
  events: Pick<LifeEvent, 'title'>[];
  /** The raw 个人资料 blob, if the user filled the card. */
  basicInfoBlob?: string;
};

/**
 * Returns a short reason when a statement must not be written, or null when it
 * may be recorded. Reasons are stable strings so they can be asserted and
 * counted without logging user text.
 */
export function rejectReason(
  input: RecordableInput,
  existing: ExistingProfile,
): string | null {
  const text = input.text.trim();
  if (text.length < 4) return 'TOO_SHORT';
  if (QUESTION.test(text)) return 'QUESTION';
  if (META.test(text)) return 'ASSISTANT_WORDING';
  if (input.category === 'experience') return null;
  if (TRANSIENT.test(text)) return 'TRANSIENT';
  if (HYPOTHETICAL.test(text) && input.category !== 'wish') return 'HYPOTHETICAL';
  if (coveredByBasicInfo(text, basicInfoPairs(existing.basicInfoBlob ?? '')))
    return 'BASIC_INFO_DUPLICATE';
  /* A fact the user rejected must not come back as a new row. */
  if (
    existing.facts.some(
      (fact) => fact.status === 'rejected' && fact.value.trim() === text,
    )
  )
    return 'USER_REJECTED';
  return null;
}

/**
 * Collapses near-duplicates inside one turn, keeping the first wording and
 * merging the evidence. The profile merge in the repository handles duplicates
 * against earlier turns.
 */
export function dedupeBatch<T extends RecordableInput & { sourceMessageIds: string[] }>(
  candidates: T[],
  same: (a: string, b: string) => boolean,
): T[] {
  const kept: T[] = [];
  for (const candidate of candidates) {
    const existing = kept.find(
      (item) => item.category === candidate.category && same(item.text, candidate.text),
    );
    if (existing) {
      existing.sourceMessageIds = [
        ...new Set([...existing.sourceMessageIds, ...candidate.sourceMessageIds]),
      ];
      if (!existing.eventDate && candidate.eventDate) existing.eventDate = candidate.eventDate;
      continue;
    }
    kept.push({ ...candidate, sourceMessageIds: [...candidate.sourceMessageIds] });
  }
  return kept;
}
