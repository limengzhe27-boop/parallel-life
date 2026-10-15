import type {
  AgentProposal,
  ActorAgentState,
  AgentActionResult,
  AgentSource,
} from './agent-runtime.ts';
import { applyQuestionChanges, AgentQuestionError } from './agent-questions.ts';

export type AgentValidationContext = {
  state: ActorAgentState;
  viewState?: ActorAgentState;
  sources: AgentSource[];
  worldVersion: number;
  storyAt: string;
  input: { sourceId: string; text: string; origin: 'player' | 'wake' | 'coordination' };
  channel: { kind: 'private' | 'group' | 'scene'; threadId: string; allowedCapabilities: string[] };
  knownActionResults?: AgentActionResult[];
};
/** Produce a model view without deleting or rewriting the authoritative execution state. */
export function authorizedAgentState(
  state: ActorAgentState,
  permittedSources: ReadonlySet<string>,
): { viewState: ActorAgentState; redactedStateIds: string[] } {
  const viewState = structuredClone(state);
  const based = (item: { sourceIds: string[] }) =>
    item.sourceIds.every((id) => permittedSources.has(id));
  const count = () =>
    viewState.goals.length +
    viewState.plans.length +
    viewState.actions.length +
    viewState.responsibilities.length +
    viewState.decisions.length;
  let previous = -1;
  while (previous !== count()) {
    previous = count();
    const goals = new Set(viewState.goals.filter(based).map((item) => item.id));
    const actions = new Set(viewState.actions.map((item) => item.id));
    const responsibilities = new Set(viewState.responsibilities.map((item) => item.id));
    const conditions = (items: import('./agent-runtime.ts').AgentCondition[]) =>
      items.every((item) =>
        item.kind === 'result'
          ? actions.has(item.actionId)
          : item.kind === 'player_decision'
            ? responsibilities.has(item.responsibilityId)
            : item.kind === 'at_place' || permittedSources.has(item.sourceId),
      );
    viewState.goals = viewState.goals.filter(based);
    viewState.responsibilities = viewState.responsibilities.filter(
      (item) =>
        based(item) &&
        (!item.deadline || permittedSources.has(item.deadline.sourceId)) &&
        conditions(item.nextCheck),
    );
    viewState.actions = viewState.actions.filter(
      (item) =>
        based(item) &&
        goals.has(item.goalId) &&
        item.handlesResponsibilityIds.every((id) => responsibilities.has(id)) &&
        item.dependsOnActionIds.every((id) => actions.has(id)) &&
        conditions(item.preconditions),
    );
    viewState.plans = viewState.plans.filter(
      (item) =>
        based(item) &&
        goals.has(item.goalId) &&
        item.actionIds.every((id) => actions.has(id)) &&
        (item.nextActionId === null ||
          (item.actionIds.includes(item.nextActionId) && actions.has(item.nextActionId))) &&
        conditions(item.triggers),
    );
    viewState.decisions = viewState.decisions.filter(
      (item) => permittedSources.has(item.sourceId) && responsibilities.has(item.responsibilityId),
    );
  }
  viewState.knowledgeSourceIds = viewState.knowledgeSourceIds.filter((id) =>
    permittedSources.has(id),
  );
  if (state.questions !== undefined)
    viewState.questions = state.questions
      .filter(
        (question) =>
          permittedSources.has(question.sourceId) &&
          (!question.resolution || permittedSources.has(question.resolution.sourceId)) &&
          (!question.responsibilityId ||
            viewState.responsibilities.some((r) => r.id === question.responsibilityId)),
      )
      .map((question) => structuredClone(question));
  const allIds = new Set(
    [
      ...state.goals,
      ...state.plans,
      ...state.actions,
      ...state.responsibilities,
      ...state.decisions,
    ].map((item) => item.id),
  );
  const visibleIds = new Set(
    [
      ...viewState.goals,
      ...viewState.plans,
      ...viewState.actions,
      ...viewState.responsibilities,
      ...viewState.decisions,
    ].map((item) => item.id),
  );
  if (
    viewState.focus &&
    ((viewState.focus.questionSourceId &&
      !permittedSources.has(viewState.focus.questionSourceId)) ||
      (viewState.focus.subjectId &&
        allIds.has(viewState.focus.subjectId) &&
        !visibleIds.has(viewState.focus.subjectId)))
  )
    viewState.focus = null;
  const redactedStateIds: string[] = [];
  redactedStateIds.push(
    ...(state.questions ?? [])
      .filter((q) => !viewState.questions?.some((visible) => visible.id === q.id))
      .map((q) => q.id),
  );
  for (const key of ['goals', 'plans', 'actions', 'responsibilities', 'decisions'] as const) {
    const visible = new Set(viewState[key].map((item) => item.id));
    redactedStateIds.push(
      ...state[key].filter((item) => !visible.has(item.id)).map((item) => item.id),
    );
  }
  return { viewState, redactedStateIds };
}
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
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameValue(value, b[index]))
    );
  const ak = Object.keys(a).sort(),
    bk = Object.keys(b).sort();
  return (
    ak.length === bk.length &&
    ak.every(
      (key, index) =>
        key === bk[index] &&
        sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function withoutInternalRevision(value: object) {
  const {
    revision: _revision,
    responsibilityRevision: _decisionRevision,
    ...rest
  } = value as Record<string, unknown>;
  return rest;
}
export function responsibilityRevision(
  context: AgentValidationContext,
  proposal: AgentProposal,
  id: string,
): number {
  const old = context.state.responsibilities.find((item) => item.id === id);
  const next = proposal.responsibilities.find((item) => item.id === id);
  return !old
    ? 0
    : (old.revision ?? 0) +
        (next &&
        !sameValue(
          { subject: old.subject, summary: old.summary, deadline: old.deadline },
          { subject: next.subject, summary: next.summary, deadline: next.deadline },
        )
          ? 1
          : 0);
}
/** Current decision per request revision; an earlier acceptance cannot survive a later refusal. */
export function currentPlayerDecision(
  context: AgentValidationContext,
  proposal: AgentProposal,
  responsibilityId: string,
) {
  const revision = responsibilityRevision(context, proposal, responsibilityId);
  const sources = new Map(context.sources.map((source) => [source.id, source]));
  const old = (context.viewState ?? context.state).decisions.filter(
    (decision) => (decision.responsibilityRevision ?? 0) === revision,
  );
  return [...old, ...proposal.decisions]
    .filter(
      (decision) =>
        decision.responsibilityId === responsibilityId && sources.has(decision.sourceId),
    )
    .map((decision, index) => ({ decision, source: sources.get(decision.sourceId)!, index }))
    .sort(
      (a, b) =>
        Date.parse(a.source.at) - Date.parse(b.source.at) ||
        a.source.worldVersion - b.source.worldVersion ||
        a.index - b.index,
    )
    .at(-1)?.decision;
}

export function validateAgentProposal(
  context: AgentValidationContext,
  proposal: AgentProposal,
): void {
  const state = context.viewState ?? context.state;
  applyAgentQuestionChanges(context, proposal);
  if (context.viewState) {
    requireValid(
      state.worldId === context.state.worldId &&
        state.actorId === context.state.actorId &&
        state.revision === context.state.revision &&
        state.definitionRef === context.state.definitionRef,
      'INVALID_AUTHORIZED_VIEW',
    );
    for (const key of ['goals', 'plans', 'actions', 'responsibilities', 'decisions'] as const) {
      const allowed = new Set(state[key].map((item) => item.id));
      const redacted = new Set(
        context.state[key].filter((item) => !allowed.has(item.id)).map((item) => item.id),
      );
      requireValid(
        proposal[key].every((item) => !redacted.has(item.id)),
        'REDACTED_STATE_MUTATION',
      );
    }
  }
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
  for (const key of ['goals', 'plans', 'actions', 'responsibilities'] as const)
    for (const entry of proposal[key]) {
      const old = state[key].find((item) => item.id === entry.id);
      if (old)
        requireValid(
          old.sourceIds.every((id) => entry.sourceIds.includes(id)),
          'SOURCE_HISTORY_IMMUTABLE',
        );
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
      requireValid(sameValue(old, goal), 'TERMINAL_GOAL');
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
    if (plan.status === 'active')
      requireValid(goals.get(plan.goalId)?.status === 'active', 'PLAN_GOAL_NOT_ACTIVE');
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
    if (['proposed', 'ready'].includes(action.status))
      requireValid(
        goals.get(action.goalId)?.status === 'active' ||
          goals.get(action.goalId)?.status === 'fulfilled',
        'ACTION_GOAL_NOT_ACTIVE',
      );
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
        sameValue(withoutInternalRevision(old), withoutInternalRevision(responsibility)),
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
      !old || sameValue(withoutInternalRevision(old), withoutInternalRevision(decision)),
      'DECISION_HISTORY_IMMUTABLE',
    );
  }
  requireValid(
    new Set(proposal.decisions.map((item) => item.responsibilityId)).size ===
      proposal.decisions.length,
    'AMBIGUOUS_CURRENT_DECISION',
  );
  if (proposal.focus) {
    requireValid(
      proposal.focus.channel === context.channel.kind &&
        proposal.focus.threadId === context.channel.threadId,
      'FOCUS_CHANNEL',
    );
    if (proposal.focus.questionSourceId) hasSource(proposal.focus.questionSourceId);
  }
  const reports = proposal.locationReports ?? [];
  requireValid(
    new Set(reports.map((r) => (r.subject.kind === 'player' ? 'player' : r.subject.actorId)))
      .size === reports.length,
    'AMBIGUOUS_LOCATION_REPORT',
  );
  for (const report of reports)
    requireValid(
      context.input.origin === 'player' &&
        report.sourceId === context.input.sourceId &&
        !!report.quote.trim() &&
        context.input.text.includes(report.quote),
      'UNSOURCED_LOCATION_REPORT',
    );
  for (const statement of proposal.statements) {
    if (statement.questionForResponsibilityId !== undefined)
      requireValid(
        statement.requestsPlayerReply === true &&
          responsibilities.has(statement.questionForResponsibilityId),
        'UNKNOWN_QUESTION_RESPONSIBILITY',
      );
    for (const id of statement.dependsOnActionIds)
      requireValid(actions.has(id), 'UNKNOWN_STATEMENT_DEPENDENCY');
  }
  requireValid(
    context.input.origin !== 'player' || proposal.statements.length > 0,
    'MISSING_REPLY',
  );
}

/** Only currently authorized questions may be changed; topic focus has no closing authority. */
function applyAgentQuestionChanges(context: AgentValidationContext, proposal: AgentProposal) {
  const visible = context.viewState ?? context.state;
  const permitted = new Set(context.sources.map((source) => source.id));
  try {
    return applyQuestionChanges(
      {
        worldId: context.state.worldId,
        actorId: context.state.actorId,
        questions: context.state.questions ?? [],
      },
      {
        worldId: context.state.worldId,
        actorId: context.state.actorId,
        storyAt: context.storyAt,
        ...(context.input.origin === 'player'
          ? {
              input: {
                origin: 'player' as const,
                sourceId: context.input.sourceId,
                text: context.input.text,
                channel: context.channel.kind,
                threadId: context.channel.threadId,
              },
            }
          : {}),
        questionSources: (visible.questions ?? [])
          .filter((q) => permitted.has(q.sourceId))
          .map((q) => ({
            questionId: q.id,
            sourceId: q.sourceId,
            channel: q.channel,
            threadId: q.threadId,
          })),
        withdrawalSourceIds: [...permitted],
      },
      { replyAssessments: proposal.replyAssessments, withdrawals: proposal.questionWithdrawals },
    );
  } catch (error) {
    if (error instanceof AgentQuestionError) throw new AgentValidationError(error.reason);
    throw error;
  }
}

/** Trusted action results are emitted by kernel capabilities, never parsed from NPC claims. */
export function reduceActorAgentState(
  context: AgentValidationContext,
  proposal: AgentProposal,
  results: AgentActionResult[],
  worldVersion: number,
): {
  state: ActorAgentState;
  statements: AgentProposal['statements'];
  questionChanges: import('./agent-questions.ts').QuestionApplicationReceipt[];
} {
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
  const goals = merge(context.state.goals, proposal.goals);
  for (const goal of goals)
    if (
      goal.status === 'fulfilled' &&
      !context.state.goals.some((old) => old.id === goal.id && old.status === 'fulfilled')
    )
      requireValid(
        goal.resultIds.every(
          (id) =>
            actions.some(
              (action) =>
                action.goalId === goal.id &&
                action.resultId === id &&
                action.status === 'succeeded',
            ) &&
            [...results, ...(context.knownActionResults ?? [])].some(
              (result) =>
                result.id === id &&
                result.worldId === context.state.worldId &&
                result.actorId === context.state.actorId &&
                result.outcome === 'succeeded' &&
                result.completedGoalIds?.includes(goal.id),
            ),
        ),
        'UNCONFIRMED_GOAL_RESULT',
      );
  const responsibilities = merge(
    context.state.responsibilities,
    proposal.responsibilities.map((item) => ({
      ...item,
      revision: responsibilityRevision(context, proposal, item.id),
    })),
  );
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
    questionChanges: applyAgentQuestionChanges(context, proposal).applied,
    state: {
      ...context.state,
      ...(context.state.questions !== undefined ||
      proposal.replyAssessments?.length ||
      proposal.questionWithdrawals?.length
        ? {
            questions: applyAgentQuestionChanges(context, proposal).state.questions,
          }
        : {}),
      revision: context.state.revision + 1,
      projectedWorldVersion: worldVersion,
      goals,
      plans: merge(context.state.plans, proposal.plans),
      actions,
      responsibilities,
      decisions: merge(
        context.state.decisions,
        proposal.decisions.map((item) => ({
          ...item,
          responsibilityRevision: responsibilityRevision(context, proposal, item.responsibilityId),
        })),
      ),
      focus: proposal.focus === undefined ? context.state.focus : proposal.focus,
    },
    statements,
  };
}
