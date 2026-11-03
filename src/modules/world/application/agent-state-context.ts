import type {
  ActorAgentState,
  AgentAction,
  AgentCondition,
  AgentConversationFocus,
} from '../domain/agent-runtime.ts';

export type ActorStateContextOptions = {
  privateStrategySourceIds?: ReadonlySet<string>;
  includeRequestRevisions?: boolean;
  /** Global Director observation only; NPC strategy uses its source-filtered view. */
  includeContinuation?: boolean;
};
function defaultInvalid(): never {
  throw Object.assign(new Error('INVALID_AGENT_CONTEXT'), { code: 'INVALID_AGENT_CONTEXT' });
}

/** Pure explicit projection, not a summarizer, authorization resolver or capability registry. */
export function actorStateContextPayload(
  state: ActorAgentState,
  options: ActorStateContextOptions = {},
  invalid: () => never = defaultInvalid,
): ActorAgentState {
  const object = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  };
  object(state);
  if (state.schemaVersion !== 1) return invalid();
  const objects = <T>(values: T[]): T[] => {
    if (!Array.isArray(values)) return invalid();
    for (const value of values) object(value);
    return values;
  };
  const text = (value: string): string => (typeof value === 'string' ? value : invalid());
  const revision = (value: number): number =>
    Number.isSafeInteger(value) && value >= 0 ? value : invalid();
  const strings = (values: string[]): string[] =>
    Array.isArray(values) ? Array.from(values, text) : invalid();
  const nullableText = (value: string | null) => (value === null ? null : text(value));
  const condition = (value: AgentCondition): AgentCondition => {
    object(value);
    switch (value.kind) {
      case 'at_or_after':
        return { kind: value.kind, at: text(value.at), sourceId: text(value.sourceId) };
      case 'result':
        return {
          kind: value.kind,
          actionId: text(value.actionId),
          outcome: text(value.outcome) as typeof value.outcome,
        };
      case 'player_decision':
        return {
          kind: value.kind,
          responsibilityId: text(value.responsibilityId),
          decision: text(value.decision) as typeof value.decision,
        };
      case 'at_place':
        return { kind: value.kind, placeId: text(value.placeId) };
      case 'observation':
        return { kind: value.kind, sourceId: text(value.sourceId) };
      default:
        return invalid();
    }
  };
  const focus = (value: AgentConversationFocus | null): AgentConversationFocus | null => {
    if (value === null) return null;
    object(value);
    return {
      channel: text(value.channel) as AgentConversationFocus['channel'],
      threadId: text(value.threadId),
      subjectId: nullableText(value.subjectId),
      questionSourceId: nullableText(value.questionSourceId),
      replyToActorId: nullableText(value.replyToActorId),
    };
  };
  const subject = (value: ActorAgentState['responsibilities'][number]['subject']) => {
    object(value);
    return { kind: text(value.kind) as typeof value.kind, id: text(value.id) };
  };
  const deadline = (
    value: NonNullable<ActorAgentState['responsibilities'][number]['deadline']>,
  ) => {
    object(value);
    return { at: text(value.at), sourceId: text(value.sourceId) };
  };
  const parameters = (values: AgentAction['parameters']): AgentAction['parameters'] => {
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(values)) ||
      Object.getOwnPropertySymbols(values).length
    )
      return invalid();
    return Object.fromEntries(
      Object.keys(values).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(values, key);
        if (!descriptor || !('value' in descriptor)) return invalid();
        const value: unknown = descriptor.value;
        if (Array.isArray(value) && Array.from(value).every((item) => typeof item === 'string'))
          return [key, [...value]];
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          return [key, value];
        return invalid();
      }),
    );
  };
  // This optional history is NPC-owned stance, not shared progress or a player decision.
  // Known fields must be data properties; unknown fields (including getters) are never read.
  const data = (value: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : invalid();
  };
  const participationDescriptor = Object.getOwnPropertyDescriptor(state, 'episodeParticipations');
  const participations = participationDescriptor
    ? 'value' in participationDescriptor
      ? participationDescriptor.value
      : invalid()
    : undefined;
  const episodeParticipations = (): NonNullable<ActorAgentState['episodeParticipations']> => {
    if (!Array.isArray(participations)) return invalid();
    return Array.from({ length: participations.length }, (_, index) => {
      const item = data(participations, String(index));
      object(item);
      const record = item as object;
      const choice = data(record, 'choice');
      if (!['engage', 'decline', 'defer', 'need_information', 'quiet'].includes(choice as string))
        return invalid();
      const sourceIds = data(record, 'sourceIds');
      if (!Array.isArray(sourceIds)) return invalid();
      return {
        id: text(data(record, 'id') as string),
        choice: choice as NonNullable<ActorAgentState['episodeParticipations']>[number]['choice'],
        reason: text(data(record, 'reason') as string),
        sourceIds: Array.from({ length: sourceIds.length }, (_, index) =>
          text(data(sourceIds, String(index)) as string),
        ),
        recordedAtVersion: revision(data(record, 'recordedAtVersion') as number),
      };
    });
  };
  const continuationDescriptor = options.includeContinuation
    ? Object.getOwnPropertyDescriptor(state, 'continuation')
    : undefined;
  const continuation = continuationDescriptor
    ? 'value' in continuationDescriptor
      ? continuationDescriptor.value
      : invalid()
    : undefined;
  const continuationView = (): NonNullable<ActorAgentState['continuation']> => {
    object(continuation);
    const record = continuation as object;
    const decision = data(record, 'decision');
    if (
      data(record, 'version') !== 1 ||
      !['act', 'await_response', 'await_condition', 'no_current_intent'].includes(
        decision as string,
      )
    )
      return invalid();
    const sourceIds = strings(data(record, 'sourceIds') as string[]);
    return {
      version: 1,
      decision: decision as NonNullable<ActorAgentState['continuation']>['decision'],
      reason: sourceIds.some((id) => options.privateStrategySourceIds?.has(id))
        ? ''
        : text(data(record, 'reason') as string),
      sourceIds,
      planIds: strings(data(record, 'planIds') as string[]),
      questionIds: strings(data(record, 'questionIds') as string[]),
      conditions: objects(data(record, 'conditions') as AgentCondition[]).map(condition),
      decidedAt: text(data(record, 'decidedAt') as string),
      sourceInputId: text(data(record, 'sourceInputId') as string),
      basisHash: text(data(record, 'basisHash') as string),
    };
  };
  return {
    schemaVersion: state.schemaVersion,
    worldId: text(state.worldId),
    actorId: text(state.actorId),
    revision: revision(state.revision),
    projectedWorldVersion: revision(state.projectedWorldVersion),
    definitionRef: text(state.definitionRef),
    knowledgeSourceIds: strings(state.knowledgeSourceIds),
    goals: objects(state.goals).map((g) => ({
      id: text(g.id),
      summary: text(g.summary),
      status: text(g.status) as typeof g.status,
      sourceIds: strings(g.sourceIds),
      resultIds: strings(g.resultIds),
      ...(g.endReason === undefined ? {} : { endReason: text(g.endReason) }),
    })),
    plans: objects(state.plans).map((p) => ({
      id: text(p.id),
      goalId: nullableText(p.goalId),
      summary: text(p.summary),
      status: text(p.status) as typeof p.status,
      sourceIds: strings(p.sourceIds),
      actionIds: strings(p.actionIds),
      nextActionId: nullableText(p.nextActionId),
      triggers: objects(p.triggers).map(condition),
      missingConditions: strings(p.missingConditions),
      ...(p.supersedesPlanId === undefined ? {} : { supersedesPlanId: text(p.supersedesPlanId) }),
    })),
    actions: objects(state.actions).map((a) => ({
      id: text(a.id),
      goalId: nullableText(a.goalId),
      capability: text(a.capability),
      targetIds: strings(a.targetIds),
      parameters: parameters(a.parameters),
      preconditions: objects(a.preconditions).map(condition),
      dependsOnActionIds: strings(a.dependsOnActionIds),
      handlesResponsibilityIds: strings(a.handlesResponsibilityIds),
      sourceIds: strings(a.sourceIds),
      status: text(a.status) as typeof a.status,
      ...(a.resultId === undefined ? {} : { resultId: text(a.resultId) }),
      ...(a.failureCode === undefined ? {} : { failureCode: text(a.failureCode) }),
    })),
    responsibilities: objects(state.responsibilities).map((r) => ({
      id: text(r.id),
      subject: subject(r.subject),
      summary: text(r.summary),
      status: text(r.status) as typeof r.status,
      waitingOn: r.waitingOn === null ? null : (text(r.waitingOn) as typeof r.waitingOn),
      sourceIds: strings(r.sourceIds),
      nextCheck: objects(r.nextCheck).map(condition),
      ...(r.deadline ? { deadline: deadline(r.deadline) } : {}),
      ...(r.resolutionResultId === undefined
        ? {}
        : { resolutionResultId: text(r.resolutionResultId) }),
      ...(r.endReason === undefined ? {} : { endReason: text(r.endReason) }),
      ...(options.includeRequestRevisions && r.revision !== undefined
        ? { revision: revision(r.revision) }
        : {}),
    })),
    decisions: objects(state.decisions).map((d) => ({
      id: text(d.id),
      responsibilityId: text(d.responsibilityId),
      kind: text(d.kind) as typeof d.kind,
      sourceId: text(d.sourceId),
      quote: options.privateStrategySourceIds?.has(d.sourceId) ? '' : text(d.quote),
      ...(options.includeRequestRevisions && d.responsibilityRevision !== undefined
        ? { responsibilityRevision: revision(d.responsibilityRevision) }
        : {}),
    })),
    focus: focus(state.focus),
    ...(continuation === undefined ? {} : { continuation: continuationView() }),
    ...(participations === undefined ? {} : { episodeParticipations: episodeParticipations() }),
    ...(state.questions === undefined
      ? {}
      : {
          questions: objects(state.questions).map((q) => ({
            id: text(q.id),
            channel: text(q.channel) as typeof q.channel,
            threadId: text(q.threadId),
            sourceId: text(q.sourceId),
            text: options.privateStrategySourceIds?.has(q.sourceId) ? '' : text(q.text),
            askedAt: text(q.askedAt),
            status: text(q.status) as typeof q.status,
            ...(q.responsibilityId === undefined
              ? {}
              : { responsibilityId: text(q.responsibilityId) }),
            ...(q.resolution === undefined
              ? {}
              : {
                  resolution: (() => {
                    object(q.resolution);
                    return {
                      sourceId: text(q.resolution.sourceId),
                      at: text(q.resolution.at),
                      kind: text(q.resolution.kind) as typeof q.resolution.kind,
                      ...(q.resolution.quote === undefined
                        ? {}
                        : {
                            quote: options.privateStrategySourceIds?.has(q.resolution.sourceId)
                              ? ''
                              : text(q.resolution.quote),
                          }),
                      ...(q.resolution.reason === undefined ||
                      options.privateStrategySourceIds?.has(q.resolution.sourceId)
                        ? {}
                        : { reason: text(q.resolution.reason) }),
                    };
                  })(),
                }),
          })),
        }),
  };
}

/** Read-only working set. Persistence and recovery retain the original state.
 * Explicit references and dependency edges, never summary text, retain history.
 * Decisions keep their responsibility scope, including terminal refusals.
 */
export function currentActorWorkState(
  state: ActorAgentState,
  referencedSourceIds: ReadonlySet<string> = new Set(),
): ActorAgentState {
  const collections = {
    goals: state.goals,
    plans: state.plans,
    actions: state.actions,
    responsibilities: state.responsibilities,
    questions: state.questions ?? [],
  };
  type Kind = keyof typeof collections;
  const indexes = Object.fromEntries(
    Object.entries(collections).map(([kind, rows]) => [
      kind,
      new Map(rows.map((row) => [row.id, row])),
    ]),
  ) as {
    [K in Kind]: Map<string, (typeof collections)[K][number]>;
  };
  const selected: Record<Kind, Set<string>> = {
    goals: new Set(),
    plans: new Set(),
    actions: new Set(),
    responsibilities: new Set(),
    questions: new Set(),
  };
  const queue: [Kind, string][] = [];
  const add = (kind: Kind, id: string | null | undefined) => {
    if (id && indexes[kind].has(id) && !selected[kind].has(id)) {
      selected[kind].add(id);
      queue.push([kind, id]);
    }
  };
  const conditions = (items: AgentCondition[]) => {
    for (const c of items) {
      if (c.kind === 'result') add('actions', c.actionId);
      if (c.kind === 'player_decision') add('responsibilities', c.responsibilityId);
    }
  };
  for (const g of state.goals)
    if (!['fulfilled', 'withdrawn'].includes(g.status)) add('goals', g.id);
  for (const p of state.plans)
    if (!['finished', 'withdrawn'].includes(p.status)) add('plans', p.id);
  for (const a of state.actions)
    if (!['succeeded', 'failed', 'withdrawn'].includes(a.status)) add('actions', a.id);
  for (const r of state.responsibilities)
    if (
      !['fulfilled', 'withdrawn', 'expired'].includes(r.status) ||
      r.subject.id === state.focus?.subjectId
    )
      add('responsibilities', r.id);
  for (const q of state.questions ?? [])
    if (
      !['answered', 'withdrawn'].includes(q.status) ||
      q.resolution?.kind === 'decline_to_answer' ||
      q.sourceId === state.focus?.questionSourceId ||
      referencedSourceIds.has(q.sourceId)
    )
      add('questions', q.id);
  for (const d of state.decisions) add('responsibilities', d.responsibilityId);
  for (const kind of ['goals', 'plans', 'actions', 'responsibilities'] as const)
    for (const row of collections[kind])
      if (row.sourceIds.some((id) => referencedSourceIds.has(id))) add(kind, row.id);
  if (state.continuation) {
    for (const id of state.continuation.planIds) add('plans', id);
    for (const id of state.continuation.questionIds) add('questions', id);
    conditions(state.continuation.conditions);
  }
  // Indexed adjacency avoids repeatedly scanning accumulated history for each dependency.
  const questionsByResponsibility = new Map<string, string[]>();
  for (const q of state.questions ?? [])
    if (q.responsibilityId) {
      const ids = questionsByResponsibility.get(q.responsibilityId) ?? [];
      ids.push(q.id);
      questionsByResponsibility.set(q.responsibilityId, ids);
    }
  for (let i = 0; i < queue.length; i++) {
    const [kind, id] = queue[i]!;
    if (kind === 'plans') {
      const p = indexes.plans.get(id)!;
      add('goals', p.goalId);
      add('plans', p.supersedesPlanId);
      for (const id of p.actionIds) add('actions', id);
      add('actions', p.nextActionId);
      conditions(p.triggers);
    } else if (kind === 'actions') {
      const a = indexes.actions.get(id)!;
      add('goals', a.goalId);
      for (const id of a.dependsOnActionIds) add('actions', id);
      for (const id of a.handlesResponsibilityIds) add('responsibilities', id);
      conditions(a.preconditions);
    } else if (kind === 'responsibilities') {
      conditions(indexes.responsibilities.get(id)!.nextCheck);
      for (const q of questionsByResponsibility.get(id) ?? []) add('questions', q);
    } else if (kind === 'questions')
      add('responsibilities', indexes.questions.get(id)!.responsibilityId);
  }
  return {
    ...state,
    goals: state.goals.filter((x) => selected.goals.has(x.id)),
    plans: state.plans.filter((x) => selected.plans.has(x.id)),
    actions: state.actions.filter((x) => selected.actions.has(x.id)),
    responsibilities: state.responsibilities.filter((x) => selected.responsibilities.has(x.id)),
    ...(state.questions === undefined
      ? {}
      : { questions: state.questions.filter((x) => selected.questions.has(x.id)) }),
  };
}
