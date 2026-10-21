import type { AgentBlocker, AgentCandidate, AgentScope } from '../domain/agent-runtime.ts';
import type {
  AgentCandidateSource,
  DirectorAgent,
  DirectorCoordination,
} from './agent-runtime-ports.ts';
import { DomainError } from '../domain/errors.ts';

export type RegisteredAgentCandidateSource = {
  id: string;
  /** If this reader fails, only this declared authority scope becomes unavailable. */
  failureScope: AgentScope;
  source: AgentCandidateSource;
};
export type ScheduleAgentsInput = {
  ownerId: string;
  worldId: string;
  engineEpoch: number;
  worldVersion: number;
  actorRevisions: Readonly<Record<string, number>>;
  storyAt: string;
  /** Already authorized by the caller; this scheduler never expands visibility. */
  observations: { sourceId: string; text: string }[];
  blockers?: AgentBlocker[];
  /** Caller must reauthorize plan dependencies for this exact current read version. */
  approvedCoordination?: { engineEpoch: number; worldVersion: number; plan: DirectorCoordination };
};
export type AgentSchedule = {
  status: 'selected' | 'quiet';
  reason:
    | 'selected'
    | 'no_candidates'
    | 'blocked'
    | 'stale_candidates'
    | 'conflicting_candidates'
    | 'source_unavailable'
    | 'director_deferred'
    | 'coordination_failed'
    | 'invalid_coordination'
    | 'stale_coordination';
  snapshot: {
    worldId: string;
    engineEpoch: number;
    worldVersion: number;
    storyAt: string;
    candidates: AgentCandidate[];
    blockers: AgentBlocker[];
  };
  selected: {
    candidate: AgentCandidate;
    readVersion: { engineEpoch: number; worldVersion: number; actorRevision: number };
    guidance: DirectorCoordination['guidance'];
  }[];
  blocked: { candidate: AgentCandidate; blockers: AgentBlocker[] }[];
  deferred: { candidateId: string; reason: string }[];
  sourceFailures: {
    sourceId: string;
    scope: AgentScope;
    reason: 'collection_failed' | 'invalid_collection';
  }[];
  coordination: DirectorCoordination | null;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 240 && v.trim() === v;
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const channels = ['private', 'group', 'scene'];
function keys(v: Record<string, unknown>, allowed: string[]) {
  return Object.keys(v).every((key) => allowed.includes(key));
}
function scopeValid(v: unknown): v is AgentScope {
  if (!record(v)) return false;
  switch (v.kind) {
    case 'world':
      return keys(v, ['kind']);
    case 'actor':
      return keys(v, ['kind', 'actorId']) && id(v.actorId);
    case 'episode':
      return keys(v, ['kind', 'episodeId']) && id(v.episodeId);
    case 'action':
      return keys(v, ['kind', 'actionId']) && id(v.actionId);
    case 'resource':
      return keys(v, ['kind', 'resourceId']) && id(v.resourceId);
    case 'channel':
      return (
        keys(v, ['kind', 'channel', 'threadId']) &&
        channels.includes(String(v.channel)) &&
        id(v.threadId)
      );
    default:
      return false;
  }
}
/** The caller owns authorization; scopes never match by actor array position or mere world ownership. */
export function agentScopeBlocks(scope: AgentScope, candidate: AgentCandidate): boolean {
  switch (scope.kind) {
    case 'world':
      return true;
    case 'actor':
      return scope.actorId === candidate.actorId;
    case 'episode':
      return scope.episodeId === candidate.episodeId;
    case 'action':
      return scope.actionId === candidate.actionId;
    case 'resource':
      return candidate.resourceIds.includes(scope.resourceId);
    case 'channel':
      return scope.channel === candidate.channel && scope.threadId === candidate.threadId;
  }
}
function conditionValid(v: unknown): boolean {
  if (!record(v)) return false;
  switch (v.kind) {
    case 'at_or_after':
      return (
        keys(v, ['kind', 'at', 'sourceId']) &&
        typeof v.at === 'string' &&
        Number.isFinite(Date.parse(v.at)) &&
        id(v.sourceId)
      );
    case 'result':
      return (
        keys(v, ['kind', 'actionId', 'outcome']) &&
        id(v.actionId) &&
        ['succeeded', 'failed'].includes(String(v.outcome))
      );
    case 'player_decision':
      return (
        keys(v, ['kind', 'responsibilityId', 'decision']) &&
        id(v.responsibilityId) &&
        ['accepted', 'declined', 'negotiating', 'deferred', 'undecided'].includes(
          String(v.decision),
        )
      );
    case 'at_place':
      return keys(v, ['kind', 'placeId']) && id(v.placeId);
    case 'observation':
      return keys(v, ['kind', 'sourceId']) && id(v.sourceId);
    default:
      return false;
  }
}
function blockerValid(v: unknown): v is AgentBlocker {
  return (
    record(v) &&
    keys(v, ['scope', 'reason', 'sourceId', 'reconsiderOn']) &&
    scopeValid(v.scope) &&
    [
      'unknown_attempt',
      'paused',
      'waiting_condition',
      'cooldown',
      'permission',
      'stale_projection',
    ].includes(String(v.reason)) &&
    id(v.sourceId) &&
    Array.isArray(v.reconsiderOn) &&
    v.reconsiderOn.every(conditionValid)
  );
}
function candidateValid(v: unknown, input: ScheduleAgentsInput): v is AgentCandidate {
  return (
    record(v) &&
    keys(v, [
      'id',
      'worldId',
      'actorId',
      'source',
      'episodeId',
      'actionId',
      'resourceIds',
      'channel',
      'threadId',
      'sourceIds',
      'expectedWorldVersion',
      'expectedActorRevision',
      'priority',
      'reason',
      'requiresCoordination',
      'planReview',
    ]) &&
    id(v.id) &&
    v.worldId === input.worldId &&
    id(v.actorId) &&
    Object.hasOwn(input.actorRevisions, v.actorId) &&
    [
      'opening',
      'agenda_initialize',
      'agenda_review',
      'authored_event',
      'actor_plan',
      'responsibility',
      'conversation',
      'observation',
      'action_result',
    ].includes(String(v.source)) &&
    (v.episodeId === null || id(v.episodeId)) &&
    (v.actionId === null || id(v.actionId)) &&
    Array.isArray(v.resourceIds) &&
    v.resourceIds.every(id) &&
    channels.includes(String(v.channel)) &&
    id(v.threadId) &&
    Array.isArray(v.sourceIds) &&
    v.sourceIds.length > 0 &&
    v.sourceIds.every(id) &&
    revision(v.expectedWorldVersion) &&
    revision(v.expectedActorRevision) &&
    typeof v.priority === 'number' &&
    Number.isFinite(v.priority) &&
    typeof v.reason === 'string' &&
    v.reason.trim().length > 0 &&
    typeof v.requiresCoordination === 'boolean'
  );
}
function frozen<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
function canonical(candidate: AgentCandidate): AgentCandidate {
  return frozen({
    id: candidate.id,
    worldId: candidate.worldId,
    actorId: candidate.actorId,
    source: candidate.source,
    episodeId: candidate.episodeId,
    actionId: candidate.actionId,
    resourceIds: [...new Set(candidate.resourceIds)].sort(),
    channel: candidate.channel,
    threadId: candidate.threadId,
    sourceIds: [...new Set(candidate.sourceIds)].sort(),
    expectedWorldVersion: candidate.expectedWorldVersion,
    expectedActorRevision: candidate.expectedActorRevision,
    priority: candidate.priority,
    reason: candidate.reason,
    requiresCoordination: candidate.requiresCoordination,
  });
}
const compare = (a: AgentCandidate, b: AgentCandidate) =>
  b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function competingActors(candidates: AgentCandidate[]): boolean {
  return candidates.some((a, index) =>
    candidates
      .slice(index + 1)
      .some(
        (b) =>
          a.actorId !== b.actorId &&
          ((a.episodeId !== null && a.episodeId === b.episodeId) ||
            a.resourceIds.some((resource) => b.resourceIds.includes(resource)) ||
            (a.channel !== 'private' && a.channel === b.channel && a.threadId === b.threadId)),
      ),
  );
}
function validCoordination(
  raw: unknown,
  candidates: AgentCandidate[],
): raw is DirectorCoordination {
  if (
    !record(raw) ||
    !keys(raw, ['candidateIds', 'deferred', 'guidance', 'reason']) ||
    !Array.isArray(raw.candidateIds) ||
    !Array.isArray(raw.deferred) ||
    !Array.isArray(raw.guidance) ||
    typeof raw.reason !== 'string' ||
    !raw.reason.trim()
  )
    return false;
  const allowed = new Map(candidates.map((c) => [c.id, c]));
  const selected = new Set<string>();
  for (const candidateId of raw.candidateIds) {
    if (!id(candidateId) || !allowed.has(candidateId) || selected.has(candidateId)) return false;
    selected.add(candidateId);
  }
  const accounted = new Set(selected);
  for (const item of raw.deferred) {
    if (
      !record(item) ||
      !keys(item, ['candidateId', 'reason']) ||
      !id(item.candidateId) ||
      !allowed.has(item.candidateId) ||
      accounted.has(item.candidateId) ||
      typeof item.reason !== 'string' ||
      !item.reason.trim()
    )
      return false;
    accounted.add(item.candidateId);
  }
  if (accounted.size !== candidates.length) return false;
  const guided = new Set<string>();
  for (const item of raw.guidance) {
    if (
      !record(item) ||
      !keys(item, ['actorId', 'candidateId', 'kind', 'basisSourceIds']) ||
      !id(item.candidateId) ||
      !selected.has(item.candidateId) ||
      allowed.get(item.candidateId)!.actorId !== item.actorId ||
      guided.has(item.candidateId) ||
      ![
        'continue_own_plan',
        'reassess_own_responsibility',
        'respond_to_player',
        'consider_opportunity',
      ].includes(String(item.kind)) ||
      !Array.isArray(item.basisSourceIds) ||
      !item.basisSourceIds.length ||
      item.basisSourceIds.some(
        (sourceId) =>
          typeof sourceId !== 'string' ||
          !allowed.get(item.candidateId as string)!.sourceIds.includes(sourceId),
      )
    )
      return false;
    guided.add(item.candidateId);
  }
  return true;
}

/** Pure orchestration around ports: no persistence, clock movement, paid retry, NPC generation or claim. */
export async function scheduleAgents(
  deps: { sources: readonly RegisteredAgentCandidateSource[]; director: DirectorAgent },
  input: ScheduleAgentsInput,
): Promise<AgentSchedule> {
  if (
    !id(input.ownerId) ||
    !id(input.worldId) ||
    !revision(input.engineEpoch) ||
    !revision(input.worldVersion) ||
    !Number.isFinite(Date.parse(input.storyAt)) ||
    !record(input.actorRevisions) ||
    !Object.values(input.actorRevisions).every(revision) ||
    !Array.isArray(input.observations) ||
    !input.observations.every((o) => id(o.sourceId) && typeof o.text === 'string') ||
    !(input.blockers ?? []).every(blockerValid) ||
    deps.sources.some((s) => !id(s.id) || !scopeValid(s.failureScope)) ||
    new Set(deps.sources.map((s) => s.id)).size !== deps.sources.length
  )
    throw new DomainError('INVALID_COMMAND');
  // Capture authorized inputs before any asynchronous reader can mutate caller-owned references.
  const current = frozen(input);
  const registrations = deps.sources
    .map((s) => ({ ...s, failureScope: frozen(s.failureScope) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const collections = await Promise.allSettled(
    registrations.map(async (s) =>
      structuredClone(await s.source.collect(current.ownerId, current.worldId)),
    ),
  );
  const failures: AgentSchedule['sourceFailures'] = [];
  const blockers = [...(current.blockers ?? [])];
  const grouped = new Map<string, AgentCandidate[]>();
  collections.forEach((outcome, index) => {
    const registration = registrations[index]!;
    if (
      outcome.status !== 'fulfilled' ||
      !record(outcome.value) ||
      !keys(outcome.value, ['candidates', 'blockers']) ||
      !Array.isArray(outcome.value.candidates) ||
      !outcome.value.candidates.every((c) => candidateValid(c, current)) ||
      !Array.isArray(outcome.value.blockers) ||
      !outcome.value.blockers.every(blockerValid)
    ) {
      failures.push({
        sourceId: registration.id,
        scope: registration.failureScope,
        reason: outcome.status === 'rejected' ? 'collection_failed' : 'invalid_collection',
      });
      blockers.push({
        scope: registration.failureScope,
        reason: 'stale_projection',
        sourceId: `candidate-source:${registration.id}`,
        reconsiderOn: [],
      });
      return;
    }
    blockers.push(...outcome.value.blockers);
    for (const candidate of outcome.value.candidates as AgentCandidate[]) {
      const list = grouped.get(candidate.id) ?? [];
      list.push(canonical(candidate));
      grouped.set(candidate.id, list);
    }
  });
  const deferred: AgentSchedule['deferred'] = [];
  const candidates: AgentCandidate[] = [];
  for (const [candidateId, entries] of grouped) {
    if (new Set(entries.map((c) => JSON.stringify(c))).size > 1) {
      deferred.push({ candidateId, reason: 'conflicting_candidate' });
      continue;
    }
    const candidate = entries[0]!;
    if (
      candidate.expectedWorldVersion !== current.worldVersion ||
      candidate.expectedActorRevision !== current.actorRevisions[candidate.actorId]
    ) {
      deferred.push({ candidateId, reason: 'stale_candidate' });
      continue;
    }
    candidates.push(candidate);
  }
  candidates.sort(compare);
  const snapshot = frozen({
    worldId: current.worldId,
    engineEpoch: current.engineEpoch,
    worldVersion: current.worldVersion,
    storyAt: current.storyAt,
    candidates,
    blockers,
  });
  const blocked = snapshot.candidates
    .map((candidate) => ({
      candidate,
      blockers: snapshot.blockers.filter((b) => agentScopeBlocks(b.scope, candidate)),
    }))
    .filter((c) => c.blockers.length > 0);
  const excluded = new Set(blocked.map((b) => b.candidate.id));
  const eligible = Object.freeze(
    snapshot.candidates.filter((c) => !excluded.has(c.id)),
  ) as unknown as AgentCandidate[];
  const result = (
    reason: AgentSchedule['reason'],
    chosen: string[] = [],
    coordination: DirectorCoordination | null = null,
  ): AgentSchedule => {
    const byId = new Map(eligible.map((c) => [c.id, c]));
    return Object.freeze({
      status: chosen.length ? 'selected' : 'quiet',
      reason,
      snapshot,
      selected: Object.freeze(
        chosen.map((candidateId) => {
          const candidate = byId.get(candidateId)!;
          return Object.freeze({
            candidate,
            readVersion: Object.freeze({
              engineEpoch: current.engineEpoch,
              worldVersion: candidate.expectedWorldVersion,
              actorRevision: candidate.expectedActorRevision,
            }),
            guidance: frozen(
              coordination?.guidance.filter((g) => g.candidateId === candidateId) ?? [],
            ),
          });
        }),
      ) as unknown as AgentSchedule['selected'],
      blocked: frozen(blocked),
      deferred: frozen(
        [...deferred, ...(coordination?.deferred ?? [])].sort((a, b) =>
          a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0,
        ),
      ),
      sourceFailures: frozen(failures),
      coordination: coordination ? frozen(coordination) : null,
    });
  };
  if (!eligible.length)
    return result(
      blocked.length || snapshot.blockers.some((b) => b.scope.kind === 'world')
        ? 'blocked'
        : failures.length
          ? 'source_unavailable'
          : deferred.some((d) => d.reason === 'conflicting_candidate')
            ? 'conflicting_candidates'
            : deferred.length
              ? 'stale_candidates'
              : 'no_candidates',
    );
  if (
    !eligible.some((c) => c.requiresCoordination) &&
    !competingActors(eligible) &&
    !current.approvedCoordination
  ) {
    deferred.push(
      ...eligible.slice(1).map((c) => ({ candidateId: c.id, reason: 'lower_priority' })),
    );
    return result('selected', [eligible[0]!.id]);
  }
  let coordination: DirectorCoordination;
  if (current.approvedCoordination) {
    if (
      current.approvedCoordination.engineEpoch !== current.engineEpoch ||
      current.approvedCoordination.worldVersion !== current.worldVersion
    ) {
      deferred.push(...eligible.map((c) => ({ candidateId: c.id, reason: 'stale_coordination' })));
      return result('stale_coordination');
    }
    coordination = current.approvedCoordination.plan;
  } else {
    try {
      coordination = await deps.director.coordinate(
        Object.freeze({
          worldId: current.worldId,
          worldVersion: current.worldVersion,
          storyAt: current.storyAt,
          candidates: eligible,
          blockers: snapshot.blockers,
          observations: current.observations,
        }),
      );
    } catch {
      deferred.push(...eligible.map((c) => ({ candidateId: c.id, reason: 'coordination_failed' })));
      return result('coordination_failed');
    }
  }
  if (!validCoordination(coordination, eligible)) {
    deferred.push(...eligible.map((c) => ({ candidateId: c.id, reason: 'invalid_coordination' })));
    return result('invalid_coordination');
  }
  // A coordinator can plan a sequence, but only the first claim uses this read snapshot.
  // Every later action must be re-collected after the first commit changes world/actor state.
  deferred.push(
    ...coordination.candidateIds
      .slice(1)
      .map((candidateId) => ({ candidateId, reason: 'next_snapshot_required' })),
  );
  return result(
    coordination.candidateIds.length ? 'selected' : 'director_deferred',
    coordination.candidateIds.slice(0, 1),
    coordination,
  );
}
