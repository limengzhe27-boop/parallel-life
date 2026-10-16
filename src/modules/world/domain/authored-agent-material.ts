/** Director-only author intent. Participation references never grant an NPC knowledge. */
export type AuthoredMaterialOrigin = {
  workId: string;
  publicationVersion: number;
  draftVersion: number;
  contentHash: string;
};
export type AuthoredMaterialScope = { worldId: string; engineEpoch: number; worldVersion: number };
export type AuthoredMaterialPrerequisite =
  | { kind: 'history_fact'; factKey: string }
  | { kind: 'after_committed_node' | 'after_presented_node'; nodeKey: string }
  | {
      kind: 'after_resolved_node';
      nodeKey: string;
      outcomes: ('committed' | 'declined' | 'skipped' | 'expired')[];
    }
  | { kind: 'at_place'; placeKey: string }
  | { kind: 'not_before'; at: string };
export type AuthoredMaterialCondition = {
  key: string;
  title: string;
  match: 'all' | 'any';
  prerequisites: AuthoredMaterialPrerequisite[];
};
type Resolution = {
  nodeKey: string;
  outcomes: ('committed' | 'declined' | 'skipped' | 'expired')[];
};
type Window = { notBefore: string; expiresAt: string };
export type AuthoredMaterialNode = {
  key: string;
  kind: 'candidate';
  title: string;
  editorialIntent: string;
  script?: string;
  sceneText?: string;
  scenePlaceKeys?: string[];
  direction?: {
    mode: 'required' | 'optional';
    expectedImpact?: string;
    experience?: string;
    progress?: {
      pace?: 'brief' | 'standard' | 'extended';
      refusal?: 'defer' | 'withdraw';
      completion?: {
        scope?: 'invitation_response';
        mode: 'all' | 'any';
        criteria: (
          | { key: string; kind: 'invitation_response'; response: 'accepted' | 'declined' }
          | { key: string; kind: 'npc_exact_message'; actorKey: string; phrase: string }
        )[];
      };
    };
  };
  actorKeys: string[];
  settingPlaceKey?: string;
  placeKey?: string;
  prerequisites: AuthoredMaterialPrerequisite[];
  conditionKeys?: string[];
  mutuallyExclusiveNodeKeys: string[];
  intent:
    | { kind: 'editorial_only' }
    | { kind: 'director_event'; actorKey?: string }
    | { kind: 'offer_message'; actorKey: string; text: string }
    | {
        kind: 'offer_invitation';
        actorKeys: string[];
        placeKey: string;
        title: string;
        earliestAt: string;
      };
  timeline?: {
    stageKey: string;
    window?: Window;
    timeNote?: string;
    excludeIfResolved: Resolution[];
    alternatives: { onDeclined: string[]; onSkipped: string[]; onExpired: string[] };
  };
};
export type AuthoredMaterialTimeline = {
  initialStageKey: string;
  stages: {
    key: string;
    title: string;
    order: number;
    afterStageKeys: string[];
    window?: Window;
  }[];
};
/** Narrow, pure source protocol; no dependency on another module's infrastructure or private root fields. */
export type AuthoredMaterialSourceDocument = {
  origin: AuthoredMaterialOrigin;
  openingEventKey?: string;
  nodes: AuthoredMaterialNode[];
  timeline: AuthoredMaterialTimeline | null;
  conditions?: AuthoredMaterialCondition[];
  actorKeys: string[];
  contacts: { actorKey: string; actorId: string }[];
  initialActorIds: string[];
  initialPlaceKeys: string[];
  places: { key: string; name: string; description?: string }[];
  routes?: { fromPlaceKey: string; toPlaceKey: string; minutes: number }[];
  history: { key: string }[];
};
export type AuthoredMaterialSourceRef = {
  worldId: string;
  sourceScope: 'bound_publication_story_source';
  origin: AuthoredMaterialOrigin;
  sourceHash: string;
};
export type AuthoredMaterialRef = {
  source: AuthoredMaterialSourceRef;
  nodeKey: string;
  nodeHash: string;
};
export type AuthoredMaterialIssue = {
  kind: 'actor' | 'place' | 'node' | 'condition' | 'history' | 'stage';
  key: string;
  path: string;
  reason: 'unknown_key' | 'ambiguous' | 'not_in_world' | 'not_in_initial_namespace';
};
export type AuthoredMaterialActorRef = {
  actorKey: string;
  actorId: string | null;
  status: 'resolved' | 'unknown_key' | 'ambiguous' | 'not_in_world' | 'not_in_initial_namespace';
};
export type AuthoredMaterialPlaceRef = {
  placeKey: string;
  placeId: string | null;
  status: 'resolved' | 'unknown_key' | 'ambiguous';
  availableInWorld: boolean;
};
export type AuthoredAgentMaterial = {
  scope: 'director_only';
  ref: AuthoredMaterialRef;
  role: 'opening' | 'event';
  node: AuthoredMaterialNode;
  participantRefs: AuthoredMaterialActorRef[];
  placeRefs: AuthoredMaterialPlaceRef[];
  unresolvedRefs: AuthoredMaterialIssue[];
};
export type AuthoredAgentMaterialCatalog = {
  scope: 'director_only';
  world: AuthoredMaterialScope;
  source: AuthoredMaterialSourceRef | null;
  openingEventKey: string | null;
  timeline: AuthoredMaterialTimeline | null;
  conditions: AuthoredMaterialCondition[];
  materials: AuthoredAgentMaterial[];
  unresolvedRefs: AuthoredMaterialIssue[];
};
export class AuthoredMaterialError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
const fail = (): never => {
  throw new AuthoredMaterialError('INVALID_AUTHORED_MATERIAL');
};
/** Canonical JSON for content fingerprints, not a model prompt or secret-bearing log. */
export function authoredMaterialCanonicalJson(value: unknown): string {
  const visit = (v: unknown, seen: Set<object>): string => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : fail();
    if (typeof v !== 'object' || seen.has(v)) return fail();
    seen.add(v);
    let result: string;
    if (Array.isArray(v)) result = '[' + v.map((x) => visit(x, seen)).join(',') + ']';
    else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
        return fail();
      result =
        '{' +
        Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + visit((v as Record<string, unknown>)[k], seen))
          .join(',') +
        '}';
    }
    seen.delete(v);
    return result;
  };
  return visit(value, new Set());
}
type Shape = true | { [key: string]: Shape } | [Shape];
const prereq: Shape = {
  kind: true,
  factKey: true,
  nodeKey: true,
  outcomes: [true],
  placeKey: true,
  at: true,
};
const windowShape: Shape = { notBefore: true, expiresAt: true };
const resolution: Shape = { nodeKey: true, outcomes: [true] };
const conditionShape: Shape = { key: true, title: true, match: true, prerequisites: [prereq] };
const nodeShape: Shape = {
  key: true,
  kind: true,
  title: true,
  editorialIntent: true,
  script: true,
  sceneText: true,
  scenePlaceKeys: [true],
  actorKeys: [true],
  settingPlaceKey: true,
  placeKey: true,
  prerequisites: [prereq],
  conditionKeys: [true],
  mutuallyExclusiveNodeKeys: [true],
  intent: {
    kind: true,
    actorKey: true,
    actorKeys: [true],
    placeKey: true,
    title: true,
    text: true,
    earliestAt: true,
  },
  direction: {
    mode: true,
    expectedImpact: true,
    experience: true,
    progress: {
      pace: true,
      refusal: true,
      completion: {
        scope: true,
        mode: true,
        criteria: [{ key: true, kind: true, response: true, actorKey: true, phrase: true }],
      },
    },
  },
  timeline: {
    stageKey: true,
    window: windowShape,
    timeNote: true,
    excludeIfResolved: [resolution],
    alternatives: { onDeclined: [true], onSkipped: [true], onExpired: [true] },
  },
};
/** Explicit supported-field projection at every level. Extra source/character private fields cannot escape. */
function project(value: unknown, shape: Shape): unknown {
  if (shape === true) {
    if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
    return fail();
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return fail();
    return value.map((v) => project(v, shape[0]));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(shape)) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = project(v, child);
  }
  return out;
}
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export function compileAuthoredAgentMaterials(
  input: {
    scope: AuthoredMaterialScope;
    source: AuthoredMaterialSourceDocument | null;
    actualActorIds: readonly string[];
    actualPlaceIds: readonly string[];
  },
  digest: (canonicalJson: string) => string,
): AuthoredAgentMaterialCatalog {
  const scope = {
    worldId: input.scope.worldId,
    engineEpoch: input.scope.engineEpoch,
    worldVersion: input.scope.worldVersion,
  };
  if (
    !text(scope.worldId) ||
    !Number.isSafeInteger(scope.engineEpoch) ||
    scope.engineEpoch < 2 ||
    !Number.isSafeInteger(scope.worldVersion) ||
    scope.worldVersion < 0 ||
    !strings([...input.actualActorIds]) ||
    !strings([...input.actualPlaceIds])
  )
    fail();
  if (!input.source)
    return {
      scope: 'director_only',
      world: scope,
      source: null,
      openingEventKey: null,
      timeline: null,
      conditions: [],
      materials: [],
      unresolvedRefs: [],
    };
  const raw = input.source;
  const source = project(raw, {
    origin: { workId: true, publicationVersion: true, draftVersion: true, contentHash: true },
    openingEventKey: true,
    nodes: [nodeShape],
    conditions: [conditionShape],
    actorKeys: [true],
    contacts: [{ actorKey: true, actorId: true }],
    initialActorIds: [true],
    initialPlaceKeys: [true],
    places: [{ key: true, name: true, description: true }],
    routes: [{ fromPlaceKey: true, toPlaceKey: true, minutes: true }],
    history: [{ key: true }],
  }) as Omit<AuthoredMaterialSourceDocument, 'timeline'> & {
    timeline: AuthoredMaterialTimeline | null;
  };
  source.timeline =
    raw.timeline === null
      ? null
      : (project(raw.timeline, {
          initialStageKey: true,
          stages: [
            { key: true, title: true, order: true, afterStageKeys: [true], window: windowShape },
          ],
        }) as AuthoredMaterialTimeline);
  if (
    !source.origin ||
    !text(source.origin.workId) ||
    !Number.isSafeInteger(source.origin.publicationVersion) ||
    source.origin.publicationVersion < 0 ||
    !Number.isSafeInteger(source.origin.draftVersion) ||
    source.origin.draftVersion < 0 ||
    !/^[a-f0-9]{64}$/.test(source.origin.contentHash) ||
    !strings(source.actorKeys) ||
    !strings(source.initialActorIds) ||
    !strings(source.initialPlaceKeys) ||
    !Array.isArray(source.nodes) ||
    !Array.isArray(source.contacts) ||
    !Array.isArray(source.places) ||
    !Array.isArray(source.history)
  )
    fail();
  for (const n of source.nodes)
    if (
      !text(n.key) ||
      n.kind !== 'candidate' ||
      !text(n.title) ||
      !text(n.editorialIntent) ||
      !strings(n.actorKeys) ||
      !Array.isArray(n.prerequisites) ||
      !strings(n.mutuallyExclusiveNodeKeys) ||
      !n.intent ||
      !['editorial_only', 'director_event', 'offer_message', 'offer_invitation'].includes(
        n.intent.kind,
      )
    )
      fail();
  for (const n of source.nodes) {
    if (
      (n.script !== undefined && typeof n.script !== 'string') ||
      (n.sceneText !== undefined && typeof n.sceneText !== 'string') ||
      (n.scenePlaceKeys !== undefined && !strings(n.scenePlaceKeys)) ||
      (n.conditionKeys !== undefined && !strings(n.conditionKeys)) ||
      (n.placeKey !== undefined && !text(n.placeKey)) ||
      (n.settingPlaceKey !== undefined && !text(n.settingPlaceKey))
    )
      fail();
    if ('actorKey' in n.intent && n.intent.actorKey !== undefined && !text(n.intent.actorKey))
      fail();
    if (n.intent.kind === 'offer_message' && (!text(n.intent.actorKey) || !text(n.intent.text)))
      fail();
    if (
      n.intent.kind === 'offer_invitation' &&
      (!strings(n.intent.actorKeys) ||
        !text(n.intent.placeKey) ||
        !text(n.intent.title) ||
        !Number.isFinite(Date.parse(n.intent.earliestAt)))
    )
      fail();
    if (n.direction && !['required', 'optional'].includes(n.direction.mode)) fail();
  }
  if (
    source.timeline &&
    (!text(source.timeline.initialStageKey) ||
      !Array.isArray(source.timeline.stages) ||
      source.timeline.stages.some(
        (s) =>
          !text(s.key) || !text(s.title) || !Number.isFinite(s.order) || !strings(s.afterStageKeys),
      ))
  )
    fail();
  for (const c of source.conditions ?? [])
    if (
      !text(c.key) ||
      !text(c.title) ||
      !['all', 'any'].includes(c.match) ||
      !Array.isArray(c.prerequisites)
    )
      fail();
  for (const c of source.contacts) if (!text(c.actorKey) || !text(c.actorId)) fail();
  for (const p of source.places) if (!text(p.key) || !text(p.name)) fail();
  const hash = (v: unknown) => {
    const h = digest(authoredMaterialCanonicalJson(v));
    if (!/^[a-f0-9]{64}$/.test(h)) return fail();
    return h;
  };
  const ref: AuthoredMaterialSourceRef = {
    worldId: scope.worldId,
    sourceScope: 'bound_publication_story_source',
    origin: source.origin,
    sourceHash: hash(source),
  };
  const issues: AuthoredMaterialIssue[] = [];
  const issue = (
    out: AuthoredMaterialIssue[],
    kind: AuthoredMaterialIssue['kind'],
    key: string,
    path: string,
    reason: AuthoredMaterialIssue['reason'],
  ) => out.push({ kind, key, path, reason });
  const count = (values: readonly string[], key: string) => values.filter((x) => x === key).length;
  const known = (
    out: AuthoredMaterialIssue[],
    kind: AuthoredMaterialIssue['kind'],
    key: string,
    path: string,
    values: string[],
  ) => {
    const n = count(values, key);
    if (n !== 1) issue(out, kind, key, path, n ? 'ambiguous' : 'unknown_key');
  };
  const nodeKeys = source.nodes.map((n) => n.key),
    conditionKeys = (source.conditions ?? []).map((c) => c.key),
    historyKeys = source.history.map((h) => h.key),
    stageKeys = source.timeline?.stages.map((s) => s.key) ?? [];
  const checkPrereq = (
    p: AuthoredMaterialPrerequisite,
    path: string,
    out: AuthoredMaterialIssue[],
  ) => {
    if (!p || !text(p.kind)) return fail();
    if (p.kind === 'history_fact') known(out, 'history', p.factKey, path, historyKeys);
    else if (
      ['after_committed_node', 'after_presented_node', 'after_resolved_node'].includes(p.kind)
    )
      known(out, 'node', (p as { nodeKey: string }).nodeKey, path, nodeKeys);
    else if (p.kind === 'at_place')
      known(
        out,
        'place',
        p.placeKey,
        path,
        source.places.map((p) => p.key),
      );
    else if (p.kind !== 'not_before') return fail();
  };
  const materials = source.nodes.map((node, index): AuthoredAgentMaterial => {
    const out: AuthoredMaterialIssue[] = [];
    const base = `nodes[${index}]`;
    known(out, 'node', node.key, base + '.key', nodeKeys);
    const actors = new Set([
      ...node.actorKeys,
      ...('actorKey' in node.intent && node.intent.actorKey ? [node.intent.actorKey] : []),
      ...('actorKeys' in node.intent ? node.intent.actorKeys : []),
      ...(node.direction?.progress?.completion?.criteria.flatMap((c) =>
        c.kind === 'npc_exact_message' ? [c.actorKey] : [],
      ) ?? []),
    ]);
    const participantRefs = [...actors].map((actorKey): AuthoredMaterialActorRef => {
      const matches = source.contacts.filter((c) => c.actorKey === actorKey);
      let status: AuthoredMaterialActorRef['status'] = 'resolved';
      let actorId: string | null = matches.length === 1 ? matches[0]!.actorId : null;
      if (count(source.actorKeys, actorKey) !== 1 || matches.length !== 1)
        status =
          count(source.actorKeys, actorKey) > 1 || matches.length > 1 ? 'ambiguous' : 'unknown_key';
      else if (source.contacts.filter((c) => c.actorId === actorId).length !== 1) {
        status = 'ambiguous';
        actorId = null;
      } else if (!source.initialActorIds.includes(actorId!)) status = 'not_in_initial_namespace';
      else if (!input.actualActorIds.includes(actorId!)) status = 'not_in_world';
      if (status !== 'resolved') issue(out, 'actor', actorKey, base + '.actorRefs', status);
      return { actorKey, actorId, status };
    });
    const placeKeys = new Set([
      ...(node.placeKey ? [node.placeKey] : []),
      ...(node.settingPlaceKey ? [node.settingPlaceKey] : []),
      ...(node.scenePlaceKeys ?? []),
      ...('placeKey' in node.intent ? [node.intent.placeKey] : []),
      ...node.prerequisites.flatMap((p) => (p.kind === 'at_place' ? [p.placeKey] : [])),
      ...(source.conditions ?? [])
        .filter((condition) => node.conditionKeys?.includes(condition.key))
        .flatMap((condition) =>
          condition.prerequisites.flatMap((p) => (p.kind === 'at_place' ? [p.placeKey] : [])),
        ),
    ]);
    const placeRefs = [...placeKeys].map((placeKey): AuthoredMaterialPlaceRef => {
      const n = count(
        source.places.map((p) => p.key),
        placeKey,
      );
      const status = n === 1 ? 'resolved' : n ? 'ambiguous' : 'unknown_key';
      if (status !== 'resolved') issue(out, 'place', placeKey, base + '.placeRefs', status);
      return {
        placeKey,
        placeId: n === 1 ? placeKey : null,
        status,
        availableInWorld: n === 1 && input.actualPlaceIds.includes(placeKey),
      };
    });
    node.prerequisites.forEach((p, i) => checkPrereq(p, `${base}.prerequisites[${i}]`, out));
    for (const key of node.conditionKeys ?? [])
      known(out, 'condition', key, base + '.conditionKeys', conditionKeys);
    for (const condition of (source.conditions ?? []).filter((c) =>
      node.conditionKeys?.includes(c.key),
    ))
      condition.prerequisites.forEach((p, i) =>
        checkPrereq(p, `${base}.conditions.${condition.key}.prerequisites[${i}]`, out),
      );
    for (const key of node.mutuallyExclusiveNodeKeys)
      known(out, 'node', key, base + '.mutuallyExclusiveNodeKeys', nodeKeys);
    if (node.timeline) {
      known(out, 'stage', node.timeline.stageKey, base + '.timeline.stageKey', stageKeys);
      for (const r of node.timeline.excludeIfResolved)
        known(out, 'node', r.nodeKey, base + '.timeline.excludeIfResolved', nodeKeys);
      for (const keys of Object.values(node.timeline.alternatives))
        for (const key of keys) known(out, 'node', key, base + '.timeline.alternatives', nodeKeys);
    }
    return {
      scope: 'director_only',
      ref: { source: ref, nodeKey: node.key, nodeHash: hash(node) },
      role: source.openingEventKey === node.key ? 'opening' : 'event',
      node,
      participantRefs,
      placeRefs,
      unresolvedRefs: out,
    };
  });
  if (source.openingEventKey !== undefined)
    known(issues, 'node', source.openingEventKey, 'openingEventKey', nodeKeys);
  for (const [i, c] of (source.conditions ?? []).entries()) {
    known(issues, 'condition', c.key, `conditions[${i}].key`, conditionKeys);
    c.prerequisites.forEach((p, j) =>
      checkPrereq(p, `conditions[${i}].prerequisites[${j}]`, issues),
    );
  }
  if (source.timeline) {
    known(issues, 'stage', source.timeline.initialStageKey, 'timeline.initialStageKey', stageKeys);
    for (const s of source.timeline.stages)
      for (const key of s.afterStageKeys)
        known(issues, 'stage', key, 'timeline.stages.afterStageKeys', stageKeys);
  }
  return {
    scope: 'director_only',
    world: scope,
    source: ref,
    openingEventKey: source.openingEventKey ?? null,
    timeline: source.timeline,
    conditions: source.conditions ?? [],
    materials,
    unresolvedRefs: issues,
  };
}

export type AuthoredDirectorModelView = Omit<AuthoredAgentMaterialCatalog, 'materials'> & {
  materials: (AuthoredAgentMaterial & { sourceId: string })[];
};
/** A global director evidence handle, never a private NPC source or an actor action candidate. */
export function authoredDirectorSourceHandle(material: AuthoredAgentMaterial): string {
  if (!/^[a-f0-9]{64}$/.test(material.ref.nodeHash)) return fail();
  return `authored:${material.ref.nodeHash}`;
}
/** Explicit full-catalogue whitelist. It preserves manuscripts, not arbitrary private extensions. */
export function projectAuthoredDirectorModelView(
  input: AuthoredAgentMaterialCatalog,
): AuthoredDirectorModelView {
  const origin: Shape = {
    workId: true,
    publicationVersion: true,
    draftVersion: true,
    contentHash: true,
  };
  const source: Shape = { worldId: true, sourceScope: true, origin, sourceHash: true };
  const issue: Shape = { kind: true, key: true, path: true, reason: true };
  const view = project(input, {
    scope: true,
    world: { worldId: true, engineEpoch: true, worldVersion: true },
    openingEventKey: true,
    conditions: [conditionShape],
    materials: [
      {
        scope: true,
        ref: { source, nodeKey: true, nodeHash: true },
        role: true,
        node: nodeShape,
        participantRefs: [{ actorKey: true, actorId: true, status: true }],
        placeRefs: [{ placeKey: true, placeId: true, status: true, availableInWorld: true }],
        unresolvedRefs: [issue],
      },
    ],
    unresolvedRefs: [issue],
  }) as AuthoredAgentMaterialCatalog;
  view.source =
    input.source === null ? null : (project(input.source, source) as AuthoredMaterialSourceRef);
  view.timeline =
    input.timeline === null
      ? null
      : (project(input.timeline, {
          initialStageKey: true,
          stages: [
            { key: true, title: true, order: true, afterStageKeys: [true], window: windowShape },
          ],
        }) as AuthoredMaterialTimeline);
  if (
    view.scope !== 'director_only' ||
    !view.world ||
    !text(view.world.worldId) ||
    !Number.isSafeInteger(view.world.engineEpoch) ||
    view.world.engineEpoch < 2 ||
    !Number.isSafeInteger(view.world.worldVersion) ||
    view.world.worldVersion < 0 ||
    !Array.isArray(view.materials) ||
    !Array.isArray(view.conditions) ||
    !Array.isArray(view.unresolvedRefs) ||
    !(view.openingEventKey === null || text(view.openingEventKey))
  )
    return fail();
  if (
    view.source &&
    (view.source.sourceScope !== 'bound_publication_story_source' ||
      view.source.worldId !== view.world.worldId ||
      !view.source.origin ||
      !text(view.source.origin.workId) ||
      !Number.isSafeInteger(view.source.origin.publicationVersion) ||
      view.source.origin.publicationVersion < 0 ||
      !Number.isSafeInteger(view.source.origin.draftVersion) ||
      view.source.origin.draftVersion < 0 ||
      !/^[a-f0-9]{64}$/.test(view.source.origin.contentHash) ||
      !/^[a-f0-9]{64}$/.test(view.source.sourceHash))
  )
    return fail();
  if (
    !view.source &&
    (view.materials.length ||
      view.openingEventKey !== null ||
      view.timeline !== null ||
      view.conditions.length ||
      view.unresolvedRefs.length)
  )
    return fail();
  const nodeKeys = new Set<string>();
  const materials = view.materials.map((material) => {
    if (
      material.scope !== 'director_only' ||
      !material.ref ||
      !view.source ||
      authoredMaterialCanonicalJson(material.ref.source) !==
        authoredMaterialCanonicalJson(view.source) ||
      material.ref.nodeKey !== material.node?.key ||
      !text(material.ref.nodeKey) ||
      nodeKeys.has(material.ref.nodeKey) ||
      !['opening', 'event'].includes(material.role) ||
      material.node.kind !== 'candidate' ||
      !text(material.node.title) ||
      !text(material.node.editorialIntent) ||
      !strings(material.node.actorKeys) ||
      !Array.isArray(material.node.prerequisites) ||
      !strings(material.node.mutuallyExclusiveNodeKeys) ||
      !Array.isArray(material.participantRefs) ||
      !Array.isArray(material.placeRefs) ||
      !Array.isArray(material.unresolvedRefs)
    )
      return fail();
    nodeKeys.add(material.ref.nodeKey);
    return { ...material, sourceId: authoredDirectorSourceHandle(material) };
  });
  // Canonical JSON also rejects nonfinite numbers/cycles and yields a detached safe projection.
  authoredMaterialCanonicalJson({ ...view, materials });
  return { ...view, materials };
}
