import type {
  ActorAgentState,
  AgentAction,
  AgentCondition,
  AgentConversationFocus,
} from '../domain/agent-runtime.ts';

export type ActorStateContextOptions = {
  privateStrategySourceIds?: ReadonlySet<string>;
  includeRequestRevisions?: boolean;
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
  return {
    schemaVersion: state.schemaVersion,
    worldId: text(state.worldId),
    actorId: text(state.actorId),
    revision: revision(state.revision),
    projectedWorldVersion: revision(state.projectedWorldVersion),
    definitionRef: text(state.definitionRef),
    knowledgeSourceIds: strings(state.knowledgeSourceIds),
    memoryIds: strings(state.memoryIds),
    relationshipIds: strings(state.relationshipIds),
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
      goalId: text(p.goalId),
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
      goalId: text(a.goalId),
      capability: text(a.capability),
      targetIds: strings(a.targetIds),
      parameters: parameters(a.parameters),
      preconditions: objects(a.preconditions).map(condition),
      dependsOnActionIds: strings(a.dependsOnActionIds),
      handlesResponsibilityIds: strings(a.handlesResponsibilityIds),
      sourceIds: strings(a.sourceIds),
      status: text(a.status) as typeof a.status,
      ...(a.resultId === undefined ? {} : { resultId: text(a.resultId) }),
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
  };
}
