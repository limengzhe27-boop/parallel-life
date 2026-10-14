import { publicationStorageIssues, type PublicationIssue } from './publication-content.ts';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const fields: Record<string, string[]> = {
  '': [
    'schemaVersion',
    'work',
    'world',
    'protagonist',
    'actors',
    'relationships',
    'places',
    'routes',
    'history',
    'initialKnowledge',
    'phone',
    'media',
    'timeline',
    'candidates',
    'openingEventKey',
    'conditions',
    'extensions',
  ],
  work: ['key', 'title', 'hook', 'description', 'experienceNote', 'coverMediaKey'],
  world: ['publicSetting', 'tone', 'startAt', 'startPlaceKey', 'hiddenContext'],
  protagonist: ['identity', 'situation', 'knownFactKeys'],
  actors: ['key', 'name', 'knownAtStart', 'publicCard', 'privatePersona', 'lifeModules'],
  'actors.publicCard': ['identity', 'traits', 'appearance', 'avatarMediaKey', 'introduction'],
  'actors.lifeModules': ['lifeContext', 'traits', 'drives', 'behavior', 'relationships'],
  'actors.privatePersona': ['background', 'motivation', 'voice', 'boundaries'],
  relationships: ['key', 'fr\u006fm', 'to', 'description', 'visibility'],
  'relationships.fr\u006fm': ['kind', 'actorKey'],
  'relationships.to': ['kind', 'actorKey'],
  'relationships.visibility': ['kind', 'actorKeys'],
  places: ['key', 'name', 'description', 'knownAtStart', 'sceneMediaKey'],
  routes: ['fromPlaceKey', 'toPlaceKey', 'minutes'],
  history: ['key', 'kind', 'text', 'occurredAt', 'actorKeys', 'placeKey', 'visibility'],
  'history.visibility': ['kind', 'actorKeys'],
  initialKnowledge: ['actorKey', 'factKeys'],
  phone: ['messages', 'notes', 'invitations', 'album', 'moments'],
  'phone.messages': ['key', 'actorKey', 'origin', 'text', 'at', 'speaker', 'attachment'],
  'phone.messages.attachment': ['kind', 'assetId', 'label'],
  'phone.moments': ['key', 'actorKey', 'text', 'at'],
  'phone.notes': ['key', 'title', 'text', 'factKeys'],
  'phone.invitations': ['key', 'actorKeys', 'placeKey', 'messageKey', 'title', 'at', 'status'],
  timeline: ['initialStageKey', 'stages'],
  'timeline.stages': ['key', 'title', 'order', 'afterStageKeys', 'window'],
  'timeline.stages.window': ['notBefore', 'expiresAt'],
  candidates: [
    'key',
    'kind',
    'title',
    'editorialIntent',
    'direction',
    'actorKeys',
    'settingPlaceKey',
    'placeKey',
    'prerequisites',
    'conditionKeys',
    'mutuallyExclusiveNodeKeys',
    'intent',
    'timeline',
  ],
  conditions: ['key', 'title', 'match', 'prerequisites'],
  'conditions.prerequisites': ['kind', 'factKey', 'nodeKey', 'outcomes', 'placeKey', 'at'],
  'candidates.intent': ['kind', 'actorKey', 'text', 'actorKeys', 'placeKey', 'title', 'earliestAt'],
  'candidates.direction': ['mode', 'expectedImpact', 'experience'],
  'candidates.prerequisites': ['kind', 'factKey', 'nodeKey', 'outcomes', 'placeKey', 'at'],
  'candidates.timeline': ['stageKey', 'window', 'timeNote', 'excludeIfResolved', 'alternatives'],
  'candidates.timeline.window': ['notBefore', 'expiresAt'],
  'candidates.timeline.excludeIfResolved': ['nodeKey', 'outcomes'],
  'candidates.timeline.alternatives': ['onDeclined', 'onSkipped', 'onExpired'],
};
const immutable = new Set([
  'media',
  'extensions',
  'phone.album',
  'work.coverMediaKey',
  'actors.publicCard.avatarMediaKey',
  'places.sceneMediaKey',
]);
const keyed = new Set([
  'actors',
  'relationships',
  'places',
  'history',
  'phone.messages',
  'phone.moments',
  'phone.notes',
  'phone.invitations',
  'candidates',
  'conditions',
  'timeline.stages',
  'initialKnowledge',
  'routes',
]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** No model authority: fill blanks, preserving authored identities/order/scalars and opaque fields. */
export function mergePublicationPreparation(current: RecordValue, proposal: RecordValue) {
  if (publicationStorageIssues(current).length || publicationStorageIssues(proposal).length)
    throw Object.assign(new Error('INVALID_PREPARATION_JSON'), { code: 'INVALID_RESPONSE' });
  const reviews: PublicationIssue[] = [];
  const warn = (path: (string | number)[], code: string) => {
    reviews.push({ path, code });
  };
  function merge(old: unknown, next: unknown, path: (string | number)[]): unknown {
    const name = path.filter((p) => typeof p === 'string').join('.');
    if (immutable.has(name)) {
      if (
        next !== undefined &&
        !equal(old, next) &&
        !(old === undefined && Array.isArray(next) && !next.length)
      )
        warn(path, 'asset_or_extension_preserved');
      return old === undefined && ['media', 'extensions', 'phone.album'].includes(name) ? [] : old;
    }
    if (next === undefined) return old;
    if (
      name === 'candidates.intent' &&
      record(old) &&
      Object.keys(old).length === 1 &&
      old.kind === 'editorial_only' &&
      record(next) &&
      ['offer_message', 'offer_invitation', 'director_event'].includes(String(next.kind))
    ) {
      warn(path, 'editorial_intent_supplemented');
      return merge(undefined, next, path);
    }
    if (Array.isArray(old) || (old === undefined && Array.isArray(next))) {
      if (!Array.isArray(next)) {
        warn(path, 'authored_value_preserved');
        return old;
      }
      const existing = Array.isArray(old) ? old : [];
      if (!existing.length) return next.map((item, i) => merge(undefined, item, [...path, i]));
      const identity = (item: unknown): string | undefined => {
        if (!record(item)) return undefined;
        if (name === 'initialKnowledge')
          return typeof item.actorKey === 'string' ? item.actorKey : undefined;
        if (name === 'routes')
          return typeof item.fromPlaceKey === 'string' && typeof item.toPlaceKey === 'string'
            ? JSON.stringify([item.fromPlaceKey, item.toPlaceKey])
            : undefined;
        return typeof item.key === 'string' ? item.key : undefined;
      };
      if (keyed.has(name) && existing.every((item) => identity(item) !== undefined)) {
        const result = existing.map((item, i) => {
          const matches = next.filter((n) => identity(n) === identity(item));
          if (matches.length > 1) {
            warn([...path, i], 'ambiguous_model_key');
            return item;
          }
          return merge(item, matches[0], [...path, i]);
        });
        for (const item of next) {
          if (identity(item) === undefined) {
            warn(path, 'invalid_model_entity');
            continue;
          }
          if (!existing.some((e) => identity(e) === identity(item))) {
            warn([...path, result.length], 'entity_supplemented');
            result.push(merge(undefined, item, [...path, result.length]));
          }
        }
        return result;
      }
      if (!equal(old, next)) warn(path, 'authored_list_preserved');
      return old;
    }
    if (record(old) || (old === undefined && record(next))) {
      if (!record(next)) {
        warn(path, 'authored_value_preserved');
        return old;
      }
      const existing = record(old) ? old : {},
        result: RecordValue = {};
      const allowed = fields[name] ?? [];
      for (const key of new Set([...Object.keys(existing), ...Object.keys(next)])) {
        if (!allowed.includes(key)) {
          const authored = Object.hasOwn(existing, key);
          if (authored) result[key] = existing[key];
          if (!equal(existing[key], next[key]))
            warn([...path, key], authored ? 'unknown_field_preserved' : 'unknown_field_omitted');
          continue;
        }
        const value = merge(existing[key], next[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (old === undefined || (typeof old === 'string' && old.trim() === '')) return next;
    if (!equal(old, next)) warn(path, 'authored_value_preserved');
    return old;
  }
  const updatedContent = merge(current, proposal, []) as RecordValue;
  if (publicationStorageIssues(updatedContent).length)
    throw Object.assign(new Error('PREPARATION_CONTENT_BUDGET'), { code: 'INVALID_RESPONSE' });
  // Return detached values; neither the model nor the caller can mutate the captured original.
  return { updatedContent: JSON.parse(JSON.stringify(updatedContent)) as RecordValue, reviews };
}
