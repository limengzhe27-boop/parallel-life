/** Server-private event progress. Models propose signals; only receipt-bound observations apply. */
export type StoryPace = 'brief' | 'standard' | 'extended';
export type CompletionBasis =
  'verified_world_result' | 'explicit_player_decision' | 'actual_npc_message';
export type CompletionCriterion = {
  id: string;
  basis: CompletionBasis;
  /** A conversation may end in a decision; physical outcomes require verified world evidence. */
  purpose: 'conversation' | 'world_result';
  actorId?: string;
};
export type PersistentActorGoal = {
  actorId: string;
  want: string;
  stance: string;
  boundaries: string[];
  /** References an immutable authorized fictional character setting, never a player interview. */
  authoredSourceId: string;
  completionCriterionIds: string[];
  anchorSourceIds?: string[];
};
export type StoryProgressDefinition = {
  ownerId: string;
  worldId: string;
  nodeKey: string;
  pace: StoryPace;
  goals: PersistentActorGoal[];
  completion: { mode: 'all' | 'any'; criteria: CompletionCriterion[] } | null;
  refusal: 'defer' | 'withdraw';
};
export type ProgressPhase = 'pending' | 'introduced' | 'engaged' | 'resolved';
export type EventResolution = 'fulfilled' | 'withdrawn' | 'missed' | 'alternative' | 'unresolved';
export type StoryEventProgress = {
  schemaVersion: 1;
  nodeKey: string;
  phase: ProgressPhase;
  resolution: EventResolution | null;
  /** Refusal is participation state, not proof the NPC achieved its objective. */
  participation: 'unknown' | 'engaged' | 'declined';
  actorParticipation: Record<string, 'unknown' | 'engaged' | 'declined'>;
  actorParticipationSources: Record<string, string[]>;
  actorGoalStatusSources: Record<string, string[]>;
  productiveBeats: number;
  nudges: number;
  unrelatedInputs: number;
  lastRelevantAt: string | null;
  sourceEventIds: string[];
  sourceRecordKeys: string[];
  criterionSources: Record<string, string[]>;
  actorGoalStatus: Record<string, 'active' | 'deferred' | 'fulfilled' | 'withdrawn'>;
};
export type CommittedProgressObservation = {
  id: string;
  recordId: string;
  commandId: string;
  ownerId: string;
  worldId: string;
  version: number;
  storyAt: string;
  nodeKey: string;
  actorId?: string;
  observableActorIds: string[];
  /** Loaded from persistence by the adapter, never accepted as an AI assertion. */
  kind: 'npc_message' | 'player_decision' | 'verified_world_result';
  criterionIds: string[];
};
export type ProgressReceipt = {
  commandId: string;
  ownerId: string;
  worldId: string;
  status: 'succeeded' | 'queued' | 'failed' | 'unknown';
  resultEventId: string | null;
  resultVersion: number | null;
};
export type ProgressSignal = {
  sourceEventId: string;
  sourceRecordId: string;
  kind:
    | 'introduced'
    | 'engaged'
    | 'declined'
    | 'reopened'
    | 'unrelated'
    | 'npc_progress'
    | 'nudge'
    | 'closure';
  /** Optional closure needs an actual NPC statement; this never means player success. */
  closure?: Exclude<EventResolution, 'fulfilled'>;
};
export class StoryProgressError extends Error {
  constructor(code = 'INVALID_STORY_PROGRESS') {
    super(code);
  }
}
const finiteDate = (value: string) => Number.isFinite(Date.parse(value));
const sameScope = (d: StoryProgressDefinition, x: { ownerId: string; worldId: string }) =>
  x.ownerId === d.ownerId && x.worldId === d.worldId;
const paceRules = {
  brief: { targetBeats: [2, 4], idleMinutes: 10, maxNudges: 1 },
  standard: { targetBeats: [4, 6], idleMinutes: 20, maxNudges: 2 },
  // Extended stories consist of bounded episodes, not one indefinitely prolonged conversation.
  extended: { targetBeats: [4, 6], idleMinutes: 30, maxNudges: 2 },
} as const;
export function storyPacePolicy(pace: StoryPace) {
  return paceRules[pace];
}
export function createStoryEventProgress(d: StoryProgressDefinition): StoryEventProgress {
  if (
    !d.ownerId ||
    !d.worldId ||
    !d.nodeKey ||
    !paceRules[d.pace] ||
    !d.goals.length ||
    new Set(d.goals.map((g) => g.actorId)).size !== d.goals.length ||
    d.goals.some((g) => !g.actorId || !g.want.trim() || !g.stance.trim() || !g.authoredSourceId) ||
    d.goals.some((g) =>
      g.completionCriterionIds.some((id) => !d.completion?.criteria.some((c) => c.id === id)),
    ) ||
    (d.completion &&
      (!d.completion.criteria.length ||
        new Set(d.completion.criteria.map((c) => c.id)).size !== d.completion.criteria.length ||
        d.completion.criteria.some(
          (c) =>
            !c.id ||
            (c.purpose === 'world_result' && c.basis !== 'verified_world_result') ||
            (c.actorId && !d.goals.some((g) => g.actorId === c.actorId)),
        )))
  )
    throw new StoryProgressError('INVALID_PROGRESS_DEFINITION');
  return {
    schemaVersion: 1,
    nodeKey: d.nodeKey,
    phase: 'pending',
    resolution: null,
    participation: 'unknown',
    productiveBeats: 0,
    nudges: 0,
    unrelatedInputs: 0,
    lastRelevantAt: null,
    sourceEventIds: [],
    sourceRecordKeys: [],
    criterionSources: {},
    actorGoalStatus: Object.fromEntries(d.goals.map((g) => [g.actorId, 'active'])),
    actorParticipation: Object.fromEntries(d.goals.map((g) => [g.actorId, 'unknown'])),
    actorParticipationSources: {},
    actorGoalStatusSources: {},
  };
}
const basisOf = (o: CommittedProgressObservation): CompletionBasis =>
  o.kind === 'npc_message'
    ? 'actual_npc_message'
    : o.kind === 'player_decision'
      ? 'explicit_player_decision'
      : 'verified_world_result';
/** Each signal references a real successful event and its exact command receipt. */
export function applyStoryProgressSignal(input: {
  definition: StoryProgressDefinition;
  progress: StoryEventProgress;
  signal: ProgressSignal;
  observations: readonly CommittedProgressObservation[];
  receipts: readonly ProgressReceipt[];
  currentWorldVersion: number;
}): StoryEventProgress {
  const { definition: d, progress: old, signal: s } = input;
  if (old.nodeKey !== d.nodeKey) throw new StoryProgressError();
  const recordKey = JSON.stringify([s.sourceEventId, s.sourceRecordId]);
  if (old.sourceRecordKeys.includes(recordKey)) return structuredClone(old);
  if (old.phase === 'resolved') throw new StoryProgressError('EVENT_ALREADY_RESOLVED');
  const o = input.observations.find(
    (e) => e.id === s.sourceEventId && e.recordId === s.sourceRecordId,
  );
  const r = o && input.receipts.find((r) => r.commandId === o.commandId && sameScope(d, r));
  if (
    !o ||
    !o.recordId ||
    !r ||
    !sameScope(d, o) ||
    o.nodeKey !== d.nodeKey ||
    r.status !== 'succeeded' ||
    r.resultEventId !== o.id ||
    r.resultVersion !== o.version ||
    !Number.isSafeInteger(o.version) ||
    o.version < 1 ||
    o.version > input.currentWorldVersion ||
    !['npc_message', 'player_decision', 'verified_world_result'].includes(o.kind) ||
    !Array.isArray(o.observableActorIds) ||
    o.observableActorIds.some((id) => !d.goals.some((g) => g.actorId === id)) ||
    !finiteDate(o.storyAt) ||
    (old.lastRelevantAt && Date.parse(o.storyAt) < Date.parse(old.lastRelevantAt)) ||
    (o.actorId && !d.goals.some((g) => g.actorId === o.actorId))
  )
    throw new StoryProgressError('UNCOMMITTED_PROGRESS_SOURCE');
  if (
    ['engaged', 'declined', 'reopened', 'unrelated'].includes(s.kind) &&
    o.kind !== 'player_decision'
  )
    throw new StoryProgressError('PLAYER_RESPONSE_REQUIRED');
  if (['introduced', 'nudge', 'closure'].includes(s.kind) && o.kind !== 'npc_message')
    throw new StoryProgressError('ACTUAL_NPC_MESSAGE_REQUIRED');
  if (s.kind === 'npc_progress' && o.kind === 'player_decision')
    throw new StoryProgressError('NPC_OR_WORLD_PROGRESS_REQUIRED');
  if (
    s.kind === 'nudge' &&
    (old.participation === 'declined' || old.nudges >= storyPacePolicy(d.pace).maxNudges)
  )
    throw new StoryProgressError('PARTICIPATION_PRESSURE_BLOCKED');
  if (s.kind === 'closure' && !s.closure) throw new StoryProgressError('CLOSURE_RESULT_REQUIRED');
  if (old.phase === 'pending' && s.kind !== 'introduced')
    throw new StoryProgressError('EVENT_NOT_INTRODUCED');
  const next = structuredClone(old);
  next.sourceRecordKeys.push(recordKey);
  if (!next.sourceEventIds.includes(o.id)) next.sourceEventIds.push(o.id);
  if (s.kind === 'unrelated') {
    next.unrelatedInputs++;
    // Unrelated activity does not reset the event's idle clock or complete a criterion.
    return next;
  }
  next.lastRelevantAt = o.storyAt;
  next.unrelatedInputs = 0;
  if (s.kind === 'introduced') {
    if (old.phase !== 'pending') throw new StoryProgressError('EVENT_ALREADY_INTRODUCED');
    next.phase = 'introduced';
  } else if (s.kind === 'declined') {
    next.participation = 'declined';
    for (const id of o.observableActorIds) {
      next.actorParticipation[id] = 'declined';
      next.actorParticipationSources[id] = [o.id, o.recordId];
      next.actorGoalStatusSources[id] = [o.id, o.recordId];
      next.actorGoalStatus[id] = d.refusal === 'withdraw' ? 'withdrawn' : 'deferred';
    }
  } else if (s.kind === 'reopened' || s.kind === 'engaged') {
    if (s.kind === 'engaged' && old.participation === 'declined')
      throw new StoryProgressError('EXPLICIT_REOPEN_REQUIRED');
    next.participation = 'engaged';
    next.phase = 'engaged';
    for (const id of o.observableActorIds) {
      next.actorParticipation[id] = 'engaged';
      next.actorParticipationSources[id] = [o.id, o.recordId];
      next.actorGoalStatusSources[id] = [o.id, o.recordId];
      next.actorGoalStatus[id] = 'active';
    }
  } else if (s.kind === 'nudge') {
    next.nudges++;
  } else if (s.kind === 'closure') {
    next.phase = 'resolved';
    next.resolution = s.closure!;
    for (const id of o.observableActorIds) {
      next.actorGoalStatus[id] = 'withdrawn';
      next.actorGoalStatusSources[id] = [o.id, o.recordId];
    }
  } else if (next.phase === 'pending') {
    throw new StoryProgressError('EVENT_NOT_INTRODUCED');
  }
  if (s.kind !== 'declined' && s.kind !== 'nudge') next.productiveBeats++;
  // Criteria are server-matched observations. An AI "complete" field is not part of this protocol.
  for (const criterion of d.completion?.criteria ?? []) {
    if (
      !o.criterionIds.includes(criterion.id) ||
      criterion.basis !== basisOf(o) ||
      (criterion.actorId && o.actorId !== criterion.actorId)
    )
      continue;
    const sources = (next.criterionSources[criterion.id] ??= []);
    sources.push(o.id);
  }
  const flags = d.completion?.criteria.map((c) => !!next.criterionSources[c.id]?.length) ?? [];
  const fulfilled =
    flags.length > 0 && (d.completion?.mode === 'any' ? flags.some(Boolean) : flags.every(Boolean));
  // A goal's fulfillment is independent of overall event closure and requires its owner's visibility.
  for (const goal of d.goals) {
    if (
      o.observableActorIds.includes(goal.actorId) &&
      goal.completionCriterionIds.length &&
      goal.completionCriterionIds.every((id) => next.criterionSources[id]?.length)
    ) {
      next.actorGoalStatus[goal.actorId] = 'fulfilled';
      next.actorGoalStatusSources[goal.actorId] = [o.id, o.recordId];
    }
  }
  if (fulfilled && s.kind !== 'closure') {
    next.phase = 'resolved';
    next.resolution = 'fulfilled';
  }
  return next;
}
export type NextStoryMove =
  | 'introduce'
  | 'continue_in_current_turn'
  | 'wait'
  | 'invite_once'
  | 'advance_without_player'
  | 'seek_closure'
  | 'finished';
/** Scheduling advice only; this function cannot create a message, action, result or completion. */
export function nextStoryMove(input: {
  definition: StoryProgressDefinition;
  progress: StoryEventProgress;
  storyNow: string;
  /** Derived from authorized NPC/world actions, never presumed from absence of player input. */
  autonomousActionAvailable: boolean;
  /** Reactive turns need no artificial time delay; idle cadence only governs unsolicited moves. */
  trigger?: 'player_reply' | 'world_change' | 'idle';
}): NextStoryMove {
  const { definition: d, progress: p, storyNow } = input;
  if (p.nodeKey !== d.nodeKey || !finiteDate(storyNow)) throw new StoryProgressError();
  if (p.phase === 'resolved') return 'finished';
  if (p.phase === 'pending') return 'introduce';
  const rule = storyPacePolicy(d.pace);
  const idle =
    !!p.lastRelevantAt &&
    Date.parse(storyNow) - Date.parse(p.lastRelevantAt) >= rule.idleMinutes * 60000;
  if (p.participation === 'declined')
    return d.refusal === 'withdraw'
      ? 'seek_closure'
      : input.autonomousActionAvailable
        ? 'advance_without_player'
        : 'wait';
  if (p.productiveBeats >= rule.targetBeats[1]) return 'seek_closure';
  if (input.trigger === 'player_reply' || input.trigger === 'world_change')
    return 'continue_in_current_turn';
  if (idle || p.unrelatedInputs >= 2) {
    if (input.autonomousActionAvailable) return 'advance_without_player';
    return p.nudges < rule.maxNudges ? 'invite_once' : 'wait';
  }
  return 'wait';
}
/** NPCs receive only their own persistent goal and the progress they were authorized to observe. */
export function ownGoalBrief(
  d: StoryProgressDefinition,
  p: StoryEventProgress,
  actorId: string,
  blockedSources: ReadonlySet<string> = new Set(),
) {
  const goal = d.goals.find((g) => g.actorId === actorId);
  if (
    !goal ||
    p.nodeKey !== d.nodeKey ||
    goal.anchorSourceIds?.some((id) => blockedSources.has(id))
  )
    return null;
  const participation = p.actorParticipationSources[actorId]?.some((id) => blockedSources.has(id))
    ? 'unknown'
    : p.actorParticipation[actorId];
  const status = p.actorGoalStatusSources[actorId]?.some((id) => blockedSources.has(id))
    ? 'active'
    : p.actorGoalStatus[actorId];
  return {
    want: goal.want,
    stance: goal.stance,
    boundaries: [...goal.boundaries],
    status,
    participation,
    shouldRespectRefusal: participation === 'declined',
    mayChangeApproach: true,
    refusalScope: 'current_player_request' as const,
    mayPursueOwnGoalWithoutPlayer: true,
    actualMovesRequireRuntimeAuthorization: true,
    mayRewriteGoalWithoutNewAuthorizedSource: false,
    speechDoesNotProveWorldOutcome: true,
  };
}
