import type { PublicationIssue } from './publication-content.ts';

type Data = Record<string, unknown>;
const object = (value: unknown): value is Data =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): Data[] => (Array.isArray(value) ? value.filter(object) : []);
const normalized = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(normalized)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, normalized(value[key])]),
        )
      : value;
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));

/** Private role demonstration permits runtime completion, never expansion of the authored cast or plot. */
export function protectCharacterTrialProposal(baseline: Data, proposal: Data) {
  const issues: PublicationIssue[] = [];
  const updated = { ...proposal };
  const originals = rows(baseline.actors);
  const add = (path: (string | number)[], code: string) => issues.push({ path, code });
  if (!originals.length) add(['actors'], 'character_trial_actor_required');
  const proposed = rows(proposal.actors);
  if (Object.hasOwn(proposal, 'actors')) {
    if (!Array.isArray(proposal.actors)) add(['actors'], 'character_trial_actor_set_changed');
    for (const [index, actor] of proposed.entries())
      if (originals.filter((old) => old.key === actor.key && old.name === actor.name).length !== 1)
        add(['actors', index], 'character_trial_actor_set_changed');
    for (const [index, old] of originals.entries())
      if (proposed.filter((actor) => actor.key === old.key && actor.name === old.name).length !== 1)
        add(['actors', index], 'character_trial_actor_set_changed');
  }
  updated.actors = originals.map((old, index) => {
    const matches = proposed.filter((actor) => actor.key === old.key && actor.name === old.name);
    const next = matches.length === 1 ? { ...matches[0]! } : { ...old };
    for (const field of ['lifeModules', 'knownAtStart'] as const) {
      if (Object.hasOwn(next, field) && !equal(next[field], old[field]))
        add(['actors', index, field], 'character_trial_author_content_changed');
      if (Object.hasOwn(old, field)) next[field] = old[field];
      else delete next[field];
    }
    const card = object(old.publicCard) ? old.publicCard : {};
    if (object(next.publicCard))
      for (const key of Object.keys(next.publicCard))
        if (key !== 'traits' && !equal(next.publicCard[key], card[key]))
          add(['actors', index, 'publicCard', key], 'character_trial_author_content_changed');
    next.publicCard = { traits: [], ...card };
    next.key = old.key;
    next.name = old.name;
    return next;
  });
  // A demo has no authority to create prehistory, conditions or new story branches.
  for (const field of [
    'candidates',
    'history',
    'initialKnowledge',
    'relationships',
    'conditions',
    'timeline',
  ] as const) {
    if (Object.hasOwn(proposal, field)) {
      const authored = baseline[field] ?? (field === 'timeline' ? undefined : []);
      if (!equal(proposal[field], authored))
        add(
          [field],
          field === 'candidates'
            ? 'character_trial_event_set_changed'
            : 'character_trial_author_content_changed',
        );
    }
    if (Object.hasOwn(baseline, field)) updated[field] = baseline[field];
    else if (field === 'timeline' || field === 'conditions') delete updated[field];
    else updated[field] = [];
  }
  if (object(proposal.phone)) {
    const phone = { ...proposal.phone },
      prior = object(baseline.phone) ? baseline.phone : {};
    if (Array.isArray(phone.messages))
      phone.messages = phone.messages.filter((entry, index) => {
        if (
          !object(entry) ||
          entry.origin !== 'history' ||
          rows(prior.messages).some((old) => old.key === entry.key)
        )
          return true;
        const actor = originals.find((old) => old.key === entry.actorKey);
        const modules = actor && object(actor.lifeModules) ? actor.lifeModules : {};
        if (
          actor?.knownAtStart === true &&
          typeof modules.relationships === 'string' &&
          modules.relationships.trim()
        )
          return true;
        add(['phone', 'messages', index], 'character_trial_relationship_required');
        return false;
      });
    for (const collection of ['notes', 'invitations'] as const) {
      const authored = prior[collection] ?? [];
      if (Object.hasOwn(phone, collection) && !equal(phone[collection], authored))
        add(['phone', collection], 'character_trial_event_set_changed');
      phone[collection] = authored;
    }
    updated.phone = phone;
  }
  return { proposal: updated, issues };
}
