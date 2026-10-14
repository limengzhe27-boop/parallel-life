/** Pure authoring data and reference rules. This does not publish or execute a world. */
export type PublicationJson =
  null | boolean | number | string | PublicationJson[] | { [key: string]: PublicationJson };
export type PublicationVisibility =
  { kind: 'player' } | { kind: 'world' } | { kind: 'actors'; actorKeys: string[] };
export type PublicationParticipant = { kind: 'player' } | { kind: 'actor'; actorKey: string };
export type PublicationStoryWindow = { notBefore: string; expiresAt: string };
export type PublicationNodeOutcome = 'committed' | 'declined' | 'skipped' | 'expired';
export type PublicationResolutionCondition = {
  nodeKey: string;
  outcomes: PublicationNodeOutcome[];
};
export type PublicationPrerequisite =
  | { kind: 'history_fact'; factKey: string }
  | { kind: 'after_committed_node'; nodeKey: string }
  | { kind: 'after_presented_node'; nodeKey: string }
  | ({ kind: 'after_resolved_node' } & PublicationResolutionCondition)
  | { kind: 'at_place'; placeKey: string }
  | { kind: 'not_before'; at: string };
export type PublicationConditionNode = {
  key: string;
  title: string;
  match: 'all' | 'any';
  prerequisites: PublicationPrerequisite[];
};
export type PublicationIntent =
  | { kind: 'editorial_only' }
  | { kind: 'director_event'; actorKey: string }
  | { kind: 'offer_message'; actorKey: string; text: string }
  | {
      kind: 'offer_invitation';
      actorKeys: string[];
      placeKey: string;
      title: string;
      earliestAt: string;
    };
export type PublicationContent = {
  schemaVersion: 1;
  work: {
    key: string;
    title: string;
    hook: string;
    description: string;
    experienceNote: string;
    coverMediaKey?: string;
  };
  world: {
    publicSetting: string;
    tone: string;
    startAt: string;
    startPlaceKey: string;
    hiddenContext: string;
  };
  protagonist: { identity: string; situation: string; knownFactKeys: string[] };
  actors: {
    key: string;
    name: string;
    knownAtStart: boolean;
    lifeModules?: {
      lifeContext?: string;
      traits?: string;
      drives?: string;
      behavior?: string;
      relationships?: string;
    };
    publicCard: {
      introduction?: string;
      identity?: string;
      traits: string[];
      appearance?: string;
      avatarMediaKey?: string;
    };
    privatePersona: { background: string; motivation: string; voice: string; boundaries: string };
  }[];
  relationships: {
    key: string;
    from: PublicationParticipant;
    to: PublicationParticipant;
    description: string;
    visibility: PublicationVisibility;
  }[];
  places: {
    key: string;
    name: string;
    description: string;
    knownAtStart: boolean;
    sceneMediaKey?: string;
  }[];
  routes: { fromPlaceKey: string; toPlaceKey: string; minutes: number }[];
  history: {
    key: string;
    kind: 'established_fact';
    text: string;
    occurredAt: string;
    actorKeys: string[];
    placeKey?: string;
    visibility: PublicationVisibility;
  }[];
  initialKnowledge: { actorKey: string; factKeys: string[] }[];
  phone: {
    messages: {
      key: string;
      actorKey: string;
      origin: 'history' | 'incoming';
      speaker?: 'actor' | 'player';
      text: string;
      at: string;
    }[];
    moments?: { key: string; actorKey: string; text: string; at: string }[];
    notes: { key: string; title: string; text: string; factKeys: string[] }[];
    invitations: {
      key: string;
      actorKeys: string[];
      placeKey: string;
      messageKey: string;
      title: string;
      at: string;
      status: 'proposed';
    }[];
    album: { key: string; mediaKey: string; title: string; historyFactKey: string }[];
  };
  media: {
    key: string;
    asset: { namespace: 'publication'; key: string; revision: number };
    use: 'cover' | 'avatar' | 'scene' | 'album';
    depiction: 'uploaded_image' | 'illustration' | 'generated_image';
    label: string;
    visibility: PublicationVisibility;
  }[];
  openingEventKey?: string;
  timeline?: {
    initialStageKey: string;
    stages: {
      key: string;
      title: string;
      order: number;
      afterStageKeys: string[];
      window?: PublicationStoryWindow;
    }[];
  };
  conditions?: PublicationConditionNode[];
  candidates: {
    key: string;
    kind: 'candidate';
    title: string;
    editorialIntent: string;
    direction?: { mode: 'required' | 'optional'; expectedImpact?: string; experience?: string };
    actorKeys: string[];
    placeKey?: string;
    conditionKeys?: string[];
    prerequisites: PublicationPrerequisite[];
    mutuallyExclusiveNodeKeys: string[];
    intent: PublicationIntent;
    timeline?: {
      stageKey: string;
      window?: PublicationStoryWindow;
      timeNote?: string;
      excludeIfResolved: PublicationResolutionCondition[];
      alternatives: { onDeclined: string[]; onSkipped: string[]; onExpired: string[] };
    };
  }[];
  extensions: {
    namespace: string;
    version: number;
    purpose: 'editorial' | 'runtime_required';
    description: string;
    data: PublicationJson;
  }[];
};
export type PublicationIssue = { path: (string | number)[]; code: string };
export const PUBLICATION_CONTENT_MAX_BYTES = 65536;

/** Run before recursive shape parsing. Internal JSON only, never executable extensions. */
export function publicationStorageIssues(value: unknown): PublicationIssue[] {
  const errors: PublicationIssue[] = [],
    ancestors = new Set<object>();
  let visited = 0;
  function walk(v: unknown, depth: number): boolean {
    if (++visited > 12000) {
      errors.push({ path: [], code: 'storage_values' });
      return false;
    }
    if (depth > 12) {
      errors.push({ path: [], code: 'storage_depth' });
      return false;
    }
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v !== 'object') return false;
    if (ancestors.has(v)) return false;
    const prototype = Object.getPrototypeOf(v);
    const standardPrototype = Array.isArray(v) ? Array.prototype : Object.prototype;
    if (prototype !== standardPrototype && prototype !== null) return false;
    if (
      Reflect.ownKeys(v).some(
        (k) => typeof k !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(k),
      )
    )
      return false;
    if (Array.isArray(v)) {
      const keys = Object.keys(v);
      if (
        keys.length !== v.length ||
        keys.some((k) => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length)
      )
        return false;
    }
    ancestors.add(v);
    const own = Object.getOwnPropertyDescriptors(v);
    if (
      Object.entries(own).some(
        ([key, d]) => !d.enumerable && !(Array.isArray(v) && key === 'length'),
      )
    )
      return false;
    const descriptors = Object.values(own);
    const valid =
      descriptors.every((d) => !d.get && !d.set) &&
      descriptors.filter((d) => d.enumerable).every((d) => walk(d.value, depth + 1));
    ancestors.delete(v);
    return valid;
  }
  try {
    if (!walk(value, 0) && !errors.length) errors.push({ path: [], code: 'invalid_json' });
  } catch {
    if (!errors.length) errors.push({ path: [], code: 'invalid_json' });
  }
  if (
    !errors.length &&
    new TextEncoder().encode(JSON.stringify(value)).length > PUBLICATION_CONTENT_MAX_BYTES
  )
    errors.push({ path: [], code: 'content_budget' });
  return errors;
}

export function publicationContentIssues(c: PublicationContent): PublicationIssue[] {
  const errors: PublicationIssue[] = [];
  const issue = (path: (string | number)[], code: string) => errors.push({ path, code });
  if (c.schemaVersion !== 1) issue(['schemaVersion'], 'unsupported_schema');
  function unique(keys: string[], path: (string | number)[]) {
    if (new Set(keys).size !== keys.length) issue(path, 'duplicate_key');
  }
  const actors = new Map(c.actors.map((x) => [x.key, x]));
  const places = new Map(c.places.map((x) => [x.key, x]));
  const facts = new Map(c.history.map((x) => [x.key, x]));
  const media = new Map(c.media.map((x) => [x.key, x]));
  const nodes = new Set(c.candidates.map((x) => x.key));
  for (const name of [
    'actors',
    'relationships',
    'places',
    'history',
    'media',
    'candidates',
  ] as const)
    unique(
      c[name].map((x) => x.key),
      [name],
    );
  for (const name of ['messages', 'notes', 'invitations', 'album'] as const)
    unique(
      c.phone[name].map((x) => x.key),
      ['phone', name],
    );
  unique(
    c.extensions.map((x) => x.namespace),
    ['extensions'],
  );
  unique(
    c.initialKnowledge.map((x) => x.actorKey),
    ['initialKnowledge'],
  );
  const start = Date.parse(c.world.startAt);
  const actorRefs = (refs: string[], path: (string | number)[]) => {
    unique(refs, path);
    for (const key of refs) if (!actors.has(key)) issue(path, 'unknown_actor');
  };
  const visibility = (v: PublicationVisibility, path: (string | number)[]) => {
    if (v.kind === 'actors') actorRefs(v.actorKeys, path);
  };
  const allowsPlayer = (v: PublicationVisibility) => v.kind === 'world' || v.kind === 'player';
  const allowsActor = (v: PublicationVisibility, actor: string) =>
    v.kind === 'world' || (v.kind === 'actors' && v.actorKeys.includes(actor));
  function playerFacts(keys: string[], path: (string | number)[]) {
    unique(keys, path);
    for (const key of keys) {
      const f = facts.get(key);
      if (!f) issue(path, 'unknown_fact');
      else if (!allowsPlayer(f.visibility)) issue(path, 'fact_not_player_visible');
    }
  }
  function playerMedia(
    key: string | undefined,
    use: PublicationContent['media'][number]['use'],
    path: (string | number)[],
  ) {
    if (!key) return;
    const m = media.get(key);
    if (!m) issue(path, 'unknown_media');
    else if (m.use !== use) issue(path, 'wrong_media_use');
    else if (!allowsPlayer(m.visibility)) issue(path, 'media_not_player_visible');
  }
  const startPlace = places.get(c.world.startPlaceKey);
  if (!startPlace) issue(['world', 'startPlaceKey'], 'unknown_place');
  else if (!startPlace.knownAtStart) issue(['world', 'startPlaceKey'], 'start_place_not_known');
  playerMedia(c.work.coverMediaKey, 'cover', ['work', 'coverMediaKey']);
  c.actors.forEach((a, i) =>
    playerMedia(a.publicCard.avatarMediaKey, 'avatar', [
      'actors',
      i,
      'publicCard',
      'avatarMediaKey',
    ]),
  );
  c.places.forEach((p, i) => playerMedia(p.sceneMediaKey, 'scene', ['places', i, 'sceneMediaKey']));
  c.relationships.forEach((r, i) => {
    const identity = (p: PublicationParticipant) =>
      p.kind === 'player' ? 'player' : 'actor:' + p.actorKey;
    if (r.from.kind === 'actor' && !actors.has(r.from.actorKey))
      issue(['relationships', i], 'unknown_actor');
    if (r.to.kind === 'actor' && !actors.has(r.to.actorKey))
      issue(['relationships', i], 'unknown_actor');
    if (identity(r.from) === identity(r.to)) issue(['relationships', i], 'self_relationship');
    visibility(r.visibility, ['relationships', i, 'visibility']);
  });
  unique(
    c.routes.map((r) => r.fromPlaceKey + ':' + r.toPlaceKey),
    ['routes'],
  );
  c.routes.forEach((r, i) => {
    if (!places.has(r.fromPlaceKey) || !places.has(r.toPlaceKey))
      issue(['routes', i], 'unknown_place');
    if (r.fromPlaceKey === r.toPlaceKey) issue(['routes', i], 'self_route');
  });
  c.history.forEach((h, i) => {
    if (Date.parse(h.occurredAt) > start) issue(['history', i, 'occurredAt'], 'future_in_history');
    actorRefs(h.actorKeys, ['history', i, 'actorKeys']);
    if (h.placeKey && !places.has(h.placeKey)) issue(['history', i, 'placeKey'], 'unknown_place');
    visibility(h.visibility, ['history', i, 'visibility']);
  });
  playerFacts(c.protagonist.knownFactKeys, ['protagonist', 'knownFactKeys']);
  c.initialKnowledge.forEach((k, i) => {
    if (!actors.has(k.actorKey)) issue(['initialKnowledge', i, 'actorKey'], 'unknown_actor');
    unique(k.factKeys, ['initialKnowledge', i, 'factKeys']);
    for (const key of k.factKeys) {
      const f = facts.get(key);
      if (!f) issue(['initialKnowledge', i, 'factKeys'], 'unknown_fact');
      else if (!allowsActor(f.visibility, k.actorKey))
        issue(['initialKnowledge', i, 'factKeys'], 'fact_not_actor_visible');
    }
  });
  const playerKnown = new Set(c.protagonist.knownFactKeys);
  const messages = new Map(c.phone.messages.map((m) => [m.key, m]));
  c.phone.messages.forEach((m, i) => {
    const a = actors.get(m.actorKey);
    if (!a) issue(['phone', 'messages', i, 'actorKey'], 'unknown_actor');
    else if (!a.knownAtStart)
      issue(['phone', 'messages', i, 'actorKey'], 'sender_not_player_known');
    if (Date.parse(m.at) > start) issue(['phone', 'messages', i, 'at'], 'future_opening_message');
    if (m.origin === 'history' && Date.parse(m.at) >= start)
      issue(['phone', 'messages', i, 'at'], 'history_message_not_past');
  });
  unique(
    (c.phone.moments ?? []).map((m) => m.key),
    ['phone', 'moments'],
  );
  (c.phone.moments ?? []).forEach((m, i) => {
    if (!actors.has(m.actorKey)) issue(['phone', 'moments', i, 'actorKey'], 'unknown_actor');
    else if (!actors.get(m.actorKey)?.knownAtStart)
      issue(['phone', 'moments', i, 'actorKey'], 'sender_not_player_known');
    if (Date.parse(m.at) > start) issue(['phone', 'moments', i, 'at'], 'future_in_history');
  });
  c.phone.messages.forEach((m, i) => {
    if (m.speaker === 'player' && m.origin !== 'history')
      issue(['phone', 'messages', i, 'speaker'], 'player_message_not_history');
  });
  c.phone.notes.forEach((n, i) => {
    playerFacts(n.factKeys, ['phone', 'notes', i, 'factKeys']);
    if (n.factKeys.some((key) => !playerKnown.has(key)))
      issue(['phone', 'notes', i, 'factKeys'], 'fact_not_player_known');
  });
  c.phone.invitations.forEach((a, i) => {
    actorRefs(a.actorKeys, ['phone', 'invitations', i, 'actorKeys']);
    if (a.actorKeys.some((key) => !actors.get(key)?.knownAtStart))
      issue(['phone', 'invitations', i, 'actorKeys'], 'participant_not_player_known');
    const p = places.get(a.placeKey);
    if (!p) issue(['phone', 'invitations', i, 'placeKey'], 'unknown_place');
    else if (!p.knownAtStart)
      issue(['phone', 'invitations', i, 'placeKey'], 'place_not_player_known');
    const m = messages.get(a.messageKey);
    if (!m) issue(['phone', 'invitations', i, 'messageKey'], 'unknown_message');
    else if (!a.actorKeys.includes(m.actorKey))
      issue(['phone', 'invitations', i, 'messageKey'], 'invitation_sender_mismatch');
    if (Date.parse(a.at) < start)
      issue(['phone', 'invitations', i, 'at'], 'invitation_before_start');
  });
  c.phone.album.forEach((p, i) => {
    playerMedia(p.mediaKey, 'album', ['phone', 'album', i, 'mediaKey']);
    if (!facts.has(p.historyFactKey))
      issue(['phone', 'album', i, 'historyFactKey'], 'unknown_fact');
    else if (!playerKnown.has(p.historyFactKey))
      issue(['phone', 'album', i, 'historyFactKey'], 'fact_not_player_known');
  });
  c.media.forEach((m, i) => visibility(m.visibility, ['media', i, 'visibility']));
  const conditionNodes = new Map(
    (c.conditions ?? []).map((condition) => [condition.key, condition]),
  );
  unique(
    (c.conditions ?? []).map((condition) => condition.key),
    ['conditions'],
  );
  for (const [i, condition] of (c.conditions ?? []).entries()) {
    for (const [j, p] of condition.prerequisites.entries()) {
      const path = ['conditions', i, 'prerequisites', j];
      if (p.kind === 'history_fact' && !facts.has(p.factKey)) issue(path, 'unknown_fact');
      if (
        (p.kind === 'after_committed_node' ||
          p.kind === 'after_resolved_node' ||
          p.kind === 'after_presented_node') &&
        !nodes.has(p.nodeKey)
      )
        issue(path, 'invalid_node_reference');
      if (p.kind === 'at_place' && !places.has(p.placeKey)) issue(path, 'unknown_place');
      if (p.kind === 'not_before' && Date.parse(p.at) < start)
        issue(path, 'candidate_time_before_start');
    }
  }
  // Only mandatory terms participate in contradiction/dependency checks. An OR branch is not mandatory.
  const requiredTerms = (n: PublicationContent['candidates'][number]) => [
    ...n.prerequisites,
    ...(n.conditionKeys ?? []).flatMap((key) => {
      const group = conditionNodes.get(key);
      return group && (group.match === 'all' || group.prerequisites.length === 1)
        ? group.prerequisites
        : [];
    }),
  ];
  c.candidates.forEach((n, i) => {
    unique(n.conditionKeys ?? [], ['candidates', i, 'conditionKeys']);
    for (const key of n.conditionKeys ?? []) {
      const group = conditionNodes.get(key);
      if (!group) issue(['candidates', i, 'conditionKeys'], 'unknown_condition');
      if (
        group?.prerequisites.some(
          (p) =>
            (p.kind === 'after_committed_node' ||
              p.kind === 'after_resolved_node' ||
              p.kind === 'after_presented_node') &&
            p.nodeKey === n.key,
        )
      )
        issue(['candidates', i, 'conditionKeys'], 'condition_self_dependency');
    }
    actorRefs(n.actorKeys, ['candidates', i, 'actorKeys']);
    if (n.placeKey && !places.has(n.placeKey))
      issue(['candidates', i, 'placeKey'], 'unknown_place');
    unique(n.mutuallyExclusiveNodeKeys, ['candidates', i, 'mutuallyExclusiveNodeKeys']);
    for (const key of n.mutuallyExclusiveNodeKeys)
      if (!nodes.has(key) || key === n.key)
        issue(['candidates', i, 'mutuallyExclusiveNodeKeys'], 'invalid_node_reference');
    n.prerequisites.forEach((p, j) => {
      const path = ['candidates', i, 'prerequisites', j];
      if (p.kind === 'history_fact' && !facts.has(p.factKey)) issue(path, 'unknown_fact');
      if (
        (p.kind === 'after_committed_node' ||
          p.kind === 'after_resolved_node' ||
          p.kind === 'after_presented_node') &&
        (!nodes.has(p.nodeKey) || p.nodeKey === n.key)
      )
        issue(path, 'invalid_node_reference');
      if (p.kind === 'at_place' && !places.has(p.placeKey)) issue(path, 'unknown_place');
      if (p.kind === 'not_before' && Date.parse(p.at) < start)
        issue(path, 'candidate_time_before_start');
    });
    const intent = n.intent;
    if (
      (intent.kind === 'offer_message' || intent.kind === 'director_event') &&
      (!actors.has(intent.actorKey) || !n.actorKeys.includes(intent.actorKey))
    )
      issue(['candidates', i, 'intent'], 'intent_actor_outside_node');
    if (intent.kind === 'offer_invitation') {
      actorRefs(intent.actorKeys, ['candidates', i, 'intent', 'actorKeys']);
      if (intent.actorKeys.some((key) => !n.actorKeys.includes(key)))
        issue(['candidates', i, 'intent'], 'intent_actor_outside_node');
      if (!places.has(intent.placeKey) || (n.placeKey && n.placeKey !== intent.placeKey))
        issue(['candidates', i, 'intent'], 'intent_place_outside_node');
      if (Date.parse(intent.earliestAt) < start)
        issue(['candidates', i, 'intent'], 'candidate_time_before_start');
    }
  });
  const dependencies = new Map(
    c.candidates.map((n) => [
      n.key,
      requiredTerms(n).flatMap((p) =>
        p.kind === 'after_committed_node' || p.kind === 'after_presented_node' ? [p.nodeKey] : [],
      ),
    ]),
  );
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function cycle(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((dependencies.get(key) ?? []).some(cycle)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  }
  if (c.candidates.some((n) => cycle(n.key))) issue(['candidates'], 'candidate_dependency_cycle');
  // Timeline is editorial structure. No author-selected phase or outcome becomes runtime state.
  const stages = new Map((c.timeline?.stages ?? []).map((stage) => [stage.key, stage]));
  if (c.timeline) {
    unique(
      c.timeline.stages.map((stage) => stage.key),
      ['timeline', 'stages'],
    );
    const initial = stages.get(c.timeline.initialStageKey);
    if (!initial) issue(['timeline', 'initialStageKey'], 'unknown_stage');
    else if (
      initial.window &&
      (start < Date.parse(initial.window.notBefore) ||
        start >= Date.parse(initial.window.expiresAt))
    )
      issue(['timeline', 'initialStageKey'], 'start_outside_stage_window');
  }
  function windowValid(w: PublicationStoryWindow | undefined, path: (string | number)[]) {
    if (w && Date.parse(w.notBefore) >= Date.parse(w.expiresAt))
      issue(path, 'invalid_story_window');
  }
  for (const [i, stage] of (c.timeline?.stages ?? []).entries()) {
    const path = ['timeline', 'stages', i];
    windowValid(stage.window, [...path, 'window']);
    unique(stage.afterStageKeys, [...path, 'afterStageKeys']);
    for (const key of stage.afterStageKeys) {
      const prior = stages.get(key);
      if (!prior) issue([...path, 'afterStageKeys'], 'unknown_stage');
      else if (prior.key === stage.key || prior.order >= stage.order)
        issue([...path, 'afterStageKeys'], 'reverse_stage_dependency');
      if (
        stage.window &&
        prior?.window &&
        Date.parse(stage.window.expiresAt) <= Date.parse(prior.window.notBefore)
      )
        issue([...path, 'window'], 'stage_window_before_dependency');
    }
  }
  function hasCycle(graph: Map<string, string[]>) {
    const visiting = new Set<string>(),
      visited = new Set<string>();
    function visit(key: string): boolean {
      if (visiting.has(key)) return true;
      if (visited.has(key)) return false;
      visiting.add(key);
      if ((graph.get(key) ?? []).some(visit)) return true;
      visiting.delete(key);
      visited.add(key);
      return false;
    }
    return [...graph.keys()].some(visit);
  }
  if (
    hasCycle(new Map((c.timeline?.stages ?? []).map((stage) => [stage.key, stage.afterStageKeys])))
  )
    issue(['timeline', 'stages'], 'stage_dependency_cycle');
  if (c.openingEventKey !== undefined) {
    const matches = c.candidates.filter((node) => node.key === c.openingEventKey);
    if (matches.length !== 1) issue(['openingEventKey'], 'opening_event_reference_invalid');
    else if (matches[0]!.intent.kind !== 'director_event')
      issue(['openingEventKey'], 'opening_event_must_be_director');
    if (matches.length === 1 && matches[0]!.intent.kind === 'director_event') {
      const opening = matches[0]!,
        index = c.candidates.findIndex((node) => node === opening);
      const timestamp = (value: string | undefined) => {
        const at = Date.parse(value ?? '');
        return Number.isFinite(at) ? at : Infinity;
      };
      const deadline = (node: PublicationContent['candidates'][number]) =>
        Math.min(
          timestamp(node.timeline?.window?.expiresAt),
          timestamp(stages.get(node.timeline?.stageKey ?? '')?.window?.expiresAt),
        );
      const openingDeadline = deadline(opening);
      // Before the opening, other events cannot be presented. Clock expiration (including
      // its saved exclusion chains) can still produce a terminal outcome without a scene.
      const terminalByClock = (
        key: string,
        outcome: PublicationNodeOutcome,
        visiting = new Set<string>(),
      ): boolean => {
        if (key === opening.key) return false;
        const marker = key + ':' + outcome;
        if (visiting.has(marker)) return false;
        const prior = c.candidates.find((node) => node.key === key);
        if (!prior) return false;
        if (outcome === 'expired')
          return Number.isFinite(deadline(prior)) && deadline(prior) < openingDeadline;
        if (outcome !== 'skipped') return false;
        const next = new Set(visiting);
        next.add(marker);
        return (prior.timeline?.excludeIfResolved ?? []).some((rule) =>
          rule.outcomes.some((result) => terminalByClock(rule.nodeKey, result, next)),
        );
      };
      const reachable = (term: PublicationPrerequisite): boolean =>
        term.kind === 'history_fact' ||
        term.kind === 'at_place' ||
        term.kind === 'not_before' ||
        (term.kind === 'after_resolved_node' &&
          term.outcomes.some((outcome) => terminalByClock(term.nodeKey, outcome)));
      opening.prerequisites.forEach((term, j) => {
        if (!reachable(term))
          issue(['candidates', index, 'prerequisites', j], 'opening_event_requires_prior_event');
      });
      (opening.conditionKeys ?? []).forEach((key, j) => {
        const groups = (c.conditions ?? []).filter((group) => group.key === key);
        const group = groups.length === 1 ? groups[0] : undefined;
        if (
          group?.prerequisites.length &&
          !(group.match === 'any'
            ? group.prerequisites.some(reachable)
            : group.prerequisites.every(reachable))
        )
          issue(['candidates', index, 'conditionKeys', j], 'opening_event_requires_prior_event');
      });
      const stage = stages.get(opening.timeline?.stageKey ?? '');
      if (
        stage?.afterStageKeys.some((key) => {
          const prior = stages.get(key);
          return (
            prior &&
            (!prior.window ||
              !Number.isFinite(Date.parse(prior.window.expiresAt)) ||
              Date.parse(prior.window.expiresAt) >= openingDeadline)
          );
        })
      )
        issue(['candidates', index, 'timeline', 'stageKey'], 'opening_event_requires_prior_stage');
      // Multiple inbound alternatives are OR; keep a branch which can open by a real deadline.
      const inbound = c.candidates.flatMap((prior) =>
        Object.entries(prior.timeline?.alternatives ?? {}).flatMap(([kind, keys]) =>
          keys.includes(opening.key)
            ? [
                {
                  key: prior.key,
                  outcome: (
                    { onDeclined: 'declined', onSkipped: 'skipped', onExpired: 'expired' } as const
                  )[kind as 'onDeclined'],
                },
              ]
            : [],
        ),
      );
      if (inbound.length && !inbound.some((rule) => terminalByClock(rule.key, rule.outcome)))
        issue(['candidates', index, 'timeline'], 'opening_event_requires_prior_event');
    }
  }
  const nodeMap = new Map(c.candidates.map((node) => [node.key, node]));
  const progress = new Map(c.candidates.map((node) => [node.key, [] as string[]]));
  const nodeWindow = (node: PublicationContent['candidates'][number]) =>
    node.timeline?.window ?? stages.get(node.timeline?.stageKey ?? '')?.window;
  for (const [i, node] of c.candidates.entries()) {
    const t = node.timeline,
      path = ['candidates', i, 'timeline'];
    if (c.timeline && !t) issue(path, 'candidate_stage_missing');
    if (t && !c.timeline) issue(path, 'timeline_missing');
    if (!t && requiredTerms(node).some((p) => p.kind === 'after_resolved_node'))
      issue(path, 'timeline_missing');
    const stage = t && stages.get(t.stageKey);
    if (t && !stage) issue([...path, 'stageKey'], 'unknown_stage');
    windowValid(t?.window, [...path, 'window']);
    if (
      t?.window &&
      stage?.window &&
      (Date.parse(t.window.notBefore) < Date.parse(stage.window.notBefore) ||
        Date.parse(t.window.expiresAt) > Date.parse(stage.window.expiresAt))
    )
      issue([...path, 'window'], 'node_window_outside_stage');
    const w = nodeWindow(node);
    if (w && Date.parse(w.expiresAt) <= start)
      issue([...path, 'window'], 'candidate_expired_at_start');
    requiredTerms(node).forEach((condition, j) => {
      if (
        condition.kind === 'not_before' &&
        w &&
        Date.parse(condition.at) >= Date.parse(w.expiresAt)
      )
        issue(['candidates', i, 'prerequisites', j], 'not_before_at_or_after_deadline');
    });
    function nodeRef(key: string, position: (string | number)[]) {
      if (!nodeMap.has(key) || key === node.key) issue(position, 'invalid_node_reference');
      return nodeMap.get(key);
    }
    for (const p of requiredTerms(node)) {
      if (
        p.kind !== 'after_committed_node' &&
        p.kind !== 'after_resolved_node' &&
        p.kind !== 'after_presented_node'
      )
        continue;
      const prior = nodeRef(p.nodeKey, ['candidates', i, 'prerequisites']);
      if (prior) progress.get(prior.key)!.push(node.key);
      const priorStage = stages.get(prior?.timeline?.stageKey ?? '');
      if (stage && priorStage && priorStage.order > stage.order)
        issue(['candidates', i, 'prerequisites'], 'reverse_node_stage_dependency');
      const priorWindow = prior && nodeWindow(prior);
      if (w && priorWindow && Date.parse(w.expiresAt) <= Date.parse(priorWindow.notBefore))
        issue(['candidates', i, 'prerequisites'], 'node_window_before_dependency');
      if (p.kind === 'after_presented_node') continue;
      const outcomes = p.kind === 'after_committed_node' ? ['committed'] : p.outcomes;
      if (p.kind === 'after_resolved_node') unique(p.outcomes, ['candidates', i, 'prerequisites']);
      const exclusion =
        t?.excludeIfResolved.filter((e) => e.nodeKey === p.nodeKey).flatMap((e) => e.outcomes) ??
        [];
      if (
        outcomes.every((outcome) => exclusion.includes(outcome as PublicationNodeOutcome)) ||
        (p.kind === 'after_committed_node' && node.mutuallyExclusiveNodeKeys.includes(p.nodeKey))
      )
        issue(['candidates', i], 'contradictory_node_condition');
    }
    if (t) {
      unique(
        t.excludeIfResolved.map((e) => e.nodeKey),
        [...path, 'excludeIfResolved'],
      );
      for (const exclusion of t.excludeIfResolved) {
        nodeRef(exclusion.nodeKey, [...path, 'excludeIfResolved']);
        unique(exclusion.outcomes, [...path, 'excludeIfResolved']);
      }
      for (const [kind, keys] of Object.entries(t.alternatives)) {
        unique(keys, [...path, 'alternatives', kind]);
        for (const key of keys) {
          const next = nodeRef(key, [...path, 'alternatives', kind]);
          const nextStage = stages.get(next?.timeline?.stageKey ?? '');
          if (stage && nextStage && nextStage.order < stage.order)
            issue([...path, 'alternatives', kind], 'reverse_alternative_stage');
          const nextWindow = next && nodeWindow(next);
          if (
            w &&
            nextWindow &&
            Date.parse(nextWindow.expiresAt) <=
              Date.parse(kind === 'onExpired' ? w.expiresAt : w.notBefore)
          )
            issue([...path, 'alternatives', kind], 'alternative_window_before_trigger');
          if (next) progress.get(node.key)!.push(next.key);
        }
      }
    }
  }
  if (hasCycle(progress)) issue(['candidates'], 'candidate_progression_cycle');
  const extensionBytes = c.extensions.reduce(
    (sum, x) => sum + new TextEncoder().encode(JSON.stringify(x.data)).length,
    0,
  );
  if (extensionBytes > 16384) issue(['extensions'], 'extensions_budget');
  c.extensions.forEach((e, i) => {
    if (new TextEncoder().encode(JSON.stringify(e.data)).length > 8192)
      issue(['extensions', i, 'data'], 'extension_budget');
  });
  return errors;
}

/** Call only on shape-validated content. Default capabilities deliberately support no new runtime adapter. */
export function publicationSupport(
  c: PublicationContent,
  supported: ReadonlySet<string> = new Set(),
) {
  const required = new Set(['publication.opening.v1']);
  if (c.timeline) required.add('publication.timeline.v1');
  if (c.media.length) required.add('publication.media.v1');
  for (const node of c.candidates)
    if (node.intent.kind !== 'editorial_only')
      required.add('candidate.' + node.intent.kind + '.v1');
  const missing = [...required].filter((key) => !supported.has(key));
  const unsupportedExtensions = c.extensions
    .filter((e) => e.purpose === 'runtime_required')
    .map((e) => e.namespace);
  return {
    requiredCapabilities: [...required],
    missingCapabilities: missing,
    storedOnlyExtensions: c.extensions.map((e) => ({ namespace: e.namespace, version: e.version })),
    unsupportedRuntimeExtensions: unsupportedExtensions,
    runtimeReady:
      publicationStorageIssues(c).length === 0 &&
      publicationContentIssues(c).length === 0 &&
      missing.length === 0 &&
      unsupportedExtensions.length === 0,
    // Capability checks never replace identity, media permission, trial or publication checks.
    grantsPublicationAuthority: false as const,
  };
}

/** Whitelisted author-approved preview, not a live player save or proof that events occurred. */
export function publicationPlayerPreview(c: PublicationContent) {
  const errors = publicationContentIssues(c);
  if (errors.length) throw Error('INVALID_PUBLICATION_REFERENCES');
  const actorKeys = new Set(c.actors.filter((a) => a.knownAtStart).map((a) => a.key));
  const placeKeys = new Set(c.places.filter((p) => p.knownAtStart).map((p) => p.key));
  const knownFacts = new Set(c.protagonist.knownFactKeys);
  const media = new Map(c.media.map((m) => [m.key, m]));
  const picture = (key: string | undefined) => {
    const m = key && media.get(key);
    return m
      ? {
          mediaKey: m.key,
          asset: { namespace: m.asset.namespace, key: m.asset.key, revision: m.asset.revision },
          depiction: m.depiction,
          label: m.label,
        }
      : undefined;
  };
  const participantKnown = (p: PublicationParticipant) =>
    p.kind === 'player' || actorKeys.has(p.actorKey);
  return {
    schemaVersion: 1 as const,
    kind: 'authoring_preview' as const,
    work: {
      key: c.work.key,
      title: c.work.title,
      hook: c.work.hook,
      description: c.work.description,
      experienceNote: c.work.experienceNote,
      ...(c.work.coverMediaKey ? { cover: picture(c.work.coverMediaKey) } : {}),
    },
    world: {
      setting: c.world.publicSetting,
      startAt: c.world.startAt,
      startPlaceKey: c.world.startPlaceKey,
    },
    protagonist: { identity: c.protagonist.identity, situation: c.protagonist.situation },
    actors: c.actors
      .filter((a) => actorKeys.has(a.key))
      .map((a) => ({
        key: a.key,
        name: a.name,
        publicCard: {
          ...(a.publicCard.introduction ? { introduction: a.publicCard.introduction } : {}),
          ...(a.publicCard.identity ? { identity: a.publicCard.identity } : {}),
          traits: [...a.publicCard.traits],
          ...(a.publicCard.appearance ? { appearance: a.publicCard.appearance } : {}),
          ...(a.publicCard.avatarMediaKey ? { avatar: picture(a.publicCard.avatarMediaKey) } : {}),
        },
      })),
    relationships: c.relationships
      .filter(
        (r) => r.visibility.kind !== 'actors' && participantKnown(r.from) && participantKnown(r.to),
      )
      .map((r) => ({
        key: r.key,
        from:
          r.from.kind === 'player'
            ? { kind: 'player' as const }
            : { kind: 'actor' as const, actorKey: r.from.actorKey },
        to:
          r.to.kind === 'player'
            ? { kind: 'player' as const }
            : { kind: 'actor' as const, actorKey: r.to.actorKey },
        description: r.description,
      })),
    places: c.places
      .filter((p) => placeKeys.has(p.key))
      .map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        ...(p.sceneMediaKey ? { image: picture(p.sceneMediaKey) } : {}),
      })),
    routes: c.routes
      .filter((r) => placeKeys.has(r.fromPlaceKey) && placeKeys.has(r.toPlaceKey))
      .map((r) => ({ fromPlaceKey: r.fromPlaceKey, toPlaceKey: r.toPlaceKey, minutes: r.minutes })),
    history: c.history
      .filter((h) => knownFacts.has(h.key) && h.visibility.kind !== 'actors')
      .map((h) => ({ key: h.key, text: h.text, occurredAt: h.occurredAt })),
    phone: {
      ...(c.phone.moments
        ? {
            moments: c.phone.moments
              .filter((m) => actorKeys.has(m.actorKey))
              .map((m) => ({ ...m })),
          }
        : {}),
      messages: c.phone.messages.map((m) => ({
        key: m.key,
        actorKey: m.actorKey,
        origin: m.origin,
        ...(m.speaker ? { speaker: m.speaker } : {}),
        text: m.text,
        at: m.at,
      })),
      notes: c.phone.notes.map((n) => ({ key: n.key, title: n.title, text: n.text })),
      invitations: c.phone.invitations.map((a) => ({
        key: a.key,
        actorKeys: [...a.actorKeys],
        placeKey: a.placeKey,
        messageKey: a.messageKey,
        title: a.title,
        at: a.at,
        status: a.status,
      })),
      album: c.phone.album.map((p) => ({ key: p.key, title: p.title, image: picture(p.mediaKey) })),
    },
  };
}

/** Story-time window only; it does not grant phase eligibility, satisfy prerequisites or record an event. */
export function publicationStoryWindowState(
  window: PublicationStoryWindow,
  storyAt: string,
): 'not_open' | 'open' | 'expired' {
  function instant(value: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z$/.exec(value);
    if (!match) throw Error('INVALID_STORY_WINDOW');
    const result = Date.parse(value),
      date = new Date(result);
    if (
      !Number.isFinite(result) ||
      date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() + 1 !== Number(match[2]) ||
      date.getUTCDate() !== Number(match[3]) ||
      date.getUTCHours() !== Number(match[4]) ||
      date.getUTCMinutes() !== Number(match[5]) ||
      date.getUTCSeconds() !== Number(match[6] ?? 0)
    )
      throw Error('INVALID_STORY_WINDOW');
    return result;
  }
  const now = instant(storyAt),
    open = instant(window.notBefore),
    end = instant(window.expiresAt);
  if (![now, open, end].every(Number.isFinite) || open >= end) throw Error('INVALID_STORY_WINDOW');
  return now < open ? 'not_open' : now >= end ? 'expired' : 'open';
}
