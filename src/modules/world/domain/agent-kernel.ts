import type {
  AgentProposal,
  ActorAgentState,
  AgentActionResult,
  AgentSource,
} from './agent-runtime.ts';

export type AgentValidationContext = {
  state: ActorAgentState;
  sources: AgentSource[];
  worldVersion: number;
  storyAt: string;
  input: { sourceId: string; text: string; origin: 'player' | 'wake' | 'coordination' };
  channel: { kind: 'private' | 'group' | 'scene'; threadId: string; allowedCapabilities: string[] };
};
export class AgentValidationError extends Error {
  readonly code = 'INVALID_AGENT_PROPOSAL';
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
const reject = (reason: string): never => {
  throw new AgentValidationError(reason);
};
const requireValid = (ok: unknown, reason: string): void => {
  if (!ok) reject(reason);
};

export function validateAgentProposal(
  context: AgentValidationContext,
  proposal: AgentProposal,
): void {
  const { state } = context;
  requireValid(state.projectedWorldVersion <= context.worldVersion, 'FUTURE_STATE');
  const sources = new Map(context.sources.map((source) => [source.id, source]));
  requireValid(sources.size === context.sources.length, 'DUPLICATE_SOURCE');
  for (const source of sources.values())
    requireValid(
      source.worldVersion <= context.worldVersion &&
        Date.parse(source.at) <= Date.parse(context.storyAt),
      'FUTURE_SOURCE',
    );
  const hasSource = (id: string) => requireValid(sources.has(id), 'UNKNOWN_SOURCE');
  for (const list of [
    proposal.goals,
    proposal.plans,
    proposal.actions,
    proposal.responsibilities,
    proposal.decisions,
  ])
    requireValid(new Set(list.map((entry) => entry.id)).size === list.length, 'DUPLICATE_ID');
  for (const list of [proposal.goals, proposal.plans, proposal.actions, proposal.responsibilities])
    for (const entry of list) {
      requireValid(entry.sourceIds.length > 0, 'MISSING_BASIS');
      entry.sourceIds.forEach(hasSource);
    }
  const goals = new Map([...state.goals, ...proposal.goals].map((goal) => [goal.id, goal]));
  const plans = new Map([...state.plans, ...proposal.plans].map((plan) => [plan.id, plan]));
  const actions = new Map(
    [...state.actions, ...proposal.actions].map((action) => [action.id, action]),
  );
  const responsibilities = new Map(
    [...state.responsibilities, ...proposal.responsibilities].map((item) => [item.id, item]),
  );
  const conditions = (items: import('./agent-runtime.ts').AgentCondition[]) => {
    for (const condition of items) {
      if (condition.kind === 'at_or_after' || condition.kind === 'observation')
        hasSource(condition.sourceId);
      if (condition.kind === 'result')
        requireValid(actions.has(condition.actionId), 'UNKNOWN_ACTION_CONDITION');
      if (condition.kind === 'player_decision')
        requireValid(responsibilities.has(condition.responsibilityId), 'UNKNOWN_RESPONSIBILITY');
    }
  };
  for (const goal of proposal.goals) {
    const old = state.goals.find((item) => item.id === goal.id);
    if (old && ['fulfilled', 'withdrawn'].includes(old.status))
      requireValid(JSON.stringify(old) === JSON.stringify(goal), 'TERMINAL_GOAL');
    if (goal.status === 'fulfilled')
      requireValid(goal.resultIds.length > 0, 'GOAL_RESULT_REQUIRED');
    if (['withdrawn', 'fulfilled'].includes(goal.status))
      requireValid(goal.endReason, 'END_REASON_REQUIRED');
  }
  for (const plan of proposal.plans) {
    requireValid(goals.has(plan.goalId), 'UNKNOWN_GOAL');
    for (const id of plan.actionIds)
      requireValid(actions.get(id)?.goalId === plan.goalId, 'INVALID_PLAN_ACTION');
    requireValid(
      plan.nextActionId === null || plan.actionIds.includes(plan.nextActionId),
      'INVALID_NEXT_ACTION',
    );
    if (plan.supersedesPlanId)
      requireValid(
        plans.get(plan.supersedesPlanId)?.goalId === plan.goalId &&
          plan.supersedesPlanId !== plan.id,
        'INVALID_PREVIOUS_PLAN',
      );
    conditions(plan.triggers);
  }
  for (const action of proposal.actions) {
    requireValid(goals.has(action.goalId), 'UNKNOWN_GOAL');
    requireValid(
      context.channel.allowedCapabilities.includes(action.capability),
      'UNAUTHORIZED_CAPABILITY',
    );
    requireValid(
      !['executing', 'succeeded', 'failed'].includes(action.status) &&
        action.resultId === undefined,
      'MODEL_EXECUTION_CLAIM',
    );
    const old = state.actions.find((item) => item.id === action.id);
    requireValid(
      !old || !['executing', 'succeeded', 'failed', 'withdrawn'].includes(old.status),
      'TERMINAL_ACTION',
    );
    for (const id of action.handlesResponsibilityIds)
      requireValid(responsibilities.has(id), 'UNKNOWN_RESPONSIBILITY');
    for (const id of action.dependsOnActionIds)
      requireValid(id !== action.id && actions.has(id), 'INVALID_ACTION_DEPENDENCY');
    conditions(action.preconditions);
  }
  // Reject cyclic action prerequisites rather than leaving an unexecutable plan forever.
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    requireValid(!visiting.has(id), 'CYCLIC_ACTION_DEPENDENCY');
    visiting.add(id);
    for (const dep of actions.get(id)?.dependsOnActionIds ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of actions.keys()) visit(id);
  for (const responsibility of proposal.responsibilities) {
    const old = state.responsibilities.find((item) => item.id === responsibility.id);
    if (old)
      requireValid(
        old.subject.id === responsibility.subject.id &&
          old.subject.kind === responsibility.subject.kind,
        'RESPONSIBILITY_IDENTITY',
      );
    if (old && ['fulfilled', 'withdrawn', 'expired'].includes(old.status))
      requireValid(
        JSON.stringify(old) === JSON.stringify(responsibility),
        'TERMINAL_RESPONSIBILITY',
      );
    if (responsibility.deadline) {
      hasSource(responsibility.deadline.sourceId);
      requireValid(
        sources.get(responsibility.deadline.sourceId)?.deadlineAt === responsibility.deadline.at,
        'UNSOURCED_DEADLINE',
      );
    }
    if (responsibility.status === 'fulfilled')
      requireValid(responsibility.resolutionResultId, 'RESPONSIBILITY_RESULT_REQUIRED');
    if (['fulfilled', 'withdrawn', 'expired'].includes(responsibility.status))
      requireValid(responsibility.endReason, 'END_REASON_REQUIRED');
    if (responsibility.status === 'expired')
      requireValid(
        responsibility.deadline &&
          Date.parse(responsibility.deadline.at) <= Date.parse(context.storyAt),
        'NOT_EXPIRED',
      );
    conditions(responsibility.nextCheck);
  }
  for (const decision of proposal.decisions) {
    requireValid(
      context.input.origin === 'player' && decision.sourceId === context.input.sourceId,
      'DECISION_NOT_PLAYER_INPUT',
    );
    hasSource(decision.sourceId);
    requireValid(context.input.text.includes(decision.quote), 'DECISION_QUOTE');
    requireValid(responsibilities.has(decision.responsibilityId), 'UNKNOWN_RESPONSIBILITY');
    const old = state.decisions.find((item) => item.id === decision.id);
    requireValid(
      !old || JSON.stringify(old) === JSON.stringify(decision),
      'DECISION_HISTORY_IMMUTABLE',
    );
  }
  if (proposal.focus) {
    requireValid(
      proposal.focus.channel === context.channel.kind &&
        proposal.focus.threadId === context.channel.threadId,
      'FOCUS_CHANNEL',
    );
    if (proposal.focus.questionSourceId) hasSource(proposal.focus.questionSourceId);
  }
  for (const statement of proposal.statements)
    for (const id of statement.dependsOnActionIds)
      requireValid(actions.has(id), 'UNKNOWN_STATEMENT_DEPENDENCY');
  requireValid(
    context.input.origin !== 'player' || proposal.statements.length > 0,
    'MISSING_REPLY',
  );
}

/** Trusted action results are emitted by kernel capabilities, never parsed from NPC claims. */
export function reduceActorAgentState(
  context: AgentValidationContext,
  proposal: AgentProposal,
  results: AgentActionResult[],
  worldVersion: number,
): { state: ActorAgentState; statements: AgentProposal['statements'] } {
  validateAgentProposal(context, proposal);
  requireValid(worldVersion === context.worldVersion + 1, 'RESULT_WORLD_VERSION');
  const merge = <T extends { id: string }>(old: T[], changes: T[]) => [
    ...new Map([...old, ...changes].map((item) => [item.id, item])).values(),
  ];
  const actions = merge(context.state.actions, proposal.actions).map((action) => ({ ...action }));
  const resultsById = new Map(results.map((result) => [result.id, result]));
  requireValid(
    resultsById.size === results.length &&
      new Set(results.map((result) => result.actionId)).size === results.length,
    'DUPLICATE_RESULT',
  );
  for (const result of results) {
    const action = actions.find((item) => item.id === result.actionId);
    requireValid(
      result.worldId === context.state.worldId &&
        result.actorId === context.state.actorId &&
        result.worldVersion === worldVersion &&
        Date.parse(result.at) >= Date.parse(context.storyAt),
      'RESULT_SCOPE',
    );
    requireValid(action && ['proposed', 'ready'].includes(action.status), 'RESULT_ACTION');
    requireValid(
      result.handledResponsibilityIds.every((id) => action!.handlesResponsibilityIds.includes(id)),
      'RESULT_RESPONSIBILITY',
    );
    requireValid(
      result.outcome === 'succeeded' || result.handledResponsibilityIds.length === 0,
      'FAILED_RESULT_HANDLED',
    );
    if (action) {
      action.status = result.outcome;
      action.resultId = result.id;
    }
  }
  const priorResultIds = new Set(
    context.state.actions.flatMap((action) =>
      action.status === 'succeeded' && action.resultId ? [action.resultId] : [],
    ),
  );
  const goals = merge(context.state.goals, proposal.goals);
  for (const goal of goals)
    if (goal.status === 'fulfilled')
      requireValid(
        goal.resultIds.every(
          (id) => priorResultIds.has(id) || resultsById.get(id)?.outcome === 'succeeded',
        ),
        'UNCONFIRMED_GOAL_RESULT',
      );
  const responsibilities = merge(context.state.responsibilities, proposal.responsibilities);
  for (const item of responsibilities)
    if (
      item.status === 'fulfilled' &&
      !context.state.responsibilities.some(
        (old) => old.id === item.id && old.status === 'fulfilled',
      )
    ) {
      const result = resultsById.get(item.resolutionResultId!);
      requireValid(
        result?.outcome === 'succeeded' && result.handledResponsibilityIds.includes(item.id),
        'UNCONFIRMED_RESPONSIBILITY_RESULT',
      );
    }
  const statements = proposal.statements.filter((statement) =>
    statement.dependsOnActionIds.every(
      (id) => actions.find((action) => action.id === id)?.status === 'succeeded',
    ),
  );
  requireValid(
    context.input.origin !== 'player' || statements.length > 0,
    'REPLY_DEPENDS_ON_UNEXECUTED_ACTION',
  );
  return {
    state: {
      ...context.state,
      revision: context.state.revision + 1,
      projectedWorldVersion: worldVersion,
      goals,
      plans: merge(context.state.plans, proposal.plans),
      actions,
      responsibilities,
      decisions: merge(context.state.decisions, proposal.decisions),
      focus: proposal.focus === undefined ? context.state.focus : proposal.focus,
    },
    statements,
  };
}
