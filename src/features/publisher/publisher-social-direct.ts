import { publicationStorageIssues } from '../../modules/settings/domain/publication-content.ts';

export type PublisherSocialFocus = 'history' | 'moments';
type Content = Record<string, unknown>;

/** The model's full draft is evidence to inspect, never the object we adopt directly. */
export class PublisherSocialAdoptionError extends Error {
  readonly code:
    | 'INVALID_DRAFT'
    | 'INVALID_ACTOR'
    | 'INVALID_PROPOSAL'
    | 'OUT_OF_SCOPE'
    | 'NO_NEW_CONTENT'
    | 'INVALID_NEW_CONTENT';
  constructor(
    code:
      | 'INVALID_DRAFT'
      | 'INVALID_ACTOR'
      | 'INVALID_PROPOSAL'
      | 'OUT_OF_SCOPE'
      | 'NO_NEW_CONTENT'
      | 'INVALID_NEW_CONTENT',
  ) {
    super(code);
    this.name = 'PublisherSocialAdoptionError';
    this.code = code;
  }
}

const record = (value: unknown): value is Content =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const key = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value);
const body = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const utc = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    value.length > 35 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  )
    return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 19) === value.slice(0, 19)
  );
};

/** JSON semantic equality: object field order is irrelevant; array order and every value matter. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (!record(a) || !record(b)) return false;
  const fields = Object.keys(a);
  return (
    fields.length === Object.keys(b).length &&
    fields.every((field) => Object.hasOwn(b, field) && same(a[field], b[field]))
  );
}

function validateNewRow(
  row: unknown,
  actorKey: string,
  focus: PublisherSocialFocus,
  openingAt: unknown,
) {
  if (!record(row) || !key(row.key) || row.actorKey !== actorKey || !utc(row.at))
    throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
  const fields =
    focus === 'history'
      ? ['key', 'actorKey', 'origin', 'speaker', 'text', 'at']
      : ['key', 'actorKey', 'text', 'at'];
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field)) ||
    !body(row.text, focus === 'history' ? 500 : 1600)
  )
    throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
  if (
    focus === 'history' &&
    (row.origin !== 'history' || (row.speaker !== 'actor' && row.speaker !== 'player'))
  )
    throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
  // An unfinished screenplay may not have an opening time; never invent one here.
  if (
    utc(openingAt) &&
    (Date.parse(row.at) > Date.parse(openingAt) ||
      (focus === 'history' && Date.parse(row.at) === Date.parse(openingAt)))
  )
    throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
}

/**
 * Adopt only append-only, selected-person WeChat content from a completed project Agent result.
 * Throws on any changed author material, including a changed existing message or private card.
 * The returned draft is copied from `currentContent`, not trusted from the model response.
 */
function adoptFocusedSocialProposal(
  currentContent: Content,
  actorKey: string,
  focus: PublisherSocialFocus,
  proposedContent: Content,
): { updatedContent: Content; addedCount: number } {
  if (publicationStorageIssues(currentContent).length || !record(currentContent))
    throw new PublisherSocialAdoptionError('INVALID_DRAFT');
  if (publicationStorageIssues(proposedContent).length || !record(proposedContent))
    throw new PublisherSocialAdoptionError('INVALID_PROPOSAL');
  if (!key(actorKey) || (focus !== 'history' && focus !== 'moments'))
    throw new PublisherSocialAdoptionError('INVALID_ACTOR');
  const actors = Array.isArray(currentContent.actors) ? currentContent.actors : [];
  const selected = actors.filter((actor) => record(actor) && actor.key === actorKey);
  if (selected.length !== 1 || selected[0]?.knownAtStart !== true)
    throw new PublisherSocialAdoptionError('INVALID_ACTOR');
  const currentPhone = currentContent.phone === undefined ? {} : currentContent.phone;
  const proposedPhone = proposedContent.phone;
  if (!record(currentPhone) || !record(proposedPhone))
    throw new PublisherSocialAdoptionError('INVALID_PROPOSAL');
  const collection = focus === 'history' ? 'messages' : 'moments';
  const before = currentPhone[collection] === undefined ? [] : currentPhone[collection];
  const after = proposedPhone[collection];
  if (!Array.isArray(before) || !Array.isArray(after))
    throw new PublisherSocialAdoptionError('INVALID_PROPOSAL');
  if (after.length < before.length) throw new PublisherSocialAdoptionError('OUT_OF_SCOPE');
  if (after.length > (focus === 'history' ? 40 : 48))
    throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
  if (!before.every((row, i) => same(row, after[i])))
    throw new PublisherSocialAdoptionError('OUT_OF_SCOPE');
  const expected: Content = {
    ...currentContent,
    phone: { ...currentPhone, [collection]: after },
  };
  if (!same(expected, proposedContent)) throw new PublisherSocialAdoptionError('OUT_OF_SCOPE');
  if (after.length === before.length) throw new PublisherSocialAdoptionError('NO_NEW_CONTENT');

  const keys = new Set<unknown>();
  for (const row of before) {
    if (!record(row) || !key(row.key) || keys.has(row.key))
      throw new PublisherSocialAdoptionError('INVALID_DRAFT');
    keys.add(row.key);
  }
  const openingAt = record(currentContent.world) ? currentContent.world.startAt : undefined;
  if (openingAt !== undefined && openingAt !== '' && !utc(openingAt))
    throw new PublisherSocialAdoptionError('INVALID_DRAFT');
  for (const row of after.slice(before.length)) {
    validateNewRow(row, actorKey, focus, openingAt);
    if (keys.has((row as Content).key))
      throw new PublisherSocialAdoptionError('INVALID_NEW_CONTENT');
    keys.add((row as Content).key);
  }
  // The two documents were checked as plain, bounded JSON. Clone only the authoritative draft.
  const updatedContent = JSON.parse(JSON.stringify(currentContent)) as Content;
  const phone = record(updatedContent.phone) ? updatedContent.phone : {};
  phone[collection] = JSON.parse(JSON.stringify(after)) as unknown[];
  updatedContent.phone = phone;
  return { updatedContent, addedCount: after.length - before.length };
}

/** Fail closed and leave the editor's draft untouched when the proposal exceeds its scope. */
export function applyDirectSocialProposal(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  actorKey: string,
  focus: 'history' | 'moments',
): { content: Record<string, unknown>; added: number; error?: string } {
  try {
    const accepted = adoptFocusedSocialProposal(current, actorKey, focus, proposed);
    return { content: accepted.updatedContent, added: accepted.addedCount };
  } catch (error) {
    return {
      content: current,
      added: 0,
      error: error instanceof PublisherSocialAdoptionError ? error.code : 'INVALID_PROPOSAL',
    };
  }
}
