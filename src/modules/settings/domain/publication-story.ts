import {
  publicationStoryWindowState,
  type PublicationContent,
  type PublicationStoryWindow,
  type PublicationNodeOutcome,
} from './publication-content.ts';

export type StoryOrigin = {
  workId: string;
  publicationVersion: number;
  draftVersion: number;
  contentHash: string;
};
export type StoryNode = PublicationContent['candidates'][number];
export type StoryStatus =
  | 'claimed'
  | 'unknown'
  | 'presented'
  | 'offered'
  | 'committed'
  | 'declined'
  | 'skipped'
  | 'expired'
  | 'failed';
export type StoryState = {
  nodeKey: string;
  claimId: string;
  commandId: string;
  actorId: string | null;
  expectedVersion: number;
  status: StoryStatus;
  outcome: PublicationNodeOutcome | null;
  storyAt: string;
  automatic: boolean;
  sourceEventId: string | null;
  sourceMessageId: string | null;
  invitationId: string | null;
  responseEventId: string | null;
};
export type StoryPlan = {
  schemaVersion: 1;
  origin: StoryOrigin;
  timeline: PublicationContent['timeline'] | null;
  nodes: StoryNode[];
  conditions?: PublicationContent['conditions'];
  actors: { key: string; id: string }[];
  places: { key: string; name: string }[];
  history: { key: string; factIds: string[]; allowedActorIds: string[] }[];
};
export type StorySource = {
  origin: StoryOrigin;
  timeline: PublicationContent['timeline'] | null;
  nodes: StoryNode[];
  conditions?: PublicationContent['conditions'];
  actorKeys: string[];
  history: PublicationContent['history'];
  knownFactKeys: string[];
  initialKnowledge: PublicationContent['initialKnowledge'];
  contacts: { actorKey: string; actorId: string }[];
  initialActorIds: string[];
  initialFacts: {
    id: string;
    text: string;
    kind?: string;
    sourceEventId: string;
    visibility: { kind: string; actorIds?: string[] };
  }[];
  initialPlaceKeys: string[];
  places: { key: string; name: string }[];
  genesisSource: string;
};
export class PublicationStoryError extends Error {
  readonly code: string;
  constructor(code = 'INVALID_STATE') {
    super(code);
    this.code = code;
  }
}
const ordered = <T extends { key: string }>(a: T[]) =>
  [...a].sort((x, y) => x.key.localeCompare(y.key, 'en'));
const unique = (a: string[]) => new Set(a).size === a.length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Verify namespace allocation against the immutable initial snapshot, never match people by name. */
export function buildStoryPlan(s: StorySource): StoryPlan {
  if (
    !unique(s.actorKeys) ||
    !unique(s.contacts.map((a) => a.actorKey)) ||
    !unique(s.contacts.map((a) => a.actorId)) ||
    !unique(s.initialActorIds) ||
    !unique(s.nodes.map((n) => n.key))
  )
    throw new PublicationStoryError();
  const actors = ordered(s.contacts.map((a) => ({ key: a.actorKey, id: a.actorId })));
  if (
    s.actorKeys.length !== s.contacts.length ||
    s.initialActorIds.length !== s.contacts.length ||
    s.actorKeys.some((key) => !actors.some((a) => a.key === key)) ||
    actors.some((a) => !s.initialActorIds.includes(a.id))
  )
    throw new PublicationStoryError();
  const histories: StoryPlan['history'] = [];
  let index = 0;
  for (const h of ordered(s.history)) {
    const factIds: string[] = [],
      allowedActorIds: string[] = [];
    const consume = (visibility: { kind: string; actorIds?: string[] }) => {
      const actual = s.initialFacts[index++];
      if (
        !actual ||
        actual.sourceEventId !== s.genesisSource ||
        actual.kind !== 'canonical' ||
        actual.text !== h.text ||
        !same(actual.visibility, visibility)
      )
        throw new PublicationStoryError();
      factIds.push(actual.id);
    };
    if (s.knownFactKeys.includes(h.key)) consume({ kind: 'owner' });
    const recipients = actors
      .filter(
        (a) =>
          (h.visibility.kind === 'world' ||
            (h.visibility.kind === 'actors' && h.visibility.actorKeys.includes(a.key))) &&
          s.initialKnowledge.some((k) => k.actorKey === a.key && k.factKeys.includes(h.key)),
      )
      .map((a) => a.id);
    if (recipients.length) {
      consume({ kind: 'actors', actorIds: recipients });
      allowedActorIds.push(...recipients);
    }
    histories.push({ key: h.key, factIds, allowedActorIds });
  }
  if (index !== s.initialFacts.length || !unique(s.initialFacts.map((f) => f.id)))
    throw new PublicationStoryError();
  for (const node of s.nodes) {
    if (node.kind !== 'candidate') throw new PublicationStoryError();
    if (node.intent.kind === 'editorial_only') continue;
    const actorKey =
      node.intent.kind === 'offer_message' || node.intent.kind === 'director_event'
        ? node.intent.actorKey
        : node.intent.actorKeys[0];
    if (node.intent.kind === 'offer_invitation' && node.intent.actorKeys.length !== 1)
      throw new PublicationStoryError('UNSUPPORTED_INVITATION');
    if (!actorKey || !node.actorKeys.includes(actorKey) || !actors.some((a) => a.key === actorKey))
      throw new PublicationStoryError();
    const places = [
      node.placeKey,
      ...(node.intent.kind === 'offer_invitation' ? [node.intent.placeKey] : []),
    ].filter((x): x is string => !!x);
    if (places.some((place) => !s.initialPlaceKeys.includes(place)))
      throw new PublicationStoryError('UNSUPPORTED_PLACE');
  }
  return {
    schemaVersion: 1,
    origin: { ...s.origin },
    timeline: s.timeline ? structuredClone(s.timeline) : null,
    nodes: structuredClone(s.nodes),
    ...(s.conditions?.length ? { conditions: structuredClone(s.conditions) } : {}),
    actors,
    places: structuredClone(s.places.filter((p) => s.initialPlaceKeys.includes(p.key))),
    history: histories,
  };
}
export function nodeActor(plan: StoryPlan, node: StoryNode) {
  if (node.intent.kind === 'editorial_only') return null;
  const key =
    node.intent.kind === 'offer_message' || node.intent.kind === 'director_event'
      ? node.intent.actorKey
      : node.intent.actorKeys[0];
  return plan.actors.find((a) => a.key === key) ?? null;
}
export function storyNodeWindow(
  plan: StoryPlan,
  node: StoryNode,
): PublicationStoryWindow | undefined {
  const stage = plan.timeline?.stages.find((s) => s.key === node.timeline?.stageKey)?.window,
    n = node.timeline?.window;
  if (!stage) return n;
  if (!n) return stage;
  return {
    notBefore:
      Date.parse(stage.notBefore) > Date.parse(n.notBefore) ? stage.notBefore : n.notBefore,
    expiresAt:
      Date.parse(stage.expiresAt) < Date.parse(n.expiresAt) ? stage.expiresAt : n.expiresAt,
  };
}
export function legalPresentation(plan: StoryPlan, node: StoryNode, storyAt: string) {
  const w = storyNodeWindow(plan, node);
  return (
    Number.isFinite(Date.parse(storyAt)) &&
    (!w || publicationStoryWindowState(w, storyAt) === 'open')
  );
}
export function storyDay(storyAt: string) {
  if (!Number.isFinite(Date.parse(storyAt))) throw new PublicationStoryError();
  return new Date(Date.parse(storyAt) + 8 * 3600000).toISOString().slice(0, 10);
}
export type StoryEvaluation = {
  eligible: StoryNode[];
  expired: string[];
  excluded: { nodeKey: string; sourceNodeKey: string }[];
  currentStages: string[];
  resolvedStages: string[];
  rateLimited: boolean;
};
/** All evidence is supplied from verified persistence. This function owns no clock, random IDs or model. */
export function evaluateStory(
  plan: StoryPlan,
  states: StoryState[],
  context: {
    storyNow: string;
    currentPlaceId: string | null;
    availableFactIds: string[];
    automatic?: boolean;
  },
): StoryEvaluation {
  if (!Number.isFinite(Date.parse(context.storyNow))) throw new PublicationStoryError();
  const byKey = new Map(states.map((s) => [s.nodeKey, s])),
    expired: string[] = [],
    excluded: StoryEvaluation['excluded'] = [];
  const outcome = (key: string) => byKey.get(key)?.outcome ?? null;
  for (const n of plan.nodes) {
    const st = byKey.get(n.key);
    if (st?.outcome || st?.status === 'claimed' || st?.status === 'unknown') continue;
    const w = storyNodeWindow(plan, n);
    if (w && publicationStoryWindowState(w, context.storyNow) === 'expired') {
      expired.push(n.key);
      continue;
    }
    const mutually = n.mutuallyExclusiveNodeKeys.find((k) => outcome(k) === 'committed');
    const resolved = n.timeline?.excludeIfResolved.find((c) => {
      const o = outcome(c.nodeKey);
      return o && c.outcomes.includes(o);
    });
    if (mutually || resolved)
      excluded.push({ nodeKey: n.key, sourceNodeKey: mutually ?? resolved!.nodeKey });
  }
  const virtual = new Map<string, PublicationNodeOutcome>();
  for (const s of states) if (s.outcome) virtual.set(s.nodeKey, s.outcome);
  for (const k of expired) virtual.set(k, 'expired');
  for (const x of excluded) virtual.set(x.nodeKey, 'skipped');
  const resolvedStages: string[] = [],
    currentStages: string[] = [];
  for (const stage of [...(plan.timeline?.stages ?? [])].sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key, 'en'),
  )) {
    const nodes = plan.nodes.filter(
      (n) => n.timeline?.stageKey === stage.key && n.intent.kind !== 'editorial_only',
    );
    const clockExpired =
      stage.window && publicationStoryWindowState(stage.window, context.storyNow) === 'expired';
    const editorialSkipped = plan.nodes.some(
      (n) =>
        n.timeline?.stageKey === stage.key &&
        n.intent.kind === 'editorial_only' &&
        virtual.get(n.key) === 'skipped',
    );
    if (
      clockExpired ||
      (nodes.length > 0 && nodes.every((n) => virtual.has(n.key))) ||
      (!nodes.length && editorialSkipped)
    )
      resolvedStages.push(stage.key);
    else if (
      stage.afterStageKeys.every((k) => resolvedStages.includes(k)) &&
      (!stage.window || publicationStoryWindowState(stage.window, context.storyNow) === 'open')
    )
      currentStages.push(stage.key);
  }
  const eligible = plan.nodes
    .filter((n) => {
      if (n.intent.kind === 'editorial_only' || byKey.has(n.key) || virtual.has(n.key))
        return false;
      if (n.timeline && !currentStages.includes(n.timeline.stageKey)) return false;
      if (!legalPresentation(plan, n, context.storyNow)) return false;
      const actor = nodeActor(plan, n);
      if (!actor) return false;
      if (n.placeKey && n.placeKey !== context.currentPlaceId) return false;
      const inbound = plan.nodes.flatMap((prior) =>
        Object.entries(prior.timeline?.alternatives ?? {}).flatMap(([kind, keys]) =>
          (keys as string[]).includes(n.key)
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
      if (inbound.length && !inbound.some((p) => virtual.get(p.key) === p.outcome)) return false;
      const matches = (p: StoryNode['prerequisites'][number]): boolean => {
        if (p.kind === 'not_before') return Date.parse(context.storyNow) >= Date.parse(p.at);
        if (p.kind === 'at_place') return p.placeKey === context.currentPlaceId;
        if (p.kind === 'after_presented_node') {
          const prior = byKey.get(p.nodeKey);
          return (
            !!prior?.sourceEventId &&
            ['presented', 'offered', 'committed', 'declined'].includes(prior.status)
          );
        }
        if (p.kind === 'after_committed_node') return virtual.get(p.nodeKey) === 'committed';
        if (p.kind === 'after_resolved_node') {
          const o = virtual.get(p.nodeKey);
          return !!o && p.outcomes.includes(o);
        }
        const h = plan.history.find((h) => h.key === p.factKey);
        return (
          !!h &&
          h.allowedActorIds.includes(actor.id) &&
          h.factIds.length > 0 &&
          h.factIds.every((id) => context.availableFactIds.includes(id))
        );
      };
      return (
        n.prerequisites.every(matches) &&
        (n.conditionKeys ?? []).every((key) => {
          const groups = (plan.conditions ?? []).filter((group) => group.key === key);
          const group = groups.length === 1 ? groups[0] : undefined;
          if (!group || !group.prerequisites.length) return false;
          if (group.match === 'all') return group.prerequisites.every(matches);
          if (group.match === 'any') return group.prerequisites.some(matches);
          return false;
        })
      );
    })
    .sort((a, b) => {
      const order = (n: StoryNode) =>
        plan.timeline?.stages.find((s) => s.key === n.timeline?.stageKey)?.order ?? 0;
      return order(a) - order(b) || a.key.localeCompare(b.key, 'en');
    });
  const automatic = context.automatic ?? true;
  const autoClaims = states.filter((s) => s.automatic),
    day = storyDay(context.storyNow);
  const today = autoClaims.filter((s) => storyDay(s.storyAt) === day).length;
  const attempted = states.filter(
    (s) => s.sourceEventId !== null || ['claimed', 'unknown', 'failed'].includes(s.status),
  );
  const last = attempted.reduce(
    (v, s) => Math.max(v, Date.parse(s.storyAt)),
    Number.NEGATIVE_INFINITY,
  );
  const rateLimited = automatic && (today >= 3 || Date.parse(context.storyNow) - last < 10 * 60000);
  return {
    eligible: rateLimited ? [] : eligible,
    expired,
    excluded,
    currentStages,
    resolvedStages,
    rateLimited,
  };
}
